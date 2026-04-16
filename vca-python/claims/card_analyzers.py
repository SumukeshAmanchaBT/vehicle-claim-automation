"""
Deterministic, grounded analyzers for damage-assessment API cards.

No external LLM calls. Output shape is stable for summaries and detail drawers.
"""

from __future__ import annotations

import logging
from typing import Any

from claims.evidence_builders import build_card_evidence_bundle
from claims.models import ClaimEvaluationResponse, FnolClaim
from claims.reviewer_safe import sanitize_reviewer_llm_notes

logger = logging.getLogger(__name__)

# Display status for API (distinct from ClaimCardInsight.Status stored in DB)
DISPLAY_CLEAR = "clear"
DISPLAY_WARNING = "warning"
DISPLAY_CRITICAL = "critical"
DISPLAY_INFO = "info"
DISPLAY_PARTIAL = "partial"
DISPLAY_FAILED = "failed"


def _trim(text: str | None, max_len: int = 200) -> str | None:
    if not text:
        return None
    t = " ".join(str(text).split())
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + "…"


def build_claim_context_block(claim: FnolClaim) -> dict[str, Any]:
    """
    FNOL fields only — no inferred VIN or plate from make/model.

    Intentionally separate from `claims.evidence_builders.build_claim_context`,
    which is an ID/count snapshot used for persistence hashing rather than a
    reviewer-facing context block.
    """
    parts = []
    if claim.vehicle_make:
        parts.append(str(claim.vehicle_make).strip())
    if claim.vehicle_model:
        parts.append(str(claim.vehicle_model).strip())
    if claim.vehicle_year is not None:
        parts.append(str(claim.vehicle_year))
    mm = " ".join(parts) if parts else None

    return {
        "registration": (claim.vehicle_registration_number or "").strip() or None,
        "vin": None,
        "make_model_year": mm,
        "policy_number": (claim.policy_number or "").strip() or None,
        "claim_reported_context": _trim(claim.incident_description),
        "overlap_summary": None,
    }


def _confidence_grounded(score: float | None, limited: bool) -> dict[str, Any]:
    if limited:
        return {"label": "limited", "score": score}
    if score is None:
        return {"label": "partial", "score": None}
    return {"label": "grounded", "score": round(float(score), 4)}


