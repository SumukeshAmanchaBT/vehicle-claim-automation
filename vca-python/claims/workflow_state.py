"""
Derive claim workflow lifecycle from persisted rows (single source of truth for API + UI).

States are aligned with product semantics: NOT_STARTED means no business-rule
evaluation row exists yet; BRV completion is implied by that row; DA completion
requires persisted damage-assessment evidence rather than terminal status labels.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Max
from django.utils import timezone

from claims.models import (
    ClaimDuplicateCandidate,
    ClaimEvaluationResponse,
    ClaimPhase1Valuation,
    DamagePartAssessment,
    FnolClaim,
    ImageFraudResult,
)
from claims.workflow_display import (
    claim_status_implies_recommendation_terminal,
    workflow_ui_for_state,
)


def current_lifecycle_started_at(
    latest_eval: ClaimEvaluationResponse | None,
):
    """Timestamp anchor for artifacts that belong to the latest BRV lifecycle."""
    return getattr(latest_eval, "created_date", None) if latest_eval else None


def dedupe_image_fraud_rows_latest_per_photo(
    rows: list[ImageFraudResult],
) -> list[ImageFraudResult]:
    """Keep the newest ORM row per photo_path for stable API / decision payloads."""
    best: dict[str, ImageFraudResult] = {}
    anchor = timezone.now()

    def _ts(row: ImageFraudResult):
        return row.created_at or anchor

    for row in sorted(rows, key=_ts, reverse=True):
        path = (row.photo_path or "").strip()
        key = path or f"__no_path_{row.id}"
        if key not in best:
            best[key] = row
    return list(best.values())


def image_fraud_rows_for_claim_evaluation(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
) -> list[ImageFraudResult]:
    """
    Image-fraud rows scoped to the current BRV lifecycle when possible.

    If Business Rule Validation is re-run after media-trust analysis, rows from the
    prior run can fall *before* ``latest_eval.created_date`` and would otherwise
    disappear from APIs until damage assessment is executed again. In that case we
    fall back to the latest stored row per photo so fraud scores and labels remain
    visible and cross-claim decisioning stays grounded.
    """
    started_at = current_lifecycle_started_at(latest_eval)
    base_qs = ImageFraudResult.objects.filter(complaint=claim).order_by(
        "-fraud_score", "-created_at"
    )
    if started_at is None:
        return dedupe_image_fraud_rows_latest_per_photo(list(base_qs))
    scoped = list(base_qs.filter(created_at__gte=started_at))
    if scoped:
        return scoped
    return dedupe_image_fraud_rows_latest_per_photo(
        list(ImageFraudResult.objects.filter(complaint=claim).order_by("-created_at"))
    )


def duplicate_candidate_rows_for_claim_evaluation(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
) -> list[ClaimDuplicateCandidate]:
    """Duplicate rows with the same BRV lifecycle + empty-window fallback as fraud rows."""
    started_at = current_lifecycle_started_at(latest_eval)
    base_qs = ClaimDuplicateCandidate.objects.filter(complaint=claim).order_by(
        "-similarity_score", "-created_at"
    )
    if started_at is None:
        return list(base_qs)
    scoped = list(base_qs.filter(created_at__gte=started_at))
    if scoped:
        return scoped
    return list(
        ClaimDuplicateCandidate.objects.filter(complaint=claim).order_by(
            "-similarity_score", "-created_at"
        )
    )


def _decimal_gt_zero(value) -> bool:
    if value in (None, ""):
        return False
    try:
        return Decimal(str(value)) > 0
    except (InvalidOperation, TypeError, ValueError):
        return False


def _valuation_breakdown_has_positive_amount(breakdown_json) -> bool:
    if not isinstance(breakdown_json, list):
        return False
    for item in breakdown_json:
        if not isinstance(item, dict):
            continue
        if _decimal_gt_zero(
            item.get("estimated_amount", item.get("estimated_cost"))
        ):
            return True
    return False


def valuation_snapshot_has_meaningful_output(
    gross_estimate,
    breakdown_json=None,
) -> bool:
    """
    True only when a valuation snapshot contains real financial output.

    Zero-only snapshots represent "no usable DA output" and must not advance
    workflow or claim evaluation.
    """
    return _decimal_gt_zero(gross_estimate) or _valuation_breakdown_has_positive_amount(
        breakdown_json
    )


def valuation_row_has_meaningful_output(
    valuation: ClaimPhase1Valuation | None,
) -> bool:
    if not valuation:
        return False
    return valuation_snapshot_has_meaningful_output(
        valuation.gross_estimate,
        valuation.breakdown_json,
    )


def fnol_status_display(claim: FnolClaim | None) -> str:
    """Resolve FNOL workflow status; tolerate missing or orphaned claim_status FK rows."""
    if not claim or getattr(claim, "claim_status_id", None) is None:
        return "Open"
    try:
        cs = claim.claim_status
        return cs.status_name if cs else "Open"
    except ObjectDoesNotExist:
        return "Open"


def effective_claim_status(
    fnol: FnolClaim | None, latest_eval: ClaimEvaluationResponse | None
) -> str:
    """
    Shared FNOL/evaluation status resolver for workflow-state and API consumers.

    This intentionally centralizes the old duplicate logic that used to live in
    both `claims.views` and `claims.workflow_state`, so workflow labels cannot
    drift between list/detail APIs and derived lifecycle state.
    """
    fnol_status = (fnol_status_display(fnol) or "").strip()
    evaluation_status = (
        (latest_eval.claim_status or "").strip() if latest_eval else ""
    )
    generic_legacy_statuses = {"", "open", "closed", "rejected", "processing"}

    # Latest BRV row is authoritative for post-DA / terminal statuses. fnol_claims.claim_status
    # often lags (e.g. still "FNOL") while ClaimEvaluationResponse already shows Recommendation shared.
    if evaluation_status and claim_status_implies_recommendation_terminal(evaluation_status):
        return evaluation_status.strip()

    if evaluation_status and fnol_status.lower() in generic_legacy_statuses:
        return evaluation_status
    if fnol_status:
        return fnol_status
    return evaluation_status or "Open"


def current_damage_assessment_persistence_state(
    fnol: FnolClaim | None,
    latest_eval: ClaimEvaluationResponse | None,
) -> dict[str, int | bool]:
    """
    Return only the damage-assessment evidence that belongs to the latest BRV run.

    BRV reruns should reset downstream workflow. Older DamagePartAssessment /
    ClaimPhase1Valuation rows must not keep DA or Claim Evaluation visible once a
    newer business-rule evaluation exists.
    """
    if not fnol or latest_eval is None:
        return {
            "current_part_count": 0,
            "current_valuation_ready": False,
            "has_current_evidence": False,
            "has_current_da_artifact": False,
        }

    evaluation_started_at = current_lifecycle_started_at(latest_eval)
    parts_qs = DamagePartAssessment.objects.filter(complaint=fnol)
    valuations_qs = ClaimPhase1Valuation.objects.filter(complaint=fnol)
    current_valuation = valuations_qs.first()

    current_part_count = parts_qs.filter(created_at__gte=evaluation_started_at).count()
    current_valuation_ready = bool(
        current_valuation
        and current_valuation.updated_at is not None
        and current_valuation.updated_at >= evaluation_started_at
        and valuation_row_has_meaningful_output(current_valuation)
    )

    # has_current_da_artifact: True when DA ran and created a valuation artifact for this
    # lifecycle (even gross_estimate == 0 / zero parts).  Separates "DA was attempted" from
    # "DA produced meaningful financial output" (current_valuation_ready).
    has_current_da_artifact = bool(
        (
            current_valuation is not None
            and current_valuation.updated_at is not None
            and current_valuation.updated_at >= evaluation_started_at
        )
        or current_part_count > 0
    )

    # Safety net: if timestamps are unexpectedly null/legacy on either table,
    # fall back to the most recent evidence timestamp instead of surfacing stale
    # rows from older runs.
    if current_part_count == 0 and not current_valuation_ready:
        latest_damage_row_at = parts_qs.aggregate(latest=Max("created_at"))["latest"]
        latest_valuation_row_at = getattr(current_valuation, "updated_at", None)
        newest_evidence_at = max(
            [
                dt
                for dt in (latest_damage_row_at, latest_valuation_row_at)
                if dt is not None
            ],
            default=None,
        )
        if newest_evidence_at and newest_evidence_at >= evaluation_started_at:
            current_part_count = parts_qs.count()
            current_valuation_ready = valuation_row_has_meaningful_output(
                current_valuation
            )

    return {
        "current_part_count": current_part_count,
        "current_valuation_ready": current_valuation_ready,
        "has_current_evidence": bool(current_part_count or current_valuation_ready),
        "has_current_da_artifact": has_current_da_artifact,
    }


def bulk_damage_assessment_persistence_state(
    fnol_claims: list[FnolClaim],
    latest_eval_map: dict[str, ClaimEvaluationResponse],
) -> dict[str, dict[str, int | bool]]:
    """
    Batch equivalent of current_damage_assessment_persistence_state for list endpoints.

    Uses two queries (damage parts + phase-1 valuations) instead of O(n) queries per claim,
    which avoids timeouts on remote MySQL when listing many FNOL rows.
    """
    empty: dict[str, int | bool] = {
        "current_part_count": 0,
        "current_valuation_ready": False,
        "has_current_evidence": False,
        "has_current_da_artifact": False,
    }
    result: dict[str, dict[str, int | bool]] = {
        f.complaint_id: dict(empty) for f in fnol_claims
    }
    ids_with_eval = [
        f.complaint_id for f in fnol_claims if latest_eval_map.get(f.complaint_id)
    ]
    if not ids_with_eval:
        return result

    parts_rows = DamagePartAssessment.objects.filter(
        complaint_id__in=ids_with_eval
    ).values_list("complaint_id", "created_at")
    parts_by_cid: dict[str, list] = defaultdict(list)
    for cid, created_at in parts_rows:
        parts_by_cid[cid].append(created_at)

    valuations_rows = ClaimPhase1Valuation.objects.filter(
        complaint_id__in=ids_with_eval
    ).values_list("complaint_id", "updated_at", "gross_estimate", "breakdown_json")
    valuation_by_cid = {
        cid: {
            "updated_at": updated_at,
            "has_output": valuation_snapshot_has_meaningful_output(
                gross_estimate,
                breakdown_json,
            ),
        }
        for cid, updated_at, gross_estimate, breakdown_json in valuations_rows
    }

    for fnol in fnol_claims:
        cid = fnol.complaint_id
        latest_eval = latest_eval_map.get(cid)
        if not latest_eval:
            continue
        evaluation_started_at = current_lifecycle_started_at(latest_eval)
        parts = parts_by_cid.get(cid, [])
        current_part_count = sum(1 for t in parts if t >= evaluation_started_at)
        valuation_snapshot = valuation_by_cid.get(cid) or {
            "updated_at": None,
            "has_output": False,
        }
        val_updated = valuation_snapshot["updated_at"]
        current_valuation_ready = (
            val_updated is not None and val_updated >= evaluation_started_at
            and bool(valuation_snapshot["has_output"])
        )

        if current_part_count == 0 and not current_valuation_ready:
            latest_damage_row_at = max(parts) if parts else None
            latest_valuation_row_at = val_updated
            newest_evidence_at = max(
                [
                    dt
                    for dt in (latest_damage_row_at, latest_valuation_row_at)
                    if dt is not None
                ],
                default=None,
            )
            if newest_evidence_at and newest_evidence_at >= evaluation_started_at:
                current_part_count = len(parts)
                current_valuation_ready = bool(valuation_snapshot["has_output"])

        has_current_da_artifact = bool(
            (val_updated is not None and val_updated >= evaluation_started_at)
            or current_part_count > 0
        )
        result[cid] = {
            "current_part_count": current_part_count,
            "current_valuation_ready": current_valuation_ready,
            "has_current_evidence": bool(current_part_count or current_valuation_ready),
            "has_current_da_artifact": has_current_da_artifact,
        }
    return result


def derive_workflow_state_from_context(
    fnol: FnolClaim | None,
    latest_eval: ClaimEvaluationResponse | None,
    damage_state: dict[str, int | bool],
) -> str:
    """
    Pure workflow label from already-loaded FNOL, latest BRV row, and DA evidence dict.
    """
    if latest_eval is None:
        return "NOT_STARTED"
    eff = effective_claim_status(fnol, latest_eval)
    eval_cs = (latest_eval.claim_status or "").strip() if latest_eval else ""
    # da_ran: DA was attempted and created artifacts (even for zero-output / no-damage runs).
    # This is intentionally broader than has_current_evidence (which requires meaningful output)
    # so the workflow advances to DAMAGE_ASSESSMENT_COMPLETED even when gross_estimate == 0.
    da_ran = damage_state["has_current_evidence"] or damage_state.get(
        "has_current_da_artifact", False
    )
    if da_ran:
        if claim_status_implies_recommendation_terminal(
            eff
        ) or claim_status_implies_recommendation_terminal(eval_cs):
            return "RECOMMENDATION_SHARED"
        return "DAMAGE_ASSESSMENT_COMPLETED"
    eff_lower = eff.lower()
    if eff_lower in ("pending damage detection", "pending_damage_detection"):
        return "DAMAGE_ASSESSMENT_IN_PROGRESS"
    return "BUSINESS_RULE_VALIDATION_COMPLETED"


def compute_claim_workflow_state(complaint_id: str) -> str:
    """
    Returns one of:
      NOT_STARTED
      BUSINESS_RULE_VALIDATION_COMPLETED
      DAMAGE_ASSESSMENT_IN_PROGRESS
      DAMAGE_ASSESSMENT_COMPLETED
      RECOMMENDATION_SHARED

    BUSINESS_RULE_VALIDATION_IN_PROGRESS is not represented in DB (use client loading flags).
    """
    latest = ClaimEvaluationResponse.objects.filter(
        complaint_id=complaint_id, is_latest=True
    ).first()
    if not latest:
        return "NOT_STARTED"

    fnol = (
        FnolClaim.objects.filter(complaint_id=complaint_id)
        .select_related("claim_status")
        .first()
    )
    damage_state = current_damage_assessment_persistence_state(fnol, latest)
    return derive_workflow_state_from_context(fnol, latest, damage_state)


def build_claim_workflow_snapshot(
    complaint_id: str,
    *,
    fnol: FnolClaim | None = None,
    latest_eval: ClaimEvaluationResponse | None = None,
    decision_summary: dict | None = None,
) -> dict:
    """
    Build an additive workflow snapshot for claim detail/evaluation consumers.

    This keeps backend sequencing explicit so the frontend does not have to infer
    completion from stale rows, browser storage, or legacy status labels.
    """
    if latest_eval is None:
        latest_eval = ClaimEvaluationResponse.objects.filter(
            complaint_id=complaint_id,
            is_latest=True,
        ).first()

    if fnol is None:
        fnol = (
            FnolClaim.objects.filter(complaint_id=complaint_id)
            .select_related("claim_status")
            .first()
        )

    workflow_state = compute_claim_workflow_state(complaint_id)
    damage_state = current_damage_assessment_persistence_state(fnol, latest_eval)

    def _damage_assessment_completed(ws: str) -> bool:
        return ws in ("DAMAGE_ASSESSMENT_COMPLETED", "RECOMMENDATION_SHARED")

    if decision_summary is None and latest_eval:
        # Local import avoids a top-level cycle with claims.decisioning.
        from claims.decisioning import sync_claim_evaluation_decision_state

        decision_summary = sync_claim_evaluation_decision_state(
            complaint_id=complaint_id,
            latest_eval=latest_eval,
        )
        latest_eval.refresh_from_db()

    business_rules_passed = None
    if isinstance(decision_summary, dict):
        business_rules_passed = decision_summary.get(
            "business_rule_validation_passed"
        )
    elif latest_eval:
        latest_status = (latest_eval.claim_status or "").strip().lower()
        if (
            "validation-pass" in latest_status
            or latest_status
            in {
                "pending damage detection",
                "pending_damage_detection",
            }
            or claim_status_implies_recommendation_terminal(latest_eval.claim_status)
        ):
            business_rules_passed = True
        elif "validation-fail" in latest_status or latest_status in {
            "fraudulent",
            "rejected",
        }:
            business_rules_passed = False

    damage_assessment_completed = _damage_assessment_completed(workflow_state)
    damage_assessment_available = business_rules_passed is True
    # DA can run and persist an artifact (valuation row timestamp) even when it produces
    # zero billable lines (gross_estimate == 0, empty breakdown). In that case we still
    # want evaluation screens to show 0-values instead of "not available yet".
    has_current_da_artifact = bool(damage_state.get("has_current_da_artifact"))
    claim_evaluation_completed = bool(
        damage_assessment_completed
        and bool(damage_state["current_valuation_ready"])
        and (
            workflow_state == "RECOMMENDATION_SHARED"
            or (
                isinstance(decision_summary, dict)
                and decision_summary.get("approval_state")
                in {
                    "straight_through_eligible",
                    "manual_review_required",
                    "rejected",
                }
            )
        )
    )

    snapshot = {
        "workflow_state": workflow_state,
        "business_rule_validation": {
            "completed": latest_eval is not None,
            "visible": latest_eval is not None,
            "run_allowed": fnol is not None,
            "passed": business_rules_passed,
        },
        "damage_assessment": {
            "available": damage_assessment_available,
            "completed": damage_assessment_completed,
            "visible": damage_assessment_completed,
            "run_allowed": damage_assessment_available,
            # Consider DA valuation "ready" once a current-lifecycle valuation artifact exists,
            # even if it contains zero-only output (no structural damage cases).
            "valuation_ready": bool(damage_state["current_valuation_ready"]) or has_current_da_artifact,
            "part_count": damage_state["current_part_count"],
        },
        "claim_evaluation": {
            "available": bool(
                damage_assessment_completed
                and (
                    bool(damage_state["current_valuation_ready"])
                    or has_current_da_artifact
                )
            ),
            "completed": claim_evaluation_completed,
            "visible": claim_evaluation_completed,
            "financials_ready": (
                damage_assessment_completed
                and (
                    bool(damage_state["current_valuation_ready"])
                    or has_current_da_artifact
                )
            ),
        },
    }
    snapshot.update(
        workflow_ui_for_state(workflow_state, business_rules_passed=business_rules_passed)
    )
    return snapshot


def build_claim_workflow_snapshot_for_list(
    complaint_id: str,
    fnol: FnolClaim | None,
    latest_eval: ClaimEvaluationResponse | None,
    damage_state: dict[str, int | bool],
    workflow_state: str,
) -> dict:
    """
    Snapshot for GET /api/fnol list rows — matches detail snapshot shape without
    running sync_claim_evaluation_decision_state (avoids N heavy calls per page).
    """
    business_rules_passed = None
    if latest_eval:
        latest_status = (latest_eval.claim_status or "").strip().lower()
        if (
            "validation-pass" in latest_status
            or latest_status
            in {
                "pending damage detection",
                "pending_damage_detection",
            }
            or claim_status_implies_recommendation_terminal(latest_eval.claim_status)
        ):
            business_rules_passed = True
        elif "validation-fail" in latest_status or latest_status in {
            "fraudulent",
            "rejected",
        }:
            business_rules_passed = False

    damage_assessment_completed = workflow_state in (
        "DAMAGE_ASSESSMENT_COMPLETED",
        "RECOMMENDATION_SHARED",
    )
    damage_assessment_available = business_rules_passed is True
    has_current_da_artifact = bool(damage_state.get("has_current_da_artifact"))
    claim_evaluation_completed = bool(
        damage_assessment_completed
        and bool(damage_state["current_valuation_ready"])
        and workflow_state == "RECOMMENDATION_SHARED"
    )

    snapshot = {
        "workflow_state": workflow_state,
        "business_rule_validation": {
            "completed": latest_eval is not None,
            "visible": latest_eval is not None,
            "run_allowed": fnol is not None,
            "passed": business_rules_passed,
        },
        "damage_assessment": {
            "available": damage_assessment_available,
            "completed": damage_assessment_completed,
            "visible": damage_assessment_completed,
            "run_allowed": damage_assessment_available,
            "valuation_ready": bool(damage_state["current_valuation_ready"]) or has_current_da_artifact,
            "part_count": damage_state["current_part_count"],
        },
        "claim_evaluation": {
            "available": bool(
                damage_assessment_completed
                and (
                    bool(damage_state["current_valuation_ready"])
                    or has_current_da_artifact
                )
            ),
            "completed": claim_evaluation_completed,
            "visible": claim_evaluation_completed,
            "financials_ready": (
                damage_assessment_completed
                and (
                    bool(damage_state["current_valuation_ready"])
                    or has_current_da_artifact
                )
            ),
        },
    }
    snapshot.update(
        workflow_ui_for_state(workflow_state, business_rules_passed=business_rules_passed)
    )
    return snapshot
