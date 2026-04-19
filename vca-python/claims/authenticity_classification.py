"""
Deterministic image-authenticity label classification for persisted fraud rows.

This is intentionally heuristic and grounded only on stored signals:
- EXIF presence / warnings
- optional LLM authenticity notes
- fraud / ELA scores

It does not claim forensic certainty; labels are UI-facing review aids.

For new fraud analyses, call ``synthesize_image_authenticity_labels`` which
optionally invokes a lightweight 4o-mini text adjudication step when
contradictory signals are detected. The resolved labels are then stored in
``ImageFraudResult.signals_json["synthesized_labels"]`` and returned directly
by ``classify_image_authenticity_labels`` on subsequent serialisation calls.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

LABELS: dict[str, dict[str, str]] = {
    "genuine": {
        "code": "genuine",
        "label": "Genuine",
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
        "label": "Staged",
        "tone": "rose",
    },
    "needs_review": {
        "code": "needs_review",
        "label": "Needs review",
        "tone": "yellow",
    },
    "under_review": {
        "code": "under_review",
        "label": "Under review",
        "tone": "yellow",
    },
}

# Codes that are mutually contradictory with "genuine" — having any one of these
# alongside genuine indicates the genuine classification is not credible.
_DEFINITIVE_RISK_CODES: frozenset[str] = frozenset(
    {"ai_generated", "stock_internet_sourced", "edited", "staged", "needs_review"}
)

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


def _resolve_contradictions(labels: list[dict[str, str]]) -> list[dict[str, str]]:
    """
    Replace ``genuine`` with ``under_review`` when definitive risk codes are also
    present.  A genuine classification is not credible alongside strong risk
    signals such as stock/staged/edited/ai_generated or a high-score needs_review.
    ``metadata_stripped`` alone (missing EXIF) is not treated as a contradiction
    because real damage photos can lack EXIF data.
    """
    codes = {item["code"] for item in labels}
    if "genuine" not in codes:
        return labels
    risk_codes_present = codes & _DEFINITIVE_RISK_CODES
    if not risk_codes_present:
        return labels
    resolved = [item for item in labels if item["code"] != "genuine"]
    _add_label(resolved, "under_review")
    return resolved


def _classify_raw(
    *,
    exif_json: dict[str, Any] | None,
    llm_notes: str | None,
    fraud_score: float | int | None,
    ela_score: float | int | None,
    signals_json: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """
    Pure deterministic signal-to-label mapping, without pre-synthesised lookup or
    contradiction resolution.  Internal helper shared by
    ``classify_image_authenticity_labels`` and ``synthesize_image_authenticity_labels``.
    """
    warnings = _warnings(exif_json)
    software = _normalize_text((exif_json or {}).get("software"))
    llm_notes_text = _normalize_text(llm_notes)
    # Exclude synthesized_labels key from text blob to avoid false regex matches.
    signal_text_parts: list[str] = []
    if isinstance(signals_json, dict):
        safe_signals = {k: v for k, v in signals_json.items() if k != "synthesized_labels"}
        signal_text_parts.append(_normalize_text(safe_signals) if safe_signals else "")
    exif_present = None
    if isinstance(exif_json, dict) and "exif_present" in exif_json:
        exif_present = bool(exif_json.get("exif_present"))

    combined_text = " ".join(
        segment
        for segment in [llm_notes_text, software, *signal_text_parts, *warnings]
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
            item["code"] in {"ai_generated", "stock_internet_sourced", "edited", "staged"}
            for item in labels
        )
    ):
        _add_label(labels, "needs_review")

    return labels


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

    When ``signals_json`` contains a ``synthesized_labels`` key (written at
    analysis time by ``synthesize_image_authenticity_labels``), those labels are
    returned directly — the LLM adjudication result is already persisted.

    For legacy rows without that key the deterministic pipeline runs and
    ``_resolve_contradictions`` ensures no contradictory label pairs are emitted.
    """
    # Fast path: pre-synthesised labels stored at analysis time.
    if isinstance(signals_json, dict):
        pre = signals_json.get("synthesized_labels")
        if isinstance(pre, list) and pre:
            return pre

    labels = _classify_raw(
        exif_json=exif_json,
        llm_notes=llm_notes,
        fraud_score=fraud_score,
        ela_score=ela_score,
        signals_json=signals_json,
    )
    return _resolve_contradictions(labels)


# ---------------------------------------------------------------------------
# Optional 4o-mini adjudication for contradictory signal combos
# ---------------------------------------------------------------------------

_VALID_LABEL_CODES = frozenset(LABELS.keys())