class ImageAuthenticityAnalyzer:
    card_key = "image_authenticity"
    title = "Image authenticity"

    @staticmethod
    def analyze(
        claim: FnolClaim,
        latest_eval: ClaimEvaluationResponse | None,
        raw: dict[str, Any],
    ) -> dict[str, Any]:
        data = raw.get("data") or {}
        photo_count = int(data.get("photo_count") or 0)
        fraud_count = int(data.get("fraud_results_count") or 0)
        max_score = data.get("max_fraud_score")
        high_risk = int(data.get("high_risk_count") or 0)
        exif_stats = data.get("exif_warning_stats") or {}
        photos_missing_exif = int(exif_stats.get("photos_with_missing_or_empty_exif") or 0)

        caveats: list[str] = []
        evidence: list[dict[str, Any]] = []
        metrics: list[dict[str, Any]] = [
            {"label": "photos_on_file", "value": photo_count},
            {"label": "persisted_analysis_runs", "value": fraud_count},
        ]
        unsupported_fields = ["vin", "ocr_license_plate", "structured_tampering_verdict"]

        if photo_count == 0:
            caveats.append("No damage photos are on file for this claim.")
            headline = "No photos available for authenticity review"
            disp = DISPLAY_PARTIAL
        elif fraud_count == 0:
            caveats.append(
                "No persisted image-fraud analysis rows exist yet; authenticity risk cannot be quantified from stored results."
            )
            headline = f"{photo_count} photo(s) on file; analysis not yet persisted"
            disp = DISPLAY_PARTIAL
        else:
            metrics.append({"label": "max_fraud_score", "value": max_score})
            metrics.append({"label": "high_risk_images", "value": high_risk})
            if max_score is not None and float(max_score) >= 80:
                headline = f"Highest persisted fraud score {max_score} — review recommended"
                disp = DISPLAY_CRITICAL
            elif max_score is not None and float(max_score) >= 60:
                headline = f"Highest persisted fraud score {max_score} — elevated"
                disp = DISPLAY_WARNING
            else:
                headline = f"{fraud_count} persisted analysis run(s); max score {max_score}"
                # Do not imply "all clear" when EXIF/metadata coverage is incomplete.
                disp = DISPLAY_INFO if photos_missing_exif > 0 else DISPLAY_CLEAR

        if photos_missing_exif > 0:
            caveats.append(
                f"{photos_missing_exif} analyzed image(s) have missing or empty EXIF metadata in stored results."
            )
        for w in (exif_stats.get("distinct_warning_samples") or [])[:5]:
            if w:
                evidence.append(
                    {
                        "type": "exif_warning",
                        "label": "Stored EXIF warning",
                        "detail": str(w)[:500],
                        "source": "image_fraud_results.exif_json",
                        "confidence": "grounded",
                    }
                )

        per_image = data.get("per_image_detailed") or []
        for row in per_image[:15]:
            fp = row.get("photo_path") or "unknown"
            fs = row.get("fraud_score")
            detail = f"fraud_score={fs}"
            if row.get("exif_warnings_preview"):
                detail += f"; exif_warnings={row['exif_warnings_preview']}"
            evidence.append(
                {
                    "type": "per_image_score",
                    "label": fp[-80:] if len(str(fp)) > 80 else str(fp),
                    "detail": detail[:400],
                    "source": "image_fraud_results",
                    "confidence": "grounded",
                }
            )

        if latest_eval and latest_eval.damage_confidence is not None:
            evidence.append(
                {
                    "type": "evaluation_signal",
                    "label": "Latest evaluation damage_confidence",
                    "detail": str(float(latest_eval.damage_confidence)),
                    "source": "claim_evaluation_response",
                    "confidence": "partial",
                }
            )
            caveats.append(
                "damage_confidence on the evaluation row is a separate signal from per-image fraud scores."
            )

        if latest_eval and (latest_eval.llm_severity or "").strip():
            evidence.append(
                {
                    "type": "evaluation_signal",
                    "label": "Latest evaluation llm_severity",
                    "detail": (latest_eval.llm_severity or "").strip(),
                    "source": "claim_evaluation_response",
                    "confidence": "partial",
                }
            )

        notes = data.get("llm_notes_samples") or []
        for note in notes[:3]:
            reviewer_safe_note = sanitize_reviewer_llm_notes(
                note,
                complaint_id=claim.complaint_id,
            )
            if reviewer_safe_note:
                evidence.append(
                    {
                        "type": "llm_authenticity_notes",
                        "label": "Stored LLM authenticity notes",
                        "detail": str(reviewer_safe_note)[:500],
                        "source": "image_fraud_results.llm_authenticity_notes",
                        "confidence": "grounded",
                    }
                )

        ctx = build_claim_context_block(claim)
        return {
            "card_key": ImageAuthenticityAnalyzer.card_key,
            "title": ImageAuthenticityAnalyzer.title,
            "headline": headline[:160],
            "status": disp,
            "confidence": _confidence_grounded(
                float(max_score) if max_score is not None else None,
                limited=fraud_count == 0,
            ),
            "claim_context": ctx,
            "metrics": metrics,
            "evidence": evidence,
            "caveats": caveats,
            "unsupported_fields": unsupported_fields,
        }


