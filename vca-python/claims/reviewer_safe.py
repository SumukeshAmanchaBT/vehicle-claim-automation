from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_INTERNAL_REVIEWER_NOTE_PATTERNS = (
    "llm client not configured",
    "llm client not available",
    "analysis error",
    "traceback",
    "exception:",
)


def sanitize_reviewer_llm_notes(
    llm_notes: str | None,
    *,
    complaint_id: str | None = None,
    photo_path: str | None = None,
) -> str:
    """
    Hide technical/debug narratives from reviewer-facing payloads.

    Internal diagnostics still belong in logs, but claim reviewers should only
    see productized authenticity commentary.
    """
    normalized = str(llm_notes or "").strip()
    if not normalized:
        return ""

    lowered = normalized.lower()
    is_internal = any(pattern in lowered for pattern in _INTERNAL_REVIEWER_NOTE_PATTERNS)
    if not is_internal:
        return normalized

    logger.warning(
        "Suppressing internal authenticity note from reviewer payload",
        extra={
            "complaint_id": complaint_id,
            "photo_path": photo_path,
            "suppressed_note": normalized,
        },
    )
    return ""