_ADJUDICATION_SYSTEM_PROMPT = (
    "You are an insurance image fraud signal adjudicator. "
    "Given structured per-image analysis signals, determine the most accurate set "
    "of authenticity label codes. "
    "Valid codes: genuine, ai_generated, edited, stock_internet_sourced, "
    "metadata_stripped, staged, under_review, needs_review. "
    "Rules: "
    "1. Do NOT include 'genuine' alongside ai_generated, stock_internet_sourced, "
    "edited, or staged — these are mutually contradictory. "
    "2. Use 'under_review' when evidence is mixed or insufficient for a definitive "
    "risk classification. "
    "3. Only include labels directly supported by the signals provided. "
    "4. Do not invent new risk signals not present in the input. "
    "Respond ONLY with valid JSON: "
    '{"final_labels": ["code1", ...], "reasoning": "one sentence"}'
)


def _adjudicate_authenticity_with_llm(
    *,
    raw_labels: list[dict[str, str]],
    exif_json: dict[str, Any] | None,
    llm_notes: str | None,
    fraud_score: float | int | None,
    ela_score: float | int | None,
) -> list[dict[str, str]] | None:
    """
    Invoke the lightweight (4o-mini / ``profile='light'``) model to resolve
    contradictory authenticity signals.  Returns a resolved label list, or
    ``None`` if the call fails or is not configured.

    This is a text-only call — no image data is transmitted.
    """
    try:
        from claim_automation.llm_client import get_chat_completion_client_and_model

        client, model = get_chat_completion_client_and_model(profile="light")
        if not client:
            return None

        exif_present = None
        if isinstance(exif_json, dict) and "exif_present" in exif_json:
            exif_present = bool(exif_json.get("exif_present"))
        exif_warnings = _warnings(exif_json)

        signals_payload = {
            "detected_labels": [item["code"] for item in raw_labels],
            "fraud_score": float(fraud_score) if fraud_score is not None else None,
            "ela_score": float(ela_score) if ela_score is not None else None,
            "exif_present": exif_present,
            "exif_warnings": exif_warnings,
            "reviewer_notes_excerpt": (_normalize_text(llm_notes) or "")[:300],
        }

        user_message = (
            "Signals:\n"
            + json.dumps(signals_payload, indent=2)
            + "\n\nResolve the label set."
        )

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _ADJUDICATION_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            max_tokens=200,
            temperature=0.0,
        )

        content = response.choices[0].message.content or ""
        # Strip optional markdown fences
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()

        result = json.loads(content)
        final_codes = result.get("final_labels") or []
        if not isinstance(final_codes, list):
            return None

        resolved: list[dict[str, str]] = []
        for code in final_codes:
            if isinstance(code, str) and code in _VALID_LABEL_CODES:
                _add_label(resolved, code)
        return resolved if resolved else None

    except Exception:
        logger.debug("LLM authenticity adjudication failed", exc_info=True)
        return None


def synthesize_image_authenticity_labels(
    *,
    exif_json: dict[str, Any] | None,
    llm_notes: str | None,
    fraud_score: float | int | None,
    ela_score: float | int | None,
    signals_json: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """
    Compute final authenticity labels for a **new** fraud analysis, with optional
    4o-mini adjudication when contradictory signals are detected.

    Call this once at analysis time and store the result in
    ``ImageFraudResult.signals_json["synthesized_labels"]``.  Subsequent
    serialisation calls to ``classify_image_authenticity_labels`` will return the
    stored result directly without re-running the LLM.

    Falls back to deterministic ``_resolve_contradictions`` when the LLM is not
    configured or the call fails.
    """
    labels = _classify_raw(
        exif_json=exif_json,
        llm_notes=llm_notes,
        fraud_score=fraud_score,
        ela_score=ela_score,
        signals_json=signals_json,
    )

    codes = {item["code"] for item in labels}
    has_contradiction = "genuine" in codes and bool(codes & _DEFINITIVE_RISK_CODES)

    if not has_contradiction:
        return labels

    # Attempt LLM adjudication for contradictory signal combos.
    try:
        from claim_automation.llm_client import llm_configured

        if llm_configured("light"):
            adjudicated = _adjudicate_authenticity_with_llm(
                raw_labels=labels,
                exif_json=exif_json,
                llm_notes=llm_notes,
                fraud_score=fraud_score,
                ela_score=ela_score,
            )
            if adjudicated is not None:
                return adjudicated
    except Exception:
        logger.debug("Could not import llm_configured", exc_info=True)

    # Deterministic fallback: replace genuine with under_review.
    return _resolve_contradictions(labels)