class DuplicateScreeningAnalyzer:
    card_key = "duplicate_screening"
    title = "Duplicate screening"

    @staticmethod
    def analyze(
        claim: FnolClaim,
        latest_eval: ClaimEvaluationResponse | None,
        raw: dict[str, Any],
    ) -> dict[str, Any]:
        _ = latest_eval
        data = raw.get("data") or {}
        candidates = data.get("candidates") or []
        n = len(candidates)
        photo_count = int(data.get("photo_count") or 0)
        has_hash = bool(data.get("has_image_hash_fingerprints"))
        policy_overlap = int(data.get("same_policy_other_claims_count") or 0)
        reg_overlap = int(data.get("same_registration_other_claims_count") or 0)

        caveats: list[str] = []
        evidence: list[dict[str, Any]] = []
        metrics: list[dict[str, Any]] = [
            {"label": "persisted_duplicate_candidates", "value": n},
            {"label": "photos_on_file", "value": photo_count},
        ]
        unsupported_fields: list[str] = []

        overlap_bits = []
        if policy_overlap > 0:
            overlap_bits.append(f"{policy_overlap} other FNOL row(s) share this policy number")
            evidence.append(
                {
                    "type": "policy_overlap",
                    "label": "Same policy_number, other claims",
                    "detail": f"Count={policy_overlap} (not proof of image reuse).",
                    "source": "fnol_claims.policy_number",
                    "confidence": "grounded",
                }
            )
        if reg_overlap > 0:
            overlap_bits.append(
                f"{reg_overlap} other FNOL row(s) share this vehicle registration"
            )
            evidence.append(
                {
                    "type": "registration_overlap",
                    "label": "Same vehicle_registration_number, other claims",
                    "detail": f"Count={reg_overlap} (not proof of image reuse).",
                    "source": "fnol_claims.vehicle_registration_number",
                    "confidence": "grounded",
                }
            )

        ctx = build_claim_context_block(claim)
        if overlap_bits:
            ctx = {**ctx, "overlap_summary": "; ".join(overlap_bits)}

        for c in candidates[:25]:
            evidence.append(
                {
                    "type": "duplicate_candidate",
                    "label": f"Match → {c.get('other_complaint_id')}",
                    "detail": f"match_reason={c.get('match_reason')}; similarity_score={c.get('similarity_score')}",
                    "source": "claim_duplicate_candidates",
                    "confidence": "grounded",
                }
            )

        dup_settings = data.get("duplicate_detection_settings")
        if isinstance(dup_settings, dict) and dup_settings:
            evidence.append(
                {
                    "type": "screening_configuration",
                    "label": "Duplicate detection settings (persisted config)",
                    "detail": str(
                        {
                            k: dup_settings.get(k)
                            for k in (
                                "phash_threshold",
                                "dhash_threshold",
                                "require_both_non_exact",
                                "sensitivity_label",
                                "match_policy_label",
                            )
                            if k in dup_settings
                        }
                    )[:500],
                    "source": "pricing_config / django settings",
                    "confidence": "grounded",
                }
            )

        if n > 0:
            headline = f"{n} persisted cross-claim duplicate candidate(s)"
            max_sim = max(
                (float(c.get("similarity_score") or 0) for c in candidates),
                default=0.0,
            )
            disp = DISPLAY_CRITICAL if max_sim >= 95 else DISPLAY_WARNING
            caveats.append(
                "Candidates are persisted similarity signals; manual review may still be required."
            )
        elif photo_count == 0:
            headline = "No photos on file — duplicate image screening not applicable"
            caveats.append(
                "Without damage photos, per-image hash / similarity screening for this claim is not applicable."
            )
            disp = DISPLAY_INFO
        elif not has_hash:
            headline = "Duplicate screening has not been persisted for this claim yet"
            caveats.append(
                "No persisted image hash fingerprints were found for this claim; this usually means "
                "image fraud / reuse analysis has not been run, not that duplicates are absent."
            )
            disp = DISPLAY_PARTIAL
        else:
            headline = (
                "Persisted image hashes present; no duplicate candidate rows stored for this claim"
            )
            caveats.append(
                "Image hash data exists but no duplicate candidate rows are stored for this claim. "
                "That indicates no cross-claim matches met persistence rules — not that duplicates cannot exist elsewhere."
            )
            # Screened-with-no-stored-matches is informative, not a blanket "clear" verdict.
            disp = DISPLAY_INFO

        metrics.append({"label": "image_hash_fingerprints_present", "value": has_hash})
        metrics.append({"label": "same_policy_other_claims", "value": policy_overlap})
        metrics.append({"label": "same_registration_other_claims", "value": reg_overlap})

        return {
            "card_key": DuplicateScreeningAnalyzer.card_key,
            "title": DuplicateScreeningAnalyzer.title,
            "headline": headline[:160],
            "status": disp,
            "confidence": _confidence_grounded(
                None,
                limited=not has_hash and n == 0 and photo_count > 0,
            ),
            "claim_context": ctx,
            "metrics": metrics,
            "evidence": evidence,
            "caveats": caveats,
            "unsupported_fields": unsupported_fields,
        }


