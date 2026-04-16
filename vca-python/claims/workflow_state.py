"""
Derive claim workflow lifecycle from persisted rows (single source of truth for API + UI).

States are aligned with product semantics: NOT_STARTED means no business-rule
evaluation row exists yet; BRV completion is implied by that row; DA completion
requires persisted damage-assessment evidence rather than terminal status labels.
"""

from __future__ import annotations

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Max

from claims.models import (
    ClaimEvaluationResponse,
    ClaimPhase1Valuation,
    DamagePartAssessment,
    FnolClaim,
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
        }

    evaluation_started_at = latest_eval.created_date
    parts_qs = DamagePartAssessment.objects.filter(complaint=fnol)
    valuations_qs = ClaimPhase1Valuation.objects.filter(complaint=fnol)

    current_part_count = parts_qs.filter(created_at__gte=evaluation_started_at).count()
    current_valuation_ready = valuations_qs.filter(
        updated_at__gte=evaluation_started_at
    ).exists()

    # Safety net: if timestamps are unexpectedly null/legacy on either table,
    # fall back to the most recent evidence timestamp instead of surfacing stale
    # rows from older runs.
    if current_part_count == 0 and not current_valuation_ready:
        latest_damage_row_at = parts_qs.aggregate(latest=Max("created_at"))["latest"]
        latest_valuation_row_at = valuations_qs.aggregate(latest=Max("updated_at"))[
            "latest"
        ]
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
            current_valuation_ready = valuations_qs.exists()

    return {
        "current_part_count": current_part_count,
        "current_valuation_ready": current_valuation_ready,
        "has_current_evidence": bool(current_part_count or current_valuation_ready),
    }


def compute_claim_workflow_state(complaint_id: str) -> str:
    """
    Returns one of:
      NOT_STARTED
      BUSINESS_RULE_VALIDATION_COMPLETED
      DAMAGE_ASSESSMENT_IN_PROGRESS
      DAMAGE_ASSESSMENT_COMPLETED

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
    fnol_status = effective_claim_status(fnol, latest).lower()

    damage_state = current_damage_assessment_persistence_state(fnol, latest)

    if damage_state["has_current_evidence"]:
        return "DAMAGE_ASSESSMENT_COMPLETED"

    if fnol_status in ("pending damage detection", "pending_damage_detection"):
        return "DAMAGE_ASSESSMENT_IN_PROGRESS"

    return "BUSINESS_RULE_VALIDATION_COMPLETED"


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
        if "validation-pass" in latest_status or latest_status in {
            "pending damage detection",
            "pending_damage_detection",
        }:
            business_rules_passed = True
        elif "validation-fail" in latest_status or latest_status in {
            "fraudulent",
            "rejected",
        }:
            business_rules_passed = False

    damage_assessment_completed = workflow_state == "DAMAGE_ASSESSMENT_COMPLETED"
    damage_assessment_available = business_rules_passed is True
    claim_evaluation_completed = bool(
        damage_assessment_completed
        and isinstance(decision_summary, dict)
        and decision_summary.get("approval_state")
        in {
            "straight_through_eligible",
            "manual_review_required",
            "rejected",
        }
    )

    return {
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
            "valuation_ready": damage_state["current_valuation_ready"],
            "part_count": damage_state["current_part_count"],
        },
        "claim_evaluation": {
            "available": damage_assessment_completed,
            "completed": claim_evaluation_completed,
            "visible": claim_evaluation_completed,
            "financials_ready": (
                damage_assessment_completed
                and damage_state["current_valuation_ready"]
            ),
        },
    }
