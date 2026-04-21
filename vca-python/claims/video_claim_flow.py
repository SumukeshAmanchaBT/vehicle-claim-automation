from __future__ import annotations

from decimal import Decimal
from typing import Any

from claims.models import (
    ClaimVideoAnalysisResult,
    ClaimVideoAsset,
    ClaimVideoDamageAssessment,
    ClaimVideoProcessingJob,
    DamagePartAssessment,
    FnolClaim,
)
from claims.media_paths import is_video_media_path
from claims.phase1_runtime import get_claim_market_context


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _round_money(value: float) -> float:
    return round(float(value or 0.0), 2)


def _canonical_video_estimated_amount(row: dict[str, Any]) -> float:
    min_amount = max(0.0, _safe_float(row.get("estimated_amount_min"), 0.0))
    max_amount = max(0.0, _safe_float(row.get("estimated_amount_max"), 0.0))
    return max(min_amount, max_amount)


def _canonical_video_source_url(row: dict[str, Any]) -> str:
    asset_id = _safe_int(row.get("video_asset_id"), 0)
    source_path = str(row.get("source_path") or "").strip()
    if asset_id and source_path:
        return f"video_asset:{asset_id}:{source_path}"
    if asset_id:
        return f"video_asset:{asset_id}"
    if source_path:
        return f"video_asset:{source_path}"
    return "video_asset"


def latest_claim_video_job(claim: FnolClaim) -> ClaimVideoProcessingJob | None:
    return claim.video_processing_jobs.order_by("-created_at", "-id").first()


def latest_claim_video_result(claim: FnolClaim) -> ClaimVideoAnalysisResult | None:
    return claim.video_analysis_results.order_by("-created_at", "-id").first()


def persist_claim_video_damage_assessments(
    *,
    claim: FnolClaim,
    job: ClaimVideoProcessingJob,
    result: ClaimVideoAnalysisResult,
    scenario_summary_json: dict[str, Any] | None,
) -> list[ClaimVideoDamageAssessment]:
    scenario_summary = scenario_summary_json or {}
    damage_assessment = scenario_summary.get("damage_assessment") or {}
    aggregated_parts = damage_assessment.get("aggregated_parts") or []
    currency_code = str(damage_assessment.get("currency_code") or "").strip().upper()

    ClaimVideoDamageAssessment.objects.filter(complaint=claim).delete()
    if not aggregated_parts:
        return []

    assets_by_id = {
        asset.id: asset
        for asset in ClaimVideoAsset.objects.filter(complaint=claim).order_by("id")
    }
    rows: list[ClaimVideoDamageAssessment] = []
    for index, raw_part in enumerate(aggregated_parts):
        if not isinstance(raw_part, dict):
            continue
        asset = assets_by_id.get(_safe_int(raw_part.get("asset_id"), 0))
        timestamps_ms = sorted(
            {
                max(0, _safe_int(value, 0))
                for value in (raw_part.get("observed_timestamps_ms") or [])
            }
        )
        rows.append(
            ClaimVideoDamageAssessment(
                complaint=claim,
                video_asset=asset,
                job=job,
                analysis_result=result,
                part_name=str(raw_part.get("part") or "").strip() or "Unknown part",
                damage_type=str(raw_part.get("damage_type") or "").strip(),
                severity_percent=Decimal(
                    str(max(0.0, min(100.0, _safe_float(raw_part.get("max_severity_percent"), 0.0))))
                ),
                repair_action=str(raw_part.get("repair_action") or "").strip(),
                estimated_amount_min=Decimal(
                    str(max(0.0, _safe_float(raw_part.get("estimated_cost_min"), 0.0)))
                ),
                estimated_amount_max=Decimal(
                    str(max(0.0, _safe_float(raw_part.get("estimated_cost_max"), 0.0)))
                ),
                currency_code=currency_code,
                observed_frame_count=max(
                    0,
                    _safe_int(raw_part.get("observed_frame_count"), len(timestamps_ms)),
                ),
                observed_timestamps_json=timestamps_ms,
                sort_order=index,
            )
        )

    if rows:
        ClaimVideoDamageAssessment.objects.bulk_create(rows)
    return list(
        ClaimVideoDamageAssessment.objects.filter(complaint=claim).select_related(
            "video_asset",
            "job",
            "analysis_result",
        )
    )