class EstimatedValueAnalyzer:
    card_key = "estimated_value"
    title = "Estimated value"

    @staticmethod
    def analyze(
        claim: FnolClaim,
        latest_eval: ClaimEvaluationResponse | None,
        raw: dict[str, Any],
    ) -> dict[str, Any]:
        data = raw.get("data") or {}
        caveats: list[str] = []
        evidence: list[dict[str, Any]] = []
        metrics: list[dict[str, Any]] = []
        # Optional line-item exports not persisted — omit empty "limits" lists so the UI
        # does not show a scroll-only negative disclosure when nothing is on file.
        unsupported_fields: list[str] = []

        gross = data.get("gross_estimate")
        excess = data.get("excess_amount")
        net = data.get("net_payable")
        currency = data.get("currency_code")
        part_count = int(data.get("part_count") or 0)
        vsrc = data.get("valuation_source")

        metrics.extend(
            [
                {"label": "gross_estimate", "value": gross},
                {"label": "excess_amount", "value": excess},
                {"label": "net_payable", "value": net},
                {"label": "currency_code", "value": currency},
                {"label": "part_row_count", "value": part_count},
                {"label": "valuation_source", "value": vsrc},
            ]
        )

        if vsrc == "claim_phase1_valuation":
            evidence.append(
                {
                    "type": "valuation_snapshot",
                    "label": "Valuation snapshot",
                    "detail": "Gross / excess / net taken from the persisted claim valuation record.",
                    "source": "claim_phase1_valuation",
                    "confidence": "grounded",
                }
            )
        elif vsrc == "calculated_from_parts":
            evidence.append(
                {
                    "type": "valuation_snapshot",
                    "label": "Computed from part rows",
                    "detail": "Values from calculate_claim_valuation (existing service) and pricing rules.",
                    "source": "damage_part_assessments + valuation_service",
                    "confidence": "grounded",
                }
            )
        else:
            caveats.append(
                "No gross estimate is available from persisted valuation snapshots or part-based calculation."
            )

        if latest_eval:
            ea = data.get("evaluation_estimated_amount")
            ca = data.get("evaluation_claim_amount")
            tv = data.get("evaluation_threshold_value")
            ct = data.get("evaluation_claim_type")
            metrics.append(
                {"label": "evaluation_estimated_amount", "value": ea},
            )
            metrics.append(
                {"label": "evaluation_claim_amount", "value": ca},
            )
            metrics.append(
                {"label": "evaluation_threshold_value", "value": tv},
            )
            metrics.append(
                {"label": "evaluation_claim_type", "value": ct},
            )
            evidence.append(
                {
                    "type": "evaluation_row",
                    "label": "Latest evaluation amounts",
                    "detail": f"estimated_amount={ea}; claim_amount={ca}; claim_type={ct}; decision={latest_eval.decision}; threshold_value={tv}",
                    "source": "claim_evaluation_response",
                    "confidence": "grounded",
                }
            )

        if part_count == 0 and gross is None:
            headline = "No part-level or valuation snapshot amounts available"
            disp = DISPLAY_PARTIAL
            caveats.append("Without part assessments or a valuation snapshot, repair totals cannot be grounded.")
        elif gross is not None:
            headline = f"Gross {gross} {currency or ''}".strip()
            disp = DISPLAY_CLEAR if part_count > 0 else DISPLAY_WARNING
            if part_count == 0:
                caveats.append(
                    "Gross estimate is present but no part-level rows exist; confirm source in evidence."
                )
        else:
            headline = "Valuation incomplete from persisted data"
            disp = DISPLAY_PARTIAL

        ctx = build_claim_context_block(claim)
        return {
            "card_key": EstimatedValueAnalyzer.card_key,
            "title": EstimatedValueAnalyzer.title,
            "headline": headline[:160],
            "status": disp,
            "confidence": _confidence_grounded(
                float(gross) if gross is not None else None,
                limited=gross is None,
            ),
            "claim_context": ctx,
            "metrics": metrics,
            "evidence": evidence,
            "caveats": caveats,
            "unsupported_fields": unsupported_fields,
        }


