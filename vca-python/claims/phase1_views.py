"""
Authenticated FNOL-scoped APIs for media trust, damage breakdown, and valuation.

Provides endpoints for:
- Image fraud analysis
- Image fraud result retrieval
- Duplicate image detection
- Detailed damage assessment with part breakdown
- Total valuation
"""

import logging
from decimal import Decimal

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from claims.models import (
    ClaimEvaluationResponse,
    FnolClaim,
    ImageFraudResult,
    ClaimDuplicateCandidate,
    DamagePartAssessment,
    ClaimPhase1Valuation,
)
from claims.decisioning import sync_claim_evaluation_decision_state
from claims.phase1_runtime import get_claim_market_context
from claims.authenticity_classification import classify_image_authenticity_labels
from claims.reviewer_safe import sanitize_reviewer_llm_notes
from claims.workflow_state import current_lifecycle_started_at
from damage_detection_llm.image_fraud_service import (
    analyze_image_fraud,
    check_image_reuse,
    get_duplicate_detection_settings,
    persist_duplicate_candidates,
)
from damage_detection_llm.services import (
    run_damage_assessment_detailed,
    save_part_assessments,
)
from damage_detection_llm.valuation_service import run_full_valuation

from claims.media_paths import resolve_media_disk_path

logger = logging.getLogger(__name__)