def serialize_claim_video_damage_assessment_rows(
    *,
    claim: FnolClaim,
    result: ClaimVideoAnalysisResult | None = None,
) -> list[dict[str, Any]]:
    queryset = ClaimVideoDamageAssessment.objects.filter(complaint=claim).select_related(
        "video_asset",
        "job",
        "analysis_result",
    )
    if result is not None:
        scoped = queryset.filter(analysis_result=result)
        if scoped.exists():
            queryset = scoped
    rows = queryset.order_by("sort_order", "id")
    payload: list[dict[str, Any]] = []
    for row in rows:
        payload.append(
            {
                "id": row.id,
                "part_name": row.part_name,
                "damage_type": row.damage_type,
                "severity_percent": float(row.severity_percent or 0),
                "repair_action": row.repair_action,
                "estimated_amount_min": float(row.estimated_amount_min or 0),
                "estimated_amount_max": float(row.estimated_amount_max or 0),
                "currency_code": row.currency_code or "",
                "observed_frame_count": int(row.observed_frame_count or 0),
                "observed_timestamps_ms": list(row.observed_timestamps_json or []),
                "video_asset_id": row.video_asset_id,
                "source_type": row.video_asset.source_type if row.video_asset else "",
                "source_path": row.video_asset.source_path if row.video_asset else "",
                "original_filename": (
                    row.video_asset.original_filename if row.video_asset else ""
                ),
            }
        )
    return payload


def build_claim_video_damage_assessment_payload(
    *,
    claim: FnolClaim,
    result: ClaimVideoAnalysisResult | None = None,
    job: ClaimVideoProcessingJob | None = None,
) -> dict[str, Any]:
    effective_result = result or latest_claim_video_result(claim)
    effective_job = job or (
        effective_result.job if effective_result and effective_result.job_id else None
    ) or latest_claim_video_job(claim)
    part_breakdown = serialize_claim_video_damage_assessment_rows(
        claim=claim,
        result=effective_result,
    )
    total_min = sum(_safe_float(row.get("estimated_amount_min"), 0.0) for row in part_breakdown)
    total_max = sum(_safe_float(row.get("estimated_amount_max"), 0.0) for row in part_breakdown)

    market_context = get_claim_market_context(claim=claim)
    analysis_context = (effective_result.analysis_context_json if effective_result else {}) or {}
    scenario_summary = (effective_result.scenario_summary_json if effective_result else {}) or {}
    damage_summary = scenario_summary.get("damage_assessment") or {}
    metrics = (effective_result.metrics_json if effective_result else {}) or {}
    decision_support = (effective_result.decision_support_json if effective_result else {}) or {}
    provider_selection = [
        asset_context.get("provider_selection") or {}
        for asset_context in (analysis_context.get("assets") or [])
        if isinstance(asset_context, dict)
    ]

    currency_code = (
        str(damage_summary.get("currency_code") or "").strip().upper()
        or next(
            (
                str(row.get("currency_code") or "").strip().upper()
                for row in part_breakdown
                if str(row.get("currency_code") or "").strip()
            ),
            "",
        )
        or market_context.get("currency_code")
        or ""
    )

    if effective_result is None:
        analysis_status = "not_started"
    else:
        analysis_status = effective_result.status

    return {
        "complaint_id": claim.complaint_id,
        "analysis_status": analysis_status,
        "job_status": effective_job.status if effective_job else None,
        "analysis_result_id": effective_result.id if effective_result else None,
        "job_id": effective_job.id if effective_job else None,
        "summary_text": effective_result.summary_text if effective_result else "",
        "total_parts": len(part_breakdown),
        "total_estimated_cost_min": _round_money(total_min),
        "total_estimated_cost_max": _round_money(total_max),
        "currency_code": currency_code,
        "market_context": market_context,
        "recommended_action": str(decision_support.get("recommended_action") or "").strip(),
        "timeline_event_count": _safe_int(metrics.get("timeline_event_count"), 0),
        "representative_frame_count": _safe_int(metrics.get("representative_frame_count"), 0),
        "part_breakdown": part_breakdown,
        "pipeline_metadata": {
            "pipeline_version": str(analysis_context.get("pipeline_version") or "").strip(),
            "provider_selection": provider_selection,
            "llm_pipeline": analysis_context.get("llm_pipeline") or {},
        },
        "processing_started_at": (
            effective_result.processing_started_at.isoformat()
            if effective_result and effective_result.processing_started_at
            else None
        ),
        "processing_completed_at": (
            effective_result.processing_completed_at.isoformat()
            if effective_result and effective_result.processing_completed_at
            else None
        ),
    }


