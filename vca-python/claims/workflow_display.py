"""
Single source for workflow stage *presentation* (list/detail badges) and for
detecting evaluation claim_status values that imply the recommendation phase.

Machine keys stay in `workflow_state` (e.g. RECOMMENDATION_SHARED). Human labels
and badge tones are emitted on `workflow_snapshot` so the React app does not
duplicate product strings.
"""

from __future__ import annotations

# Canonical machine states -> (list/detail label, StatusBadge-compatible tone).
# Unknown / future states fall back to title-cased `workflow_state` in workflow_ui_for_state().
_CANONICAL_WORKFLOW_UI: dict[str, tuple[str, str]] = {
    "NOT_STARTED": ("FNOL", "default"),
    "DAMAGE_ASSESSMENT_IN_PROGRESS": ("DA Running…", "pending"),
    "DAMAGE_ASSESSMENT_COMPLETED": ("Recommendation Shared", "approved"),
    "RECOMMENDATION_SHARED": ("Recommendation Shared", "approved"),
}

_WORKFLOW_SORT_ORDER: dict[str, int] = {
    "NOT_STARTED": 0,
    "BUSINESS_RULE_VALIDATION_COMPLETED": 1,
    "DAMAGE_ASSESSMENT_IN_PROGRESS": 2,
    "DAMAGE_ASSESSMENT_COMPLETED": 3,
    "RECOMMENDATION_SHARED": 4,
}


def _recommendation_phase_status_aliases() -> frozenset[str]:
    """
    Normalized (lower, collapsed whitespace) status_name values from ClaimStatus
    whose names indicate the recommendation / report-shared phase.

    Queried at call time (no cross-request cache) so tests and migrations stay correct.

    Empty when the table is unavailable (e.g. some tests); callers use a safe fallback.
    """
    try:
        from claims.models import ClaimStatus

        rows = ClaimStatus.objects.filter(status_name__icontains="recommendation").values_list(
            "status_name", flat=True
        )
        return frozenset(
            " ".join((row or "").strip().lower().split()) for row in rows if row and str(row).strip()
        )
    except Exception:
        return frozenset()


def claim_status_implies_recommendation_terminal(raw: str | None) -> bool:
    """
    True when a persisted claim_status string (evaluation or FK) matches a
    ClaimStatus row that names a recommendation-type phase, with substring
    fallback only when the DB yields no such rows (tests / minimal fixtures).
    """
    if not raw or not str(raw).strip():
        return False
    key = " ".join(str(raw).strip().lower().split())
    aliases = _recommendation_phase_status_aliases()
    if aliases:
        return key in aliases
    return "recommendation" in key


def workflow_ui_for_state(
    workflow_state: str | None,
    *,
    business_rules_passed: bool | None = None,
) -> dict[str, str | int]:
    """
    UI fields appended to workflow_snapshot for API consumers.

    `workflow_badge_tone` must stay aligned with the React StatusBadge variant union.

    For ``BUSINESS_RULE_VALIDATION_COMPLETED``, pass ``business_rules_passed`` so the list
    shows **Business Rule Validation Passed** vs **Failed** instead of the opaque "BRV" label.
    """
    ws = (workflow_state or "NOT_STARTED").strip().upper()
    if ws == "BUSINESS_RULE_VALIDATION_COMPLETED":
        if business_rules_passed is False:
            label, tone = ("Business Rule Validation Failed", "rejected")
        else:
            # True or unknown: treat as passed (evaluation row absent still means completed run).
            label, tone = ("Business Rule Validation Passed", "processing")
        return {
            "workflow_display_label": label,
            "workflow_badge_tone": tone,
            "workflow_sort_order": int(_WORKFLOW_SORT_ORDER.get(ws, 99)),
        }
    label, tone = _CANONICAL_WORKFLOW_UI.get(ws, (ws.replace("_", " ").title(), "default"))
    return {
        "workflow_display_label": label,
        "workflow_badge_tone": tone,
        "workflow_sort_order": int(_WORKFLOW_SORT_ORDER.get(ws, 99)),
    }
