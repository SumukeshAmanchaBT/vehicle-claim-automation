"""
Grounded, claim-scoped evidence extraction for damage-assessment card insights.

No external AI calls — only ORM-backed fields that already exist in the database.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

from claims.models import (
    ClaimDuplicateCandidate,
    ClaimEvaluationResponse,
    ClaimPhase1Valuation,
    DamagePartAssessment,
    FnolClaim,
    FnolDamagePhoto,
    ImageFraudResult,
)
from claims.reviewer_safe import sanitize_reviewer_llm_notes
from claims.workflow_state import (
    current_lifecycle_started_at,
    duplicate_candidate_rows_for_claim_evaluation,
    image_fraud_rows_for_claim_evaluation,
    valuation_row_has_meaningful_output,
)


def _exif_warnings_from_row(exif_json: dict | None) -> list[str]:
    if not exif_json or not isinstance(exif_json, dict):
        return []
    w = exif_json.get("warnings")
    if isinstance(w, list):
        return [str(x) for x in w if x is not None]
    return []


def _row_missing_exif_signal(exif_json: dict | None) -> bool:
    """True when stored JSON indicates missing / absent EXIF (grounded on persisted fields only)."""
    if not exif_json or not isinstance(exif_json, dict):
        return True
    if exif_json.get("exif_present") is False:
        return True
    for w in _exif_warnings_from_row(exif_json):
        low = w.lower()
        if "no exif" in low or "exif data found" in low:
            return True
    return False


def _f(x: Decimal | float | int | None) -> float | None:
    if x is None:
        return None
    if isinstance(x, Decimal):
        return float(x)
    return float(x)


def parse_llm_damages_field(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    try:
        v = json.loads(raw)
        if isinstance(v, list):
            return [str(i) for i in v if i is not None]
        if isinstance(v, str):
            return [v]
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def _current_damage_rows(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
):
    qs = DamagePartAssessment.objects.filter(complaint=claim).order_by("id")
    started_at = current_lifecycle_started_at(latest_eval)
    if started_at is not None:
        qs = qs.filter(created_at__gte=started_at)
    return list(qs)


def _current_image_fraud_rows(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
):
    rows = image_fraud_rows_for_claim_evaluation(claim, latest_eval)
    return sorted(rows, key=lambda r: r.id)


def _current_duplicate_rows(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
):
    rows = duplicate_candidate_rows_for_claim_evaluation(claim, latest_eval)
    return sorted(rows, key=lambda r: r.id)


def _current_phase1_valuation(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
) -> ClaimPhase1Valuation | None:
    valuation = ClaimPhase1Valuation.objects.filter(complaint=claim).first()
    if not valuation or not valuation_row_has_meaningful_output(valuation):
        return None
    started_at = current_lifecycle_started_at(latest_eval)
    if started_at is not None and (
        valuation.updated_at is None or valuation.updated_at < started_at
    ):
        return None
    return valuation


def build_claim_context(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None = None,
) -> dict[str, Any]:
    """
    Stable, hashable context for snapshot hashing (counts and ids only).

    Intentionally separate from `claims.card_analyzers.build_claim_context_block`,
    which exposes reviewer-facing FNOL fields for the UI and must not be reused
    for persistence digests.
    """
    complaint_id = claim.complaint_id
    photo_ids = list(
        FnolDamagePhoto.objects.filter(complaint=claim)
        .order_by("id")
        .values_list("id", flat=True)
    )
    if latest_eval is None:
        latest_eval = (
            ClaimEvaluationResponse.objects.filter(
                complaint_id=complaint_id, is_latest=True
            )
            .only("id", "version", "updated_date")
            .first()
        )
    fraud_ids = [row.id for row in _current_image_fraud_rows(claim, latest_eval)]
    dup_ids = [row.id for row in _current_duplicate_rows(claim, latest_eval)]
    part_ids = [row.id for row in _current_damage_rows(claim, latest_eval)]
    has_valuation = _current_phase1_valuation(claim, latest_eval) is not None

    return {
        "complaint_id": complaint_id,
        "photo_ids": photo_ids,
        "latest_evaluation_id": latest_eval.id if latest_eval else None,
        "latest_evaluation_version": latest_eval.version if latest_eval else None,
        "image_fraud_result_ids": fraud_ids,
        "duplicate_candidate_ids": dup_ids,
        "damage_part_assessment_ids": part_ids,
        "has_phase1_valuation": has_valuation,
    }


def _image_authenticity_facts(claim: FnolClaim, latest_eval: ClaimEvaluationResponse | None):
    photos = list(FnolDamagePhoto.objects.filter(complaint=claim).order_by("id"))
    fraud_rows = sorted(
        _current_image_fraud_rows(claim, latest_eval),
        key=lambda row: (row.created_at is not None, row.created_at, row.id),
        reverse=True,
    )
    scores = [float(r.fraud_score) for r in fraud_rows if r.fraud_score is not None]
    all_warnings: list[str] = []
    missing_exif = 0
    per_detailed: list[dict[str, Any]] = []
    llm_notes_samples: list[str] = []
    for r in fraud_rows[:50]:
        ej = r.exif_json if isinstance(r.exif_json, dict) else None
        if _row_missing_exif_signal(ej):
            missing_exif += 1
        warns = _exif_warnings_from_row(ej)
        for w in warns:
            if w not in all_warnings:
                all_warnings.append(w)
        preview = "; ".join(warns[:2]) if warns else None
        per_detailed.append(
            {
                "id": r.id,
                "photo_path": r.photo_path or None,
                "fraud_score": _f(r.fraud_score),
                "ela_score": float(r.ela_score) if r.ela_score is not None else None,
                "has_exif_json": r.exif_json is not None,
                "exif_warnings_preview": preview,
            }
        )
        note = sanitize_reviewer_llm_notes(
            r.llm_authenticity_notes,
            complaint_id=claim.complaint_id,
            photo_path=r.photo_path,
        )
        if note and note not in llm_notes_samples:
            llm_notes_samples.append(note[:400])

    return {
        "photo_count": len(photos),
        "photo_ids": [p.id for p in photos],
        "fraud_results_count": len(fraud_rows),
        "fraud_result_ids": [r.id for r in fraud_rows],
        "avg_fraud_score": round(sum(scores) / len(scores), 2) if scores else None,
        "max_fraud_score": round(max(scores), 2) if scores else None,
        "high_risk_count": sum(1 for s in scores if s >= 60),
        "evaluation_damage_confidence": _f(latest_eval.damage_confidence)
        if latest_eval
        else None,
        "evaluation_llm_severity": (latest_eval.llm_severity or "").strip() or None
        if latest_eval
        else None,
        "exif_warning_stats": {
            "photos_with_missing_or_empty_exif": missing_exif,
            "distinct_warning_samples": all_warnings[:20],
        },
        "per_image_detailed": per_detailed,
        "llm_notes_samples": llm_notes_samples[:5],
    }


def _duplicate_screening_facts(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
):
    from damage_detection_llm.image_fraud_service import get_duplicate_detection_settings

    candidates = sorted(
        _current_duplicate_rows(claim, latest_eval),
        key=lambda row: (
            float(row.similarity_score or 0),
            row.created_at is not None,
            row.created_at,
            row.id,
        ),
        reverse=True,
    )
    settings = get_duplicate_detection_settings()
    photo_count = FnolDamagePhoto.objects.filter(complaint=claim).count()
    has_image_hash_fingerprints = any(
        bool((row.p_hash or "").strip())
        for row in _current_image_fraud_rows(claim, latest_eval)
    )

    policy_overlap = 0
    pn = (claim.policy_number or "").strip()
    if pn:
        policy_overlap = (
            FnolClaim.objects.filter(policy_number=pn)
            .exclude(complaint_id=claim.complaint_id)
            .count()
        )

    reg_overlap = 0
    reg = (claim.vehicle_registration_number or "").strip()
    if reg:
        reg_overlap = (
            FnolClaim.objects.filter(vehicle_registration_number=reg)
            .exclude(complaint_id=claim.complaint_id)
            .count()
        )

    return {
        "photo_count": photo_count,
        "has_image_hash_fingerprints": has_image_hash_fingerprints,
        "same_policy_other_claims_count": policy_overlap,
        "same_registration_other_claims_count": reg_overlap,
        "candidate_count": len(candidates),
        "duplicate_detection_settings": settings,
        "candidates": [
            {
                "id": c.id,
                "other_complaint_id": c.other_complaint_id,
                "match_reason": c.match_reason,
                "similarity_score": _f(c.similarity_score),
                "evidence": c.evidence_json,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in candidates[:100]
        ],
    }


def _estimated_value_facts(claim: FnolClaim, latest_eval: ClaimEvaluationResponse | None):
    from damage_detection_llm.valuation_service import (
        calculate_excess,
        calculate_net_payable,
        get_excess_settings,
    )

    parts = sorted(
        _current_damage_rows(claim, latest_eval),
        key=lambda row: (row.sort_order, row.id),
    )
    parts_total = sum(float(p.estimated_amount or 0) for p in parts)
    valuation_row = _current_phase1_valuation(claim, latest_eval)
    gross = None
    excess = None
    net = None
    currency = None
    source = "none"

    if valuation_row and valuation_row.gross_estimate is not None:
        gross = _f(valuation_row.gross_estimate)
        excess = _f(valuation_row.excess_amount)
        net = _f(valuation_row.net_payable)
        currency = (valuation_row.currency_code or "").strip() or None
        source = "claim_phase1_valuation"
    elif parts_total > 0:
        gross = round(parts_total, 2)
        excess_decimal = calculate_excess(Decimal(str(parts_total)), get_excess_settings())
        net_decimal = calculate_net_payable(Decimal(str(parts_total)), excess_decimal)
        excess = float(excess_decimal)
        net = float(net_decimal)
        currency = None
        source = "calculated_from_parts"

    return {
        "part_count": len(parts),
        "parts_total_from_rows": round(parts_total, 2),
        "gross_estimate": gross,
        "excess_amount": excess,
        "net_payable": net,
        "currency_code": currency,
        "valuation_source": source,
        "fnol_excess_amount": _f(claim.excess_amount),
        "evaluation_claim_amount": _f(latest_eval.claim_amount) if latest_eval else None,
        "evaluation_estimated_amount": _f(latest_eval.estimated_amount)
        if latest_eval
        else None,
        "evaluation_threshold_value": latest_eval.threshold_value if latest_eval else None,
        "evaluation_claim_type": (latest_eval.claim_type or "").strip() or None
        if latest_eval
        else None,
        "evaluation_decision": (latest_eval.decision or "").strip() or None
        if latest_eval
        else None,
    }


def _damage_detection_facts(claim: FnolClaim, latest_eval: ClaimEvaluationResponse | None):
    parts = sorted(
        _current_damage_rows(claim, latest_eval),
        key=lambda row: (row.sort_order, row.id),
    )
    total = sum(float(p.estimated_amount or 0) for p in parts)
    llm_damages = parse_llm_damages_field(latest_eval.llm_damages) if latest_eval else []
    inc = (claim.incident_description or "").strip() or None
    return {
        "part_count": len(parts),
        "total_estimated_cost": round(total, 2),
        "incident_description_present": bool(inc),
        "llm_damages": llm_damages,
        "llm_severity": (latest_eval.llm_severity or "").strip() or None
        if latest_eval
        else None,
        "evaluation_damage_confidence": _f(latest_eval.damage_confidence)
        if latest_eval
        else None,
        "parts": [
            {
                "part_name": p.part_name,
                "damage_type": p.damage_type or None,
                "severity_percent": _f(p.severity_percent),
                "repair_action": p.repair_action or None,
                "estimated_amount": _f(p.estimated_amount),
            }
            for p in parts[:200]
        ],
    }


def build_card_evidence_bundle(
    claim: FnolClaim,
    card_key: str,
    latest_eval: ClaimEvaluationResponse | None,
) -> dict[str, Any]:
    """Return the full internal evidence bundle (analyzers read this)."""
    if card_key == "image_authenticity":
        return {"kind": "image_authenticity", "data": _image_authenticity_facts(claim, latest_eval)}
    if card_key == "duplicate_screening":
        return {"kind": "duplicate_screening", "data": _duplicate_screening_facts(claim, latest_eval)}
    if card_key == "estimated_value":
        return {"kind": "estimated_value", "data": _estimated_value_facts(claim, latest_eval)}
    if card_key == "damage_detection":
        return {"kind": "damage_detection", "data": _damage_detection_facts(claim, latest_eval)}
    return {"kind": "unknown", "data": {}}


def _truncate_json_value(val: Any, max_chars: int = 800) -> Any:
    """Bound arbitrary JSON (e.g. duplicate candidate evidence) for API exposure."""
    if val is None:
        return None
    if isinstance(val, (bool, int, float)):
        return val
    if isinstance(val, str):
        return val[:max_chars] + ("…" if len(val) > max_chars else "")
    try:
        s = json.dumps(val, default=str, sort_keys=True)
    except (TypeError, ValueError):
        return None
    if len(s) <= max_chars:
        return json.loads(s) if s.startswith(("{", "[")) else s
    return s[: max_chars - 1] + "…"


def build_public_raw_evidence_bundle(raw: dict[str, Any]) -> dict[str, Any]:
    """
    Bounded, stable subset of the internal evidence bundle for API + persistence.

    Internal `build_card_evidence_bundle` may include more rows than this; analyzers
    use the full bundle. Prompt 3 / UI should prefer this shape for grounding.
    """
    kind = raw.get("kind") or "unknown"
    data = raw.get("data")
    if not isinstance(data, dict):
        return {"kind": kind, "facts_schema_version": 1, "data": {}}

    out: dict[str, Any] = {"kind": kind, "facts_schema_version": 1, "data": {}}
    d = out["data"]

    if kind == "image_authenticity":
        stats = data.get("exif_warning_stats") or {}
        if not isinstance(stats, dict):
            stats = {}
        samples = stats.get("distinct_warning_samples") or []
        if isinstance(samples, list):
            samples = [str(x)[:300] for x in samples[:15]]
        d.update(
            {
                "photo_count": data.get("photo_count"),
                "fraud_results_count": data.get("fraud_results_count"),
                "avg_fraud_score": data.get("avg_fraud_score"),
                "max_fraud_score": data.get("max_fraud_score"),
                "high_risk_count": data.get("high_risk_count"),
                "evaluation_damage_confidence": data.get("evaluation_damage_confidence"),
                "evaluation_llm_severity": data.get("evaluation_llm_severity"),
                "exif_warning_stats": {
                    "photos_with_missing_or_empty_exif": stats.get(
                        "photos_with_missing_or_empty_exif"
                    ),
                    "distinct_warning_samples": samples,
                },
                "per_image_detailed": (data.get("per_image_detailed") or [])[:25],
                "llm_notes_samples": (data.get("llm_notes_samples") or [])[:5],
            }
        )
    elif kind == "duplicate_screening":
        settings = data.get("duplicate_detection_settings")
        if isinstance(settings, dict):
            d["duplicate_detection_settings"] = {
                k: settings.get(k)
                for k in (
                    "phash_threshold",
                    "dhash_threshold",
                    "require_both_non_exact",
                    "sensitivity_label",
                    "match_policy_label",
                )
                if k in settings
            }
        else:
            d["duplicate_detection_settings"] = None
        cand_in = data.get("candidates") or []
        cand_out = []
        if isinstance(cand_in, list):
            for c in cand_in[:40]:
                if not isinstance(c, dict):
                    continue
                cand_out.append(
                    {
                        "id": c.get("id"),
                        "other_complaint_id": c.get("other_complaint_id"),
                        "match_reason": c.get("match_reason"),
                        "similarity_score": c.get("similarity_score"),
                        "created_at": c.get("created_at"),
                        "evidence": _truncate_json_value(c.get("evidence")),
                    }
                )
        d.update(
            {
                "photo_count": data.get("photo_count"),
                "has_image_hash_fingerprints": data.get("has_image_hash_fingerprints"),
                "same_policy_other_claims_count": data.get("same_policy_other_claims_count"),
                "same_registration_other_claims_count": data.get(
                    "same_registration_other_claims_count"
                ),
                "candidate_count": data.get("candidate_count"),
                "candidates": cand_out,
            }
        )
    elif kind == "estimated_value":
        d.update(
            {
                "part_count": data.get("part_count"),
                "parts_total_from_rows": data.get("parts_total_from_rows"),
                "gross_estimate": data.get("gross_estimate"),
                "excess_amount": data.get("excess_amount"),
                "net_payable": data.get("net_payable"),
                "currency_code": data.get("currency_code"),
                "valuation_source": data.get("valuation_source"),
                "fnol_excess_amount": data.get("fnol_excess_amount"),
                "evaluation_claim_amount": data.get("evaluation_claim_amount"),
                "evaluation_estimated_amount": data.get("evaluation_estimated_amount"),
                "evaluation_threshold_value": data.get("evaluation_threshold_value"),
                "evaluation_claim_type": data.get("evaluation_claim_type"),
                "evaluation_decision": data.get("evaluation_decision"),
            }
        )
    elif kind == "damage_detection":
        d.update(
            {
                "part_count": data.get("part_count"),
                "total_estimated_cost": data.get("total_estimated_cost"),
                "incident_description_present": data.get("incident_description_present"),
                "llm_damages": (data.get("llm_damages") or [])[:40]
                if isinstance(data.get("llm_damages"), list)
                else data.get("llm_damages"),
                "llm_severity": data.get("llm_severity"),
                "evaluation_damage_confidence": data.get("evaluation_damage_confidence"),
                "parts": (data.get("parts") or [])[:60],
            }
        )
    else:
        out["data"] = {}

    return out
