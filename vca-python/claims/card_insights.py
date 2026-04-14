"""
Damage-assessment card summary/detail builders and persistence helpers.

Uses deterministic analyzers (claims.card_analyzers) grounded in ORM data only.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from django.utils import timezone

from claims.card_analyzers import (
    map_display_status_to_insight_status,
    run_card_analyzer,
    run_card_analyzer_and_bundle,
)
from claims.card_explanations import (
    generate_card_narrative,
    is_prompt3_narrative,
    validate_and_normalize_narrative,
)
from claims.evidence_builders import build_claim_context, build_public_raw_evidence_bundle
from claims.models import ClaimCardInsight, ClaimEvaluationResponse, FnolClaim

logger = logging.getLogger(__name__)

# Bumped when persisted card JSON semantics change.
GROUNDED_CARD_MODEL_VERSION = "grounded_v2"

CARD_KEYS: tuple[str, ...] = (
    "image_authenticity",
    "duplicate_screening",
    "estimated_value",
    "damage_detection",
)


def normalize_card_key(raw: str | None) -> str | None:
    if not raw:
        return None
    key = raw.strip().lower().replace("-", "_")
    return key if key in CARD_KEYS else None


def compute_source_snapshot_hash(context: dict[str, Any]) -> str:
    payload = json.dumps(context, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _strip_analyzer_internal(analysis: dict[str, Any]) -> dict[str, Any]:
    """Drop analyzer-internal keys (``_*``) from API payloads."""
    return {k: v for k, v in analysis.items() if not k.startswith("_")}


def build_summary_from_analysis(
    analysis: dict[str, Any],
    insight: ClaimCardInsight | None = None,
) -> dict[str, Any]:
    """API summary row: derived from analyzer output only."""
    metrics = analysis.get("metrics") or []
    primary: dict[str, Any] = (
        metrics[0]
        if metrics
        else {"label": "not_available", "value": None}
    )
    secondary = list(metrics[1:5]) if len(metrics) > 1 else []
    last_gen = None
    if insight and insight.generated_at:
        last_gen = insight.generated_at.isoformat()
    return {
        "card_key": analysis["card_key"],
        "title": analysis["title"],
        "headline": (analysis.get("headline") or "")[:200],
        "status": analysis["status"],
        "primary_metric": primary,
        "secondary_metrics": secondary,
        "view_details_enabled": True,
        "last_generated_at": last_gen,
        "caveats": list(analysis.get("caveats") or []),
    }


def build_card_summary_payload(
    claim: FnolClaim,
    card_key: str,
    latest_evaluation: ClaimEvaluationResponse | None,
    insight: ClaimCardInsight | None = None,
) -> dict[str, Any]:
    analysis = run_card_analyzer(card_key, claim, latest_evaluation)
    return build_summary_from_analysis(analysis, insight=insight)


def build_card_details_payload(
    claim: FnolClaim,
    card_key: str,
    latest_evaluation: ClaimEvaluationResponse | None,
    insight: ClaimCardInsight | None = None,
) -> dict[str, Any]:
    raw, analysis = run_card_analyzer_and_bundle(
        card_key, claim, latest_evaluation
    )
    clean = _strip_analyzer_internal(analysis)

    ctx = build_claim_context(claim)
    ctx_digest = {
        "complaint_id": claim.complaint_id,
        "card_key": card_key,
        "analysis_metrics": clean.get("metrics"),
        "raw_kind": raw.get("kind"),
    }
    snap = compute_source_snapshot_hash(ctx_digest)

    insight_meta = None
    if insight:
        insight_meta = {
            "id": insight.id,
            "generated_at": insight.generated_at.isoformat()
            if insight.generated_at
            else None,
            "source_snapshot_hash": insight.source_snapshot_hash,
            "persisted_status": insight.status,
        }
        if insight.error_json:
            insight_meta["persisted_error"] = insight.error_json

    raw_public = build_public_raw_evidence_bundle(raw)
    detail_core: dict[str, Any] = {
        "complaint_id": claim.complaint_id,
        **clean,
        "raw_evidence_bundle": raw_public,
    }
    if (
        insight
        and insight.source_snapshot_hash == snap
        and is_prompt3_narrative(insight.narrative_json)
    ):
        normalized = validate_and_normalize_narrative(insight.narrative_json)
        narrative = normalized or generate_card_narrative(card_key, detail_core)
    else:
        narrative = generate_card_narrative(card_key, detail_core)

    return {
        "complaint_id": claim.complaint_id,
        **clean,
        "raw_evidence_bundle": raw_public,
        "narrative": narrative,
        "source_snapshot_hash": snap,
        "insight": insight_meta,
    }


def upsert_card_insight(
    claim: FnolClaim,
    card_key: str,
    latest_evaluation: ClaimEvaluationResponse | None,
) -> tuple[ClaimCardInsight, dict[str, Any]]:
    """Persist snapshot and return the same detail payload the API returns."""
    raw, analysis = run_card_analyzer_and_bundle(
        card_key, claim, latest_evaluation
    )
    clean = _strip_analyzer_internal(analysis)
    err_flag = bool(analysis.get("_analyzer_error"))

    ctx = build_claim_context(claim)
    ctx_digest = {
        "complaint_id": claim.complaint_id,
        "card_key": card_key,
        "analysis_metrics": clean.get("metrics"),
        "raw_kind": raw.get("kind"),
    }
    snap = compute_source_snapshot_hash(ctx_digest)

    temp_insight = ClaimCardInsight(
        claim=claim,
        card_key=card_key,
        generated_at=timezone.now(),
        source_snapshot_hash=snap,
    )
    summary_api = build_summary_from_analysis(analysis, insight=temp_insight)

    if err_flag:
        insight_status = ClaimCardInsight.Status.FAILED
        error_json = {
            "analyzer_error": True,
            "card_key": card_key,
            "error_code": analysis.get("_error_code") or "analyzer_error",
        }
        if analysis.get("_exception_type"):
            error_json["exception_type"] = analysis["_exception_type"]
    else:
        insight_status = map_display_status_to_insight_status(analysis["status"])
        error_json = {}

    detail_core: dict[str, Any] = {
        "complaint_id": claim.complaint_id,
        **clean,
        "raw_evidence_bundle": build_public_raw_evidence_bundle(raw),
    }
    narrative = generate_card_narrative(card_key, detail_core)
    raw_public = detail_core["raw_evidence_bundle"]
    evidence_json = {
        "analysis": clean,
        "raw_evidence_bundle": raw_public,
    }

    insight, _created = ClaimCardInsight.objects.update_or_create(
        claim=claim,
        card_key=card_key,
        defaults={
            "status": insight_status,
            "summary_json": summary_api,
            "evidence_json": evidence_json,
            "narrative_json": narrative,
            "source_snapshot_hash": snap,
            "model_version": GROUNDED_CARD_MODEL_VERSION,
            "generated_at": timezone.now(),
            "error_json": error_json,
        },
    )
    insight.refresh_from_db()
    detail = build_card_details_payload(
        claim, card_key, latest_evaluation, insight=insight
    )
    return insight, detail


def fallback_summary_card(claim: FnolClaim, card_key: str) -> dict[str, Any]:
    """Minimal summary if building a card raises unexpectedly (view-layer safety net)."""
    _ = claim
    return {
        "card_key": card_key,
        "title": card_key.replace("_", " ").title(),
        "headline": "Summary build failed unexpectedly",
        "status": "failed",
        "primary_metric": {"label": "summary_build_error", "value": None},
        "secondary_metrics": [],
        "view_details_enabled": True,
        "last_generated_at": None,
        "caveats": [
            "This card summary could not be built; see server logs. "
            "Other cards may still be valid."
        ],
    }