class DamageDetectionAnalyzer:
    card_key = "damage_detection"
    title = "Damage detection"

    @staticmethod
    def analyze(
        claim: FnolClaim,
        latest_eval: ClaimEvaluationResponse | None,
        raw: dict[str, Any],
    ) -> dict[str, Any]:
        data = raw.get("data") or {}
        parts = data.get("parts") or []
        part_count = int(data.get("part_count") or 0)
        llm_damages = data.get("llm_damages") or []
        llm_sev = data.get("llm_severity")
        total_cost = data.get("total_estimated_cost")
        inc = _trim(claim.incident_description, 120)

        caveats: list[str] = []
        evidence: list[dict[str, Any]] = []
        metrics: list[dict[str, Any]] = [
            {"label": "part_row_count", "value": part_count},
            {"label": "total_estimated_cost_from_parts", "value": total_cost},
            {"label": "llm_damage_tag_count", "value": len(llm_damages)},
        ]

        replace_n = sum(
            1
            for p in parts
            if str((p.get("repair_action") or "")).upper().find("REPLACE") >= 0
        )
        repair_n = sum(
            1
            for p in parts
            if str((p.get("repair_action") or "")).upper().find("REPAIR") >= 0
        )
        if part_count:
            metrics.append({"label": "parts_marked_replace", "value": replace_n})
            metrics.append({"label": "parts_marked_repair", "value": repair_n})

        for p in parts[:20]:
            evidence.append(
                {
                    "type": "part_assessment",
                    "label": p.get("part_name"),
                    "detail": f"damage_type={p.get('damage_type')}; action={p.get('repair_action')}; severity%={p.get('severity_percent')}; amount={p.get('estimated_amount')}",
                    "source": "damage_part_assessments",
                    "confidence": "grounded",
                }
            )

        if llm_damages:
            evidence.append(
                {
                    "type": "llm_damage_list",
                    "label": "llm_damages (latest evaluation)",
                    "detail": ", ".join(llm_damages[:12]),
                    "source": "claim_evaluation_response.llm_damages",
                    "confidence": "grounded",
                }
            )
        if llm_sev:
            evidence.append(
                {
                    "type": "llm_severity",
                    "label": "llm_severity",
                    "detail": str(llm_sev),
                    "source": "claim_evaluation_response",
                    "confidence": "grounded",
                }
            )

        if inc:
            evidence.append(
                {
                    "type": "fnol_text",
                    "label": "Incident description (excerpt)",
                    "detail": inc,
                    "source": "fnol_claims.incident_description",
                    "confidence": "grounded",
                }
            )

        if part_count > 0:
            headline = f"{part_count} part line(s); total estimated {total_cost}"
            disp = DISPLAY_CLEAR
        elif llm_damages or llm_sev:
            headline = f"Coarse labels only ({len(llm_damages)} tag(s); severity={llm_sev})"
            caveats.append(
                "No structured part-level damage rows are persisted; only evaluation / LLM labels are available."
            )
            disp = DISPLAY_INFO
        elif inc:
            headline = "Only FNOL incident text available — no structured damage rows"
            caveats.append("Damage assessment rows and LLM labels are absent; see incident description only.")
            disp = DISPLAY_PARTIAL
        else:
            headline = "No persisted damage structure for this claim"
            disp = DISPLAY_PARTIAL
            caveats.append("No part assessments, LLM damage labels, or incident description on file.")

        unsupported_fields: list[str] = []

        ctx = build_claim_context_block(claim)
        return {
            "card_key": DamageDetectionAnalyzer.card_key,
            "title": DamageDetectionAnalyzer.title,
            "headline": headline[:160],
            "status": disp,
            "confidence": _confidence_grounded(
                float(total_cost) if total_cost is not None else None,
                limited=part_count == 0,
            ),
            "claim_context": ctx,
            "metrics": metrics,
            "evidence": evidence,
            "caveats": caveats,
            "unsupported_fields": unsupported_fields,
        }


