"""
Deterministic image-authenticity label classification for persisted fraud rows.

This is intentionally heuristic and grounded only on stored signals:
- EXIF presence / warnings
- optional LLM authenticity notes
- fraud / ELA scores

It does not claim forensic certainty; labels are UI-facing review aids.
"""

from __future__ import annotations

import re
from typing import Any

LABELS: dict[str, dict[str, str]] = {
    "genuine": {
        "code": "genuine",
        "label": "Likely genuine",
        "tone": "green",
    },
    "edited": {
        "code": "edited",
        "label": "Edited / manipulated",
        "tone": "amber",
    },
    "ai_generated": {
        "code": "ai_generated",
        "label": "AI-generated",
        "tone": "violet",
    },
    "stock_internet_sourced": {
        "code": "stock_internet_sourced",
        "label": "Stock / internet-sourced",
        "tone": "sky",
    },
    "metadata_stripped": {
        "code": "metadata_stripped",
        "label": "Screenshot / metadata-stripped",
        "tone": "slate",
    },
    "staged": {
        "code": "staged",
        "label": "Likely staged",
        "tone": "rose",
    },
    "needs_review": {
        "code": "needs_review",
        "label": "Needs review",
        "tone": "yellow",
    },
}

_AI_GENERATED_RE = re.compile(
    r"\b(ai[- ]generated|synthetic|computer[- ]generated|cgi|rendered|midjourney|dall[ -]?e|stable diffusion)\b",
    re.IGNORECASE,
)
_STOCK_RE = re.compile(
    r"\b(stock(?:\s+imag(?:e|ery))?|internet[- ]sourced|reverse image|watermark|catalog imag(?:e|ery)|web image|online source)\b",
    re.IGNORECASE,
)
_METADATA_RE = re.compile(
    r"\b(no exif|metadata[- ]stripped|stripped metadata|screenshot|screen capture|screen grab|downloaded image|missing exif|empty exif)\b",
    re.IGNORECASE,
)
# Intentionally excludes broad "manipulation" wording (e.g. "potential manipulation")
# so LLM review copy does not trip the edited label when describing visible real damage.
_EDITED_RE = re.compile(
    r"\b(edit(?:ed|ing)?|photoshop|lightroom|gimp|canva|pixelmator|overlay|composite|"
    r"digitally\s+altered|tamper(?:ed|ing)?|altered)\b",
    re.IGNORECASE,
)
_STAGED_RE = re.compile(
    r"\b(staged|posed|set up|arranged scene|stock imagery or staged|appears staged)\b",
    re.IGNORECASE,
)
_GENUINE_RE = re.compile(
    r"\b(genuine|authentic|real damage|likely genuine|appears genuine|appears authentic|consistent with (?:a )?(?:collision|impact|incident))\b",
    re.IGNORECASE,
)


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def _warnings(exif_json: dict[str, Any] | None) -> list[str]:
    if not isinstance(exif_json, dict):
        return []
    raw = exif_json.get("warnings")
    if not isinstance(raw, list):
        return []
    return [_normalize_text(item) for item in raw if _normalize_text(item)]


def _add_label(out: list[dict[str, str]], code: str) -> None:
    if code not in LABELS:
        return
    if any(item.get("code") == code for item in out):
        return
    out.append(dict(LABELS[code]))


def classify_image_authenticity_labels(
    *,
    exif_json: dict[str, Any] | None,
    llm_notes: str | None,
    fraud_score: float | int | None,
    ela_score: float | int | None,
    signals_json: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """
    Return ordered authenticity labels for one image fraud result row.

    Labels are additive because one image can be both likely genuine and
    metadata-stripped, or both stock-like and staged.
    """

    warnings = _warnings(exif_json)
    software = _normalize_text((exif_json or {}).get("software"))
    llm_notes_text = _normalize_text(llm_notes)
    signal_blob = _normalize_text(signals_json) if signals_json else ""
    exif_present = None
    if isinstance(exif_json, dict) and "exif_present" in exif_json:
        exif_present = bool(exif_json.get("exif_present"))

    combined_text = " ".join(
        segment
        for segment in [llm_notes_text, software, signal_blob, *warnings]
        if segment
    )

    labels: list[dict[str, str]] = []

    if _AI_GENERATED_RE.search(combined_text):
        _add_label(labels, "ai_generated")
    if _STOCK_RE.search(combined_text):
        _add_label(labels, "stock_internet_sourced")
    if exif_present is False or _METADATA_RE.search(combined_text):
        _add_label(labels, "metadata_stripped")
    if software and _EDITED_RE.search(software):
        _add_label(labels, "edited")
    elif _EDITED_RE.search(combined_text):
        _add_label(labels, "edited")
    if _STAGED_RE.search(combined_text):
        _add_label(labels, "staged")
    if _GENUINE_RE.search(combined_text):
        _add_label(labels, "genuine")

    try:
        fraud = float(fraud_score) if fraud_score is not None else None
    except (TypeError, ValueError):
        fraud = None
    try:
        ela = float(ela_score) if ela_score is not None else None
    except (TypeError, ValueError):
        ela = None

    if not labels:
        low_signal = (fraud is None or fraud <= 25.0) and (ela is None or ela <= 10.0)
        if low_signal and not warnings and exif_present is not False:
            _add_label(labels, "genuine")
        elif exif_present is False or warnings:
            _add_label(labels, "metadata_stripped")
        else:
            _add_label(labels, "needs_review")

    if (
        fraud is not None
        and fraud >= 60.0
        and not any(item["code"] == "needs_review" for item in labels)
        and not any(
            item["code"]
            in {
                "ai_generated",
                "stock_internet_sourced",
                "edited",
                "staged",
            }
            for item in labels
        )
    ):
        _add_label(labels, "needs_review")

    return labels
