"""
Derive claim workflow lifecycle from persisted rows (single source of truth for API + UI).

States are aligned with product semantics: NOT_STARTED means no business-rule
evaluation row exists yet; BRV completion is implied by that row; DA completion
by valuation / part rows or terminal FNOL statuses.
"""

from __future__ import annotations

from django.core.exceptions import ObjectDoesNotExist

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

    valuation = (
        ClaimPhase1Valuation.objects.filter(complaint=fnol).first() if fnol else None
    )
    da_gross = float(valuation.gross_estimate or 0) if valuation else 0
    parts_exist = (
        DamagePartAssessment.objects.filter(complaint=fnol).exists() if fnol else False
    )

    if da_gross > 0 or parts_exist or fnol_status in (
        "closed damage detection",
        "recommendation shared",
    ):
        return "DAMAGE_ASSESSMENT_COMPLETED"

    if fnol_status in ("pending damage detection", "pending_damage_detection"):
        return "DAMAGE_ASSESSMENT_IN_PROGRESS"

    return "BUSINESS_RULE_VALIDATION_COMPLETED"
