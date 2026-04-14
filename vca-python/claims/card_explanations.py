"""
Optional AI narrative layer for damage-assessment card **details** only.

Grounding rule: summarization may use only the fields assembled by analyzers into the
detail payload (metrics, evidence, caveats, unsupported_fields, raw_evidence_bundle
public shape, complaint_id, headline/status/title/card_key, confidence, claim_context).

Does not replace analyzer output; never persisted as source of truth for facts.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from claim_automation.llm_client import get_chat_completion_client_and_model, llm_configured

logger = logging.getLogger(__name__)

NARRATIVE_KEYS = frozenset(
    {"summary", "why_it_matters", "key_takeaways", "recommended_attention"}
)

MAX_SUMMARY_LEN = 900
MAX_RECOMMENDED_LEN = 450
MAX_BULLET_LEN = 280
MAX_BULLETS = 6
MAX_GROUNDED_JSON_CHARS = 14_000


def card_ai_narrative_enabled() -> bool:
    """LLM path only when explicitly enabled and a chat client is configured."""
    flag = (os.getenv("CARD_AI_NARRATIVE_ENABLED") or "").strip().lower()
    if flag not in ("1", "true", "yes"):
        return False
    return llm_configured()


def build_grounded_explanation_input(detail_payload: dict[str, Any]) -> dict[str, Any]:
    """Strict subset allowed into the model prompt (no hidden analyzer state)."""
    keys = (
        "complaint_id",
        "card_key",
        "title",
        "headline",
        "status",
        "confidence",
        "claim_context",
        "metrics",
        "evidence",
        "caveats",
        "unsupported_fields",
        "raw_evidence_bundle",
    )
    out: dict[str, Any] = {}
    for k in keys:
        if k in detail_payload:
            out[k] = detail_payload[k]
    return out


def _truncate_str(s: str, max_len: int) -> str:
    s = " ".join(s.split())
    if len(s) <= max_len:
        return s
    return s[: max_len - 1].rstrip() + "…"


def _normalize_string_list(val: Any, max_items: int, max_each: int) -> list[str]:
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val[:max_items]:
        if isinstance(item, str) and item.strip():
            out.append(_truncate_str(item.strip(), max_each))
    return out


def validate_and_normalize_narrative(obj: Any) -> dict[str, Any] | None:
    """Validate LLM (or other) JSON; return normalized dict or None."""
    if not isinstance(obj, dict):
        return None
    extra = set(obj.keys()) - NARRATIVE_KEYS
    if extra:
        obj = {k: obj[k] for k in NARRATIVE_KEYS if k in obj}
    summary = obj.get("summary")
    rec = obj.get("recommended_attention")
    if not isinstance(summary, str) or not isinstance(rec, str):
        return None
    summary = _truncate_str(summary.strip(), MAX_SUMMARY_LEN)
    rec = _truncate_str(rec.strip(), MAX_RECOMMENDED_LEN)
    why = _normalize_string_list(
        obj.get("why_it_matters"), MAX_BULLETS, MAX_BULLET_LEN
    )
    take = _normalize_string_list(
        obj.get("key_takeaways"), MAX_BULLETS, MAX_BULLET_LEN
    )
    if not summary or not rec:
        return None
    if not why:
        why = ["See caveats and evidence in the structured fields for this claim."]
    if not take:
        take = [
            "Evidence rows carry row-level audit context beyond what the headline states."
        ]
    return {
        "summary": summary,
        "why_it_matters": why,
        "key_takeaways": take,
        "recommended_attention": rec,
    }


def is_prompt3_narrative(n: Any) -> bool:
    return validate_and_normalize_narrative(n) is not None


def _recommended_attention_fallback(
    card_key: str, status: str, caveats: list[str], evidence: list[dict[str, Any]]
) -> str:
    st = (status or "").lower()
    if st == "failed":
        return (
            "Card data could not be fully built from persisted records; "
            "retry refresh or check operational logs before relying on this view."
        )
    etypes = {e.get("type") for e in evidence if isinstance(e, dict)}
    if card_key == "duplicate_screening" and "duplicate_candidate" in etypes:
        return (
            "Review persisted duplicate candidate rows and linked claims "
            "against your operational match policy."
        )
    if st in ("critical", "warning"):
        return (
            "Manual review of persisted evidence and metrics is recommended "
            "before decisions tied to this card."
        )
    if card_key == "duplicate_screening":
        if st == "partial":
            return (
                "Duplicate image screening is incomplete or not persisted; "
                "complete hashing/screening workflows when photos are available."
            )
        if st == "info" and caveats:
            return (
                "No duplicate candidates stored under current rules; "
                "treat overlap counts as administrative context only, not image proof."
            )
    if card_key == "image_authenticity":
        if st == "partial":
            return (
                "Image authenticity cannot be fully assessed from persisted analysis yet; "
                "run or await fraud pipeline processing."
            )
        if st == "info":
            return (
                "Persisted scores are modest but metadata coverage may be incomplete; "
                "corroborate with source images if material."
            )
    if card_key == "estimated_value":
        if st == "partial" or any(
            "incomplete" in c.lower() or "no gross" in c.lower() or "no part-level" in c.lower()
            for c in caveats
        ):
            return (
                "Valuation is incomplete or not fully grounded on part-level rows; "
                "obtain valuation snapshot or part assessments before settlement use."
            )
        return (
            "Cross-check gross, excess, and net figures against valuation source "
            "shown in evidence before finalizing amounts."
        )
    if card_key == "damage_detection":
        if st == "info":
            return (
                "Only coarse labels or evaluation text are available; "
                "structured part lines should be confirmed with engineering if needed."
            )
        if st == "partial":
            return (
                "Persisted damage structure is limited; "
                "capture part assessments or evaluation labels before relying on this alone."
            )
    if st == "clear":
        return (
            "No immediate manual-review signal from this card’s persisted evidence "
            "under current rules; re-check if new data arrives."
        )
    return (
        "Review structured metrics and evidence alongside this narrative; "
        "do not use this text as the sole decision basis."
    )


def _fallback_key_takeaways_grounded(
    card_key: str,
    evidence: list[Any],
    caveats: list[str],
    status: str,
) -> list[str]:
    """
    Grounded takeaways that do not echo the metrics table (metrics are shown separately in UI).
    Uses only evidence row types, caveat presence, and card_key — no invented facts.
    """
    out: list[str] = []
    etypes = {e.get("type") for e in evidence if isinstance(e, dict)}
    n_ev = len([e for e in evidence if isinstance(e, dict)])

    if card_key == "image_authenticity":
        if "per_image_score" in etypes or "exif_warning" in etypes:
            out.append(
                "Per-image fraud scores and EXIF warnings from stored runs are expanded in Evidence."
            )
        if "llm_authenticity_notes" in etypes:
            out.append(
                "Stored LLM authenticity notes (where present) appear as evidence rows for context."
            )
    elif card_key == "duplicate_screening":
        if "duplicate_candidate" in etypes:
            out.append(
                "Cross-claim duplicate candidates are listed in Evidence with match reasons and similarity scores."
            )
        if "policy_overlap" in etypes or "registration_overlap" in etypes:
            out.append(
                "Policy/registration overlap counts are administrative context only—not proof of image reuse."
            )
        if "screening_configuration" in etypes:
            out.append(
                "Persisted duplicate-detection settings are summarized in Evidence for auditability."
            )
    elif card_key == "estimated_value":
        if "valuation_snapshot" in etypes:
            out.append(
                "Valuation source rows in Evidence show whether amounts came from a stored valuation snapshot or part rollups."
            )
        if "evaluation_row" in etypes:
            out.append(
                "Latest evaluation amounts are cross-referenced in Evidence alongside analyzer totals."
            )
    elif card_key == "damage_detection":
        if "part_assessment" in etypes:
            out.append(
                "Structured part lines in Evidence carry repair actions and persisted amounts where available."
            )
        if "llm_damage_list" in etypes or "llm_severity" in etypes:
            out.append(
                "Coarse LLM damage tags and severity (if any) are surfaced in Evidence when part rows are thin."
            )

    if n_ev and len(out) < 2:
        out.append(
            _truncate_str(
                f"{n_ev} evidence row(s) below are grounded in persisted tables for review trails.",
                MAX_BULLET_LEN,
            )
        )
    if caveats and len(out) < 2:
        out.append(
            "Caveats above highlight coverage gaps; they do not replace the headline or metric table."
        )
    if len(out) < 2:
        out.append(
            _truncate_str(
                f"Card status is {status}; use Evidence for row-level detail beyond the summary card.",
                MAX_BULLET_LEN,
            )
        )

    seen: set[str] = set()
    deduped: list[str] = []
    for line in out:
        t = _truncate_str(line.strip(), MAX_BULLET_LEN)
        if t and t.lower() not in seen:
            seen.add(t.lower())
            deduped.append(t)
    return deduped[:MAX_BULLETS]


def fallback_narrative_from_grounded_payload(
    card_key: str, detail_payload: dict[str, Any]
) -> dict[str, Any]:
    """Deterministic narrative from grounded fields only (no LLM)."""
    complaint_id = detail_payload.get("complaint_id") or ""
    headline = (detail_payload.get("headline") or "").strip()
    status = detail_payload.get("status") or "partial"
    caveats = [c for c in (detail_payload.get("caveats") or []) if isinstance(c, str)]
    metrics = detail_payload.get("metrics") or []
    evidence = detail_payload.get("evidence") or []
    if not isinstance(metrics, list):
        metrics = []
    if not isinstance(evidence, list):
        evidence = []

    title = (detail_payload.get("title") or card_key.replace("_", " ")).strip()
    summary_core = (
        f"Claim {complaint_id}: {title}. {headline}"
        if headline
        else f"Claim {complaint_id}: {title} (see metrics for on-file facts)."
    )
    if caveats:
        summary_core += f" Limitations noted: {caveats[0]}"
    summary = _truncate_str(summary_core, MAX_SUMMARY_LEN)

    why_it_matters: list[str] = []
    for c in caveats[:MAX_BULLETS]:
        t = _truncate_str(c.strip(), MAX_BULLET_LEN)
        if t and t not in why_it_matters:
            why_it_matters.append(t)
    if not why_it_matters:
        why_it_matters.append(
            "Structured metrics and evidence carry the authoritative persisted facts for this card."
        )

    key_takeaways = _fallback_key_takeaways_grounded(
        card_key, evidence, caveats, status
    )

    rec = _recommended_attention_fallback(card_key, status, caveats, evidence)

    out = validate_and_normalize_narrative(
        {
            "summary": summary,
            "why_it_matters": why_it_matters,
            "key_takeaways": key_takeaways,
            "recommended_attention": rec,
        }
    )
    assert out is not None
    return out


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return obj if isinstance(obj, dict) else None


def _build_system_prompt() -> str:
    return (
        "You write concise operational summaries for motor insurance damage-assessment cards. "
        "Output a single JSON object ONLY, with exactly these keys: "
        '"summary" (string), "why_it_matters" (array of strings), '
        '"key_takeaways" (array of strings), "recommended_attention" (string). '
        "Rules: Use ONLY facts present in the user JSON. Do NOT invent or infer VIN, "
        "license plates, make/model, overlap counts, duplicate matches, part names, "
        "prices, amounts, or confidence values that are not explicitly in the input. "
        "If something is missing, say it is not shown in the provided data—do not guess. "
        "Do not accuse anyone of fraud; describe only persisted signals and statuses. "
        "Keep summary to 2–3 short sentences; bullets short (under 25 words each); "
        "no markdown, no code fences, no extra keys. "
        "Do not write key_takeaways as raw metric_key: value lines that repeat the metrics list; "
        "synthesize implications and review focus instead."
    )


def _build_user_prompt(card_key: str, grounded: dict[str, Any]) -> str:
    payload = json.dumps(grounded, sort_keys=True, default=str, separators=(",", ":"))
    if len(payload) > MAX_GROUNDED_JSON_CHARS:
        payload = payload[: MAX_GROUNDED_JSON_CHARS - 3] + "…"
    return f'card_key: "{card_key}"\ngrounded_json:\n{payload}'


def _call_llm_for_narrative(card_key: str, grounded: dict[str, Any]) -> dict[str, Any] | None:
    client, model = get_chat_completion_client_and_model()
    if client is None or not model:
        return None
    try:
        resp = client.chat.completions.create(
            model=model,
            temperature=0.2,
            max_tokens=650,
            messages=[
                {"role": "system", "content": _build_system_prompt()},
                {"role": "user", "content": _build_user_prompt(card_key, grounded)},
            ],
        )
        choice = resp.choices[0].message.content
        if not choice:
            return None
        obj = _extract_json_object(choice)
        return validate_and_normalize_narrative(obj)
    except Exception:
        logger.exception("card narrative LLM call failed for %s", card_key)
        return None


def generate_card_narrative(card_key: str, detail_payload: dict[str, Any]) -> dict[str, Any]:
    """
    Return validated narrative dict (LLM if enabled and successful, else fallback).
    Never raises.
    """
    if (detail_payload.get("status") or "").strip().lower() == "failed":
        return fallback_narrative_from_grounded_payload(card_key, detail_payload)

    grounded = build_grounded_explanation_input(detail_payload)
    if card_ai_narrative_enabled():
        llm_out = _call_llm_for_narrative(card_key, grounded)
        if llm_out is not None:
            return llm_out
    return fallback_narrative_from_grounded_payload(card_key, detail_payload)