def sync_video_damage_assessment_to_phase1(
    *,
    claim: FnolClaim,
    result: ClaimVideoAnalysisResult | None = None,
    job: ClaimVideoProcessingJob | None = None,
) -> bool:
    """
    Project completed video assessment output into the canonical phase-1 tables.

    This keeps the existing FNOL -> workflow_snapshot -> DA/Evaluation UI path working
    for video-only claims without introducing a second parallel results contract.
    """
    effective_result = result or latest_claim_video_result(claim)
    if (
        effective_result is None
        or effective_result.status != ClaimVideoAnalysisResult.Status.COMPLETED
    ):
        return False

    # Preserve the photo flow exactly as-is; video canonical sync is only for
    # claims whose primary evidence is video.
    if any(
        str(photo_path or "").strip() and not is_video_media_path(photo_path or "")
        for photo_path in claim.damage_photos.values_list("photo_path", flat=True)
    ):
        return False

    part_breakdown = serialize_claim_video_damage_assessment_rows(
        claim=claim,
        result=effective_result,
    )

    DamagePartAssessment.objects.filter(complaint=claim).delete()
    rows: list[DamagePartAssessment] = []
    for index, row in enumerate(part_breakdown):
        rows.append(
            DamagePartAssessment(
                complaint=claim,
                part_name=str(row.get("part_name") or "").strip() or "Unknown part",
                damage_type=str(row.get("damage_type") or "").strip(),
                severity_percent=Decimal(
                    str(max(0.0, min(100.0, _safe_float(row.get("severity_percent"), 0.0))))
                ),
                repair_action=str(row.get("repair_action") or "").strip(),
                estimated_amount=Decimal(
                    str(_canonical_video_estimated_amount(row))
                ),
                source_image_url=_canonical_video_source_url(row),
                sort_order=index,
            )
        )

    if rows:
        DamagePartAssessment.objects.bulk_create(rows)

    from damage_detection_llm.valuation_service import run_full_valuation
    from claims.decisioning import sync_claim_evaluation_decision_state

    run_full_valuation(claim.complaint_id, persist_sentinel=True)
    sync_claim_evaluation_decision_state(
        complaint_id=claim.complaint_id,
    )
    return True


def build_claim_video_overview(
    claim: FnolClaim,
    *,
    request=None,
) -> dict[str, Any]:
    result = latest_claim_video_result(claim)
    job = latest_claim_video_job(claim)
    asset_qs = claim.video_assets.order_by("id")
    assets: list[dict[str, Any]] = []
    build_file_url = None
    if request is not None:
        from claims.video_storage import build_claim_video_file_url

        build_file_url = build_claim_video_file_url

    for asset in asset_qs:
        assets.append(
            {
                "id": asset.id,
                "source_path": asset.source_path,
                "original_filename": asset.original_filename,
                "source_type": asset.source_type,
                "duration_ms": asset.duration_ms,
                "frame_count": asset.frame_count,
                "width": asset.width,
                "height": asset.height,
                "created_at": asset.created_at.isoformat()
                if asset.created_at
                else None,
                "updated_at": asset.updated_at.isoformat()
                if asset.updated_at
                else None,
                "file_url": build_file_url(request, asset) if build_file_url else "",
            }
        )

    damage_assessment = build_claim_video_damage_assessment_payload(
        claim=claim,
        result=result,
        job=job,
    )
    return {
        "video_asset_count": len(assets),
        "video_assets": assets,
        "video_damage_assessment": damage_assessment,
        "latest_video_analysis_status": damage_assessment["analysis_status"],
    }