_ANALYZERS = {
    "image_authenticity": ImageAuthenticityAnalyzer,
    "duplicate_screening": DuplicateScreeningAnalyzer,
    "estimated_value": EstimatedValueAnalyzer,
    "damage_detection": DamageDetectionAnalyzer,
}


def run_card_analyzer_and_bundle(
    card_key: str,
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
    raw_bundle: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build evidence bundle and analyzer output; bundle build errors are caught."""
    cls = _ANALYZERS.get(card_key)
    if not cls:
        empty = {"kind": "none", "data": {}}
        return empty, {
            "card_key": card_key,
            "title": card_key,
            "headline": "Card analyzer not configured",
            "status": DISPLAY_FAILED,
            "confidence": {"label": "limited", "score": None},
            "claim_context": build_claim_context_block(claim),
            "metrics": [],
            "evidence": [],
            "caveats": ["Unknown card_key for analyzer."],
            "unsupported_fields": [],
            "_analyzer_error": True,
            "_error_code": "unknown_card_key",
        }
    try:
        bundle = raw_bundle or build_card_evidence_bundle(claim, card_key, latest_eval)
        return bundle, cls.analyze(claim, latest_eval, bundle)
    except Exception as exc:
        logger.exception("run_card_analyzer failed for %s", card_key)
        empty = {"kind": "unavailable", "data": {}}
        return empty, {
            "card_key": card_key,
            "title": getattr(cls, "title", card_key),
            "headline": "Analysis failed — persisted data could not be read",
            "status": DISPLAY_FAILED,
            "confidence": {"label": "limited", "score": None},
            "claim_context": build_claim_context_block(claim),
            "metrics": [],
            "evidence": [],
            "caveats": [
                "An unexpected error occurred while building this card from persisted data."
            ],
            "unsupported_fields": [],
            "_analyzer_error": True,
            "_error_code": "exception_during_evidence_or_analyze",
            "_exception_type": type(exc).__name__,
        }


def run_card_analyzer(
    card_key: str,
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None,
    raw_bundle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run analyzer; on failure return partial-safe payload with caveat (no re-raise).

    Pass ``raw_bundle`` when the caller already built evidence (avoids duplicate ORM work).
    """
    _raw, analysis = run_card_analyzer_and_bundle(
        card_key, claim, latest_eval, raw_bundle=raw_bundle
    )
    return analysis


def map_display_status_to_insight_status(display_status: str) -> str:
    """
    Map API-facing display status to ClaimCardInsight.Status (persistence).

    Display values (API): clear | warning | critical | info | partial | failed
    Stored values (DB): pending | ready | partial | failed

    - ``info`` / ``partial`` (display) → pending (incomplete or caveat-heavy)
    - ``warning`` / ``critical`` (display) → partial (actionable review)
    - ``clear`` (display) → ready
    - ``failed`` (display) → failed
    """
    from claims.models import ClaimCardInsight

    if display_status == DISPLAY_FAILED:
        return ClaimCardInsight.Status.FAILED
    if display_status in (DISPLAY_CRITICAL, DISPLAY_WARNING):
        return ClaimCardInsight.Status.PARTIAL
    if display_status in (DISPLAY_INFO, DISPLAY_PARTIAL):
        return ClaimCardInsight.Status.PENDING
    return ClaimCardInsight.Status.READY