def _json_safe(value):
    """Normalize numpy / Decimal / nested values for JSONField and API payloads."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def _normalize_duplicate_similarity(stored) -> tuple[float, float]:
    """DB stores 0-100; return (0-1, 0-100) for API clarity."""
    raw = float(stored or 0)
    if raw <= 1.0:
        return round(raw, 4), round(raw * 100.0, 2)
    return round(raw / 100.0, 4), round(raw, 2)


def _round_optional(value, digits: int = 2):
    if value is None:
        return None
    return round(float(value), digits)


def _latest_eval_for_claim(claim: FnolClaim) -> ClaimEvaluationResponse | None:
    return ClaimEvaluationResponse.objects.filter(
        complaint_id=claim.complaint_id,
        is_latest=True,
    ).first()


def _current_started_at_for_claim(claim: FnolClaim):
    return current_lifecycle_started_at(_latest_eval_for_claim(claim))


def _image_fraud_result_payload(
    *,
    result_id: int | None,
    photo_path: str,
    fraud_score,
    ela_score,
    p_hash: str,
    d_hash: str,
    a_hash: str,
    exif_json: dict | None,
    signals_json: dict | None,
    llm_notes: str,
    created_at: str | None,
    status_text: str | None = None,
) -> dict:
    reviewer_safe_notes = sanitize_reviewer_llm_notes(
        llm_notes,
        photo_path=photo_path,
    )
    payload = {
        "id": result_id,
        "photo_path": photo_path,
        "fraud_score": float(fraud_score) if fraud_score else 0,
        "ela_score": _round_optional(ela_score),
        "p_hash": p_hash,
        "d_hash": d_hash,
        "a_hash": a_hash,
        "exif_json": exif_json,
        "exif_present": bool(exif_json.get("exif_present"))
        if isinstance(exif_json, dict) and "exif_present" in exif_json
        else bool(exif_json),
        "signals_json": signals_json,
        "llm_notes": reviewer_safe_notes,
        "created_at": created_at,
        "authenticity_labels": classify_image_authenticity_labels(
            exif_json=exif_json,
            llm_notes=reviewer_safe_notes,
            fraud_score=float(fraud_score) if fraud_score else 0,
            ela_score=ela_score,
            signals_json=signals_json,
        ),
    }
    if status_text:
        payload["status"] = status_text
    return payload


def _image_fraud_results_payload(claim: FnolClaim) -> dict:
    """Serialize persisted image-fraud rows for a claim."""
    started_at = _current_started_at_for_claim(claim)
    results = ImageFraudResult.objects.filter(complaint=claim)
    if started_at is not None:
        results = results.filter(created_at__gte=started_at)
    results = results.order_by("-created_at")
    return {
        "complaint_id": claim.complaint_id,
        "results_count": results.count(),
        "results": [
            _image_fraud_result_payload(
                result_id=r.id,
                photo_path=r.photo_path,
                fraud_score=r.fraud_score,
                ela_score=r.ela_score,
                p_hash=r.p_hash,
                d_hash=r.d_hash,
                a_hash=r.a_hash,
                exif_json=r.exif_json,
                signals_json=r.signals_json,
                llm_notes=r.llm_authenticity_notes,
                created_at=r.created_at.isoformat() if r.created_at else None,
            )
            for r in results
        ],
    }


def _detailed_damage_response_payload(
    claim: FnolClaim, pipeline_metadata: dict | None = None
) -> dict:
    """Serialize persisted part-level assessments for both GET and idempotent POST."""
    assessments = DamagePartAssessment.objects.filter(complaint=claim).order_by(
        "sort_order"
    )
    total_estimated_cost = sum(float(a.estimated_amount or 0) for a in assessments)
    market_context = get_claim_market_context(claim=claim)

    response_data = {
        "complaint_id": claim.complaint_id,
        "total_parts": assessments.count(),
        "total_estimated_cost": round(total_estimated_cost, 2),
        "currency_code": market_context["currency_code"],
        "market_context": market_context,
        "part_breakdown": [
            {
                "part_name": a.part_name,
                "damage_type": a.damage_type,
                "severity_percent": float(a.severity_percent)
                if a.severity_percent
                else 0,
                "repair_action": a.repair_action,
                "estimated_amount": float(a.estimated_amount)
                if a.estimated_amount
                else 0,
                "source_image_url": a.source_image_url or "",
            }
            for a in assessments
        ],
    }

    if pipeline_metadata:
        response_data["pipeline_metadata"] = pipeline_metadata

    return response_data


@api_view(["POST", "GET"])
@permission_classes([IsAuthenticated])
def image_fraud_analysis(request, complaint_id: str):
    """
    POST: Trigger fraud analysis for claim images.
    GET: Retrieve existing fraud analysis results.

    URL: /api/fnol/<complaint_id>/image-fraud-analysis
    """
    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            return Response(
                {"error": f"Claim {complaint_id} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == "POST":
            started_at = _current_started_at_for_claim(claim)
            # Get images to analyze
            photos = claim.damage_photos.order_by("id")
            if not photos:
                return Response(
                    {"error": "No images found for this claim"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            results = []
            aggregated_duplicates: dict[tuple[str, str], dict] = {}

            # Analyze each photo
            for photo in photos:
                photo_path = photo.photo_path
                if not photo_path:
                    continue

                disk_path = resolve_media_disk_path(photo_path)
                if not disk_path:
                    continue

                # Check if already analyzed
                existing_qs = ImageFraudResult.objects.filter(
                    complaint=claim,
                    photo_path=photo_path,
                ).order_by("-created_at")
                existing = (
                    existing_qs.filter(created_at__gte=started_at).first()
                    if started_at is not None
                    else existing_qs.first()
                )

                if existing:
                    duplicate_summary = check_image_reuse(
                        disk_path, complaint_id, persist=False
                    )
                    for candidate in (
                        duplicate_summary.get("duplicate_candidates")
                        or duplicate_summary.get("candidates")
                        or []
                    ):
                        other_claim = str(candidate.get("other_complaint_id") or "").strip()
                        other_photo = str(candidate.get("other_photo_path") or "").strip()
                        if not other_claim:
                            continue
                        key = (other_claim, other_photo)
                        merged = aggregated_duplicates.get(key)
                        if not merged:
                            aggregated_duplicates[key] = {
                                "other_complaint_id": other_claim,
                                "other_photo_path": other_photo,
                                "similarity_score": float(
                                    candidate.get("similarity_score") or 0
                                ),
                                "match_reasons": list(
                                    candidate.get("match_reasons") or []
                                ),
                                "existing_created_at": candidate.get(
                                    "existing_created_at"
                                ),
                            }
                        else:
                            merged["similarity_score"] = max(
                                float(merged.get("similarity_score") or 0),
                                float(candidate.get("similarity_score") or 0),
                            )
                            merged["match_reasons"] = sorted(
                                {
                                    *list(merged.get("match_reasons") or []),
                                    *list(candidate.get("match_reasons") or []),
                                }
                            )
                    # Return existing result
                    results.append(
                        _image_fraud_result_payload(
                            result_id=existing.id,
                            photo_path=photo_path,
                            fraud_score=existing.fraud_score,
                            ela_score=existing.ela_score,
                            p_hash=existing.p_hash,
                            d_hash=existing.d_hash,
                            a_hash=existing.a_hash,
                            exif_json=existing.exif_json,
                            signals_json=existing.signals_json,
                            llm_notes=existing.llm_authenticity_notes,
                            created_at=existing.created_at.isoformat()
                            if existing.created_at
                            else None,
                            status_text="existing",
                        )
                    )
                    continue

                # Run new analysis
                try:
                    fraud_result = analyze_image_fraud(disk_path)

                    # Save to database
                    reviewer_safe_reasoning = sanitize_reviewer_llm_notes(
                        fraud_result["llm_authenticity"].get("reasoning", ""),
                        complaint_id=claim.complaint_id,
                        photo_path=photo_path,
                    )
                    saved_result = ImageFraudResult.objects.create(
                        complaint=claim,
                        damage_photo=photo,
                        photo_path=photo_path,
                        sha256_hex=fraud_result["sha256_hex"],
                        p_hash=fraud_result["p_hash"],
                        d_hash=fraud_result["d_hash"],
                        a_hash=fraud_result["a_hash"],
                        exif_json=_json_safe(fraud_result["exif_data"]),
                        ela_score=_json_safe(fraud_result["ela_score"]),
                        fraud_score=fraud_result["fraud_score"],
                        signals_json=_json_safe({
                            "ela_score": fraud_result["ela_score"],
                            "exif_warnings": fraud_result["exif_data"].get("warnings", []),
                        }),
                        llm_authenticity_notes=reviewer_safe_reasoning,
                    )

                    # Check for duplicates
                    duplicate_summary = check_image_reuse(
                        disk_path, complaint_id, persist=False
                    )
                    for candidate in (
                        duplicate_summary.get("duplicate_candidates")
                        or duplicate_summary.get("candidates")
                        or []
                    ):
                        other_claim = str(candidate.get("other_complaint_id") or "").strip()
                        other_photo = str(candidate.get("other_photo_path") or "").strip()
                        if not other_claim:
                            continue
                        key = (other_claim, other_photo)
                        merged = aggregated_duplicates.get(key)
                        if not merged:
                            aggregated_duplicates[key] = {
                                "other_complaint_id": other_claim,
                                "other_photo_path": other_photo,
                                "similarity_score": float(
                                    candidate.get("similarity_score") or 0
                                ),
                                "match_reasons": list(
                                    candidate.get("match_reasons") or []
                                ),
                                "existing_created_at": candidate.get(
                                    "existing_created_at"
                                ),
                            }
                        else:
                            merged["similarity_score"] = max(
                                float(merged.get("similarity_score") or 0),
                                float(candidate.get("similarity_score") or 0),
                            )
                            merged["match_reasons"] = sorted(
                                {
                                    *list(merged.get("match_reasons") or []),
                                    *list(candidate.get("match_reasons") or []),
                                }
                            )

                    results.append(
                        _image_fraud_result_payload(
                            result_id=saved_result.id,
                            photo_path=photo_path,
                            fraud_score=fraud_result["fraud_score"],
                            ela_score=fraud_result["ela_score"],
                            p_hash=fraud_result["p_hash"],
                            d_hash=fraud_result["d_hash"],
                            a_hash=fraud_result["a_hash"],
                            exif_json=_json_safe(fraud_result["exif_data"]),
                            signals_json=_json_safe(
                                {
                                    "ela_score": fraud_result["ela_score"],
                                    "exif_warnings": fraud_result["exif_data"].get(
                                        "warnings", []
                                    ),
                                }
                            ),
                            llm_notes=reviewer_safe_reasoning,
                            created_at=saved_result.created_at.isoformat()
                            if saved_result.created_at
                            else None,
                            status_text="analyzed",
                        )
                    )

                except Exception:
                    logger.exception("Fraud analysis failed for photo")
                    results.append({
                        "photo_path": photo_path,
                        "error": "Analysis failed",
                        "status": "error",
                    })

            persist_duplicate_candidates(
                complaint_id, list(aggregated_duplicates.values())
            )
            sync_claim_evaluation_decision_state(complaint_id=complaint_id)

            return Response({
                "complaint_id": complaint_id,
                "results_count": len(results),
                "results": results,
            })

        elif request.method == "GET":
            return Response(_image_fraud_results_payload(claim))

    except Exception:
        logger.exception("Image fraud analysis failed")
        return Response(
            {"error": "Analysis failed"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def image_fraud_results(request, complaint_id: str):
    """
    GET: Retrieve existing fraud analysis results.

    URL: /api/fnol/<complaint_id>/image-fraud-results
    """
    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            return Response(
                {"error": f"Claim {complaint_id} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(_image_fraud_results_payload(claim))

    except Exception:
        logger.exception("Image fraud result retrieval failed")
        return Response(
            {"error": "Failed to retrieve image fraud results"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def duplicate_candidates(request, complaint_id: str):
    """
    GET: List potential duplicate/reused images across claims.

    URL: /api/fnol/<complaint_id>/duplicate-candidates
    """
    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            return Response(
                {"error": f"Claim {complaint_id} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        started_at = _current_started_at_for_claim(claim)
        candidates = ClaimDuplicateCandidate.objects.filter(complaint=claim)
        if started_at is not None:
            candidates = candidates.filter(created_at__gte=started_at)
        candidates = candidates.order_by("-similarity_score")

        out_candidates = []
        for c in candidates:
            sim_01, sim_pct = _normalize_duplicate_similarity(c.similarity_score)
            out_candidates.append(
                {
                    "other_complaint_id": c.other_complaint_id,
                    "similarity": sim_01,
                    "similarity_percent": sim_pct,
                    "similarity_score": sim_pct,
                    "match_reason": c.match_reason,
                    "evidence": c.evidence_json,
                    "created_at": c.created_at.isoformat() if c.created_at else None,
                }
            )

        return Response(
            {
                "complaint_id": complaint_id,
                "candidate_count": len(out_candidates),
                "duplicate_detection": get_duplicate_detection_settings(),
                "candidates": out_candidates,
            }
        )

    except Exception:
        logger.exception("Duplicate candidates retrieval failed")
        return Response(
            {"error": "Failed to retrieve duplicate candidates"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST", "GET"])
@permission_classes([IsAuthenticated])
def damage_assessment_detailed(request, complaint_id: str):
    """
    POST: Run detailed damage assessment with part breakdown.
    GET: Retrieve existing detailed assessment results.

    URL: /api/fnol/<complaint_id>/damage-assessment-detailed
    """
    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            return Response(
                {"error": f"Claim {complaint_id} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == "POST":
            latest_eval = ClaimEvaluationResponse.objects.filter(
                complaint_id=complaint_id, is_latest=True
            ).first()
            rules = (
                latest_eval.fraud_rule_results
                if latest_eval and isinstance(latest_eval.fraud_rule_results, list)
                else []
            )
            if not rules:
                return Response(
                    {
                        "error": (
                            "Business Rule Validation must be completed before running "
                            "Damage Assessment. Run Business Rule Validation so rule "
                            "results are persisted for this claim."
                        ),
                        "code": "BRV_REQUIRED",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            existing_assessments = DamagePartAssessment.objects.filter(complaint=claim)

            # Get images to analyze
            photos = claim.damage_photos.order_by("id")
            if not photos:
                if existing_assessments.exists():
                    return Response(_detailed_damage_response_payload(claim))
                return Response(
                    {"error": "No images found for this claim"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            existing_rows_by_image: dict[str, list[dict]] = {}
            for row in existing_assessments.order_by("sort_order", "id"):
                existing_rows_by_image.setdefault(row.source_image_url or "", []).append(
                    {
                        "part": row.part_name,
                        "damage_type": row.damage_type,
                        "severity_percent": float(row.severity_percent or 0),
                        "repair_action": row.repair_action,
                        "estimated_cost": float(row.estimated_amount or 0),
                    }
                )

            staged_rows_by_image: dict[str, list[dict]] = {}
            last_pipeline_meta: dict = {}
            processed_any_photo = False
            for photo in photos:
                photo_path = photo.photo_path
                if not photo_path:
                    continue

                disk_path = resolve_media_disk_path(photo_path)
                if not disk_path:
                    if photo_path in existing_rows_by_image:
                        staged_rows_by_image[photo_path] = existing_rows_by_image[photo_path]
                    continue

                try:
                    detail_result = run_damage_assessment_detailed(
                        image_path=disk_path,
                        complaint_id=complaint_id,
                        incident_description=claim.incident_description,
                        flood_coverage=getattr(claim, "flood_coverage", False),
                        image_url=photo_path,
                        persist_claim_rows=False,
                    )
                    staged_rows_by_image[photo_path] = (
                        detail_result.get("part_breakdown") or []
                    )
                    processed_any_photo = True
                    # Capture the last non-empty pipeline_metadata
                    if detail_result.get("pipeline_metadata"):
                        last_pipeline_meta = detail_result["pipeline_metadata"]
                except Exception:
                    logger.exception("Detailed assessment failed for photo")
                    if photo_path in existing_rows_by_image:
                        staged_rows_by_image[photo_path] = existing_rows_by_image[photo_path]

            if not processed_any_photo and existing_assessments.exists():
                return Response(
                    _detailed_damage_response_payload(
                        claim, pipeline_metadata=last_pipeline_meta or None
                    )
                )

            DamagePartAssessment.objects.filter(complaint=claim).delete()
            for photo in photos:
                photo_path = photo.photo_path or ""
                save_part_assessments(
                    complaint_id,
                    staged_rows_by_image.get(photo_path, []),
                    photo_path,
                    replace_scope="image",
                )

            run_full_valuation(complaint_id)
            sync_claim_evaluation_decision_state(complaint_id=complaint_id)

            return Response(
                _detailed_damage_response_payload(
                    claim, pipeline_metadata=last_pipeline_meta or None
                )
            )

        elif request.method == "GET":
            return Response(_detailed_damage_response_payload(claim))

    except Exception:
        logger.exception("Detailed damage assessment failed")
        return Response(
            {"error": "Assessment failed"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def total_value(request, complaint_id: str):
    """
    GET: Get computed valuation (gross, excess, net).

    URL: /api/fnol/<complaint_id>/total-value
    """
    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            return Response(
                {"error": f"Claim {complaint_id} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Run valuation calculation
        valuation = run_full_valuation(complaint_id)

        # Also include excess from fnol_claims if set
        fnol_excess = None
        if claim.excess_amount:
            fnol_excess = float(claim.excess_amount)

        parts_total = sum(
            float(x.get("estimated_amount") or 0) for x in valuation.get("breakdown", [])
        )
        market_context = get_claim_market_context(claim=claim)
        currency_code = (
            str(valuation.get("currency_code") or market_context.get("currency_code") or "THB")
            .upper()
        )
        if market_context.get("currency_code"):
            market_currency = str(market_context["currency_code"]).upper()
            if currency_code != market_currency:
                currency_code = market_currency
                ClaimPhase1Valuation.objects.filter(complaint=claim).update(
                    currency_code=currency_code
                )
        return Response({
            "complaint_id": complaint_id,
            "gross_estimate": valuation["gross_estimate"],
            "excess_amount": valuation["excess_amount"],
            "excess_from_fnol": fnol_excess,
            "net_payable": valuation["net_payable"],
            "currency_code": currency_code,
            "market_context": valuation.get("market_context") or market_context,
            "part_count": len(valuation.get("breakdown", [])),
            "parts_total_cross_check": round(parts_total, 2),
            # Line items for the DA tab table (frontend `selectPartBreakdownRows`); must stay in sync with part_count.
            "breakdown": valuation.get("breakdown") or [],
        })

    except Exception:
        logger.exception("Total value calculation failed")
        return Response(
            {"error": "Valuation failed"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
