"""
Authenticated phase-3 APIs for claim video analysis and batch validation.

These endpoints are intentionally lightweight and additive. They persist a
minimal analysis snapshot from the available claim video assets, surface the
latest stored timeline on GET, and remain resilient when files are missing.
"""

from __future__ import annotations

import os
from decimal import Decimal

from django.db.models import Count
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from claims.media_paths import resolve_media_disk_path
from claims.models import (
    ClaimPhase1Valuation,
    ClaimVideoAnalysisResult,
    ClaimVideoAsset,
    DamagePartAssessment,
    FnolClaim,
)
from claims.video_jobs import create_video_processing_job, latest_claim_video_result
from claims.video_views import _claim_video_payload
from claims.views import _api_error_response


def _json_safe(value):
    """Normalize nested Decimal values for JSON payloads and JSONField writes."""
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


def _asset_file_exists(disk_path: str) -> bool:
    if not disk_path:
        return False
    try:
        return os.path.isfile(disk_path)
    except OSError:
        return False


def _serialize_video_asset(asset: ClaimVideoAsset) -> dict:
    disk_path = ""
    file_exists = False
    if getattr(asset, "file", None):
        try:
            disk_path = asset.file.path
            file_exists = _asset_file_exists(disk_path)
        except Exception:
            disk_path = str(getattr(asset.file, "name", "") or "")
            file_exists = bool(disk_path)
    if not file_exists:
        disk_path = resolve_media_disk_path(asset.source_path)
        file_exists = _asset_file_exists(disk_path)
    return {
        "id": asset.id,
        "source_path": asset.source_path,
        "original_filename": asset.original_filename or "",
        "source_type": asset.source_type,
        "job_count": asset.processing_jobs.count(),
        "frame_count": asset.frame_count,
        "duration_ms": asset.duration_ms,
        "resolved_disk_path": disk_path,
        "file_exists": file_exists,
    }


def _serialize_phase1_context(claim: FnolClaim) -> dict:
    valuation = ClaimPhase1Valuation.objects.filter(complaint=claim).first()
    part_count = DamagePartAssessment.objects.filter(complaint=claim).count()
    payload = {
        "damage_part_count": part_count,
        "valuation_present": bool(valuation),
    }
    if valuation:
        payload.update(
            {
                "gross_estimate": float(valuation.gross_estimate)
                if valuation.gross_estimate is not None
                else None,
                "excess_amount": float(valuation.excess_amount)
                if valuation.excess_amount is not None
                else None,
                "net_payable": float(valuation.net_payable)
                if valuation.net_payable is not None
                else None,
                "currency_code": valuation.currency_code or "",
                "breakdown_json": _json_safe(valuation.breakdown_json or {}),
            }
        )
    return payload


def _build_timeline_from_assets(asset_payloads: list[dict]) -> list[dict]:
    timeline = []
    for asset in asset_payloads:
        timeline.append(
            {
                "event": "video_asset_checked",
                "asset_id": asset["id"],
                "source_type": asset["source_type"],
                "source_path": asset["source_path"],
                "file_exists": asset["file_exists"],
            }
        )
    return timeline


def _latest_analysis_for_claim(claim: FnolClaim) -> ClaimVideoAnalysisResult | None:
    return latest_claim_video_result(claim)


def _analysis_payload(
    *,
    claim: FnolClaim,
    assets: list[ClaimVideoAsset],
    analysis: ClaimVideoAnalysisResult | None,
    analysis_source: str,
) -> dict:
    asset_payloads = [_serialize_video_asset(asset) for asset in assets]
    stored_timeline = analysis.timeline_json if analysis else None
    if stored_timeline:
        timeline = _json_safe(stored_timeline)
    else:
        timeline = _build_timeline_from_assets(asset_payloads)

    payload = {
        "complaint_id": claim.complaint_id,
        "analysis_source": analysis_source,
        "analysis": None,
        "timeline": timeline,
        "video_assets": asset_payloads,
        "video_asset_count": len(asset_payloads),
        "phase1_context": _serialize_phase1_context(claim),
    }
    if analysis:
        payload["analysis"] = {
            "id": analysis.id,
            "status": analysis.status,
            "job_id": analysis.job_id,
            "summary_text": analysis.summary_text or "",
            "analysis_context_json": _json_safe(analysis.analysis_context_json or {}),
            "keyframes_json": _json_safe(analysis.keyframes_json or []),
            "timeline_json": _json_safe(analysis.timeline_json or []),
            "metrics_json": _json_safe(analysis.metrics_json or {}),
            "motion_summary_json": _json_safe(analysis.motion_summary_json or {}),
            "scenario_summary_json": _json_safe(analysis.scenario_summary_json or {}),
            "fraud_signals_json": _json_safe(analysis.fraud_signals_json or {}),
            "decision_support_json": _json_safe(analysis.decision_support_json or {}),
            "progress_json": _json_safe(analysis.progress_json or {}),
            "error_json": _json_safe(analysis.error_json or {}),
            "processing_started_at": analysis.processing_started_at.isoformat()
            if analysis.processing_started_at
            else None,
            "processing_completed_at": analysis.processing_completed_at.isoformat()
            if analysis.processing_completed_at
            else None,
            "created_at": analysis.created_at.isoformat() if analysis.created_at else None,
            "updated_at": analysis.updated_at.isoformat() if analysis.updated_at else None,
            "video_asset_id": analysis.video_asset_id,
        }
    return payload


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def video_analyze(request, complaint_id: str):
    """
    POST: Persist a minimal video analysis snapshot for a claim.
    GET: Return the latest stored analysis plus its timeline.

    Shared URL shapes expected by the router:
    - /api/claims/<complaint_id>/video/analyze
    - /api/claims/<complaint_id>/timeline
    """
    claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
    if not claim:
        return _api_error_response(
            request,
            message=f"Claim {complaint_id} not found",
            developer_message="video analysis requested for a missing FNOL claim",
            error_code="claim_not_found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    assets = list(claim.video_assets.order_by("id"))
    latest_analysis = _latest_analysis_for_claim(claim)

    if request.method == "GET":
        return Response(
            _analysis_payload(
                claim=claim,
                assets=assets,
                analysis=latest_analysis,
                analysis_source="stored_analysis" if latest_analysis else "asset_timeline",
            )
        )

    wants_async_dispatch = bool(request.data) and any(
        key in request.data for key in ("asset_ids", "idempotency_key", "reprocess", "dispatch")
    )
    if wants_async_dispatch:
        asset_ids = request.data.get("asset_ids") or []
        if asset_ids:
            selected_assets = [asset for asset in assets if asset.id in asset_ids]
        else:
            selected_assets = assets
        if not selected_assets:
            return _api_error_response(
                request,
                message="No video assets were available to queue for analysis.",
                developer_message="video_analyze dispatch requested without matching video assets",
                error_code="video_assets_missing",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        job, result, created = create_video_processing_job(
            claim=claim,
            assets=selected_assets,
            requested_by=request.user,
            request_payload=request.data,
            reprocess=bool(request.data.get("reprocess")),
            idempotency_key=str(request.data.get("idempotency_key") or "").strip(),
        )
        return Response(
            _claim_video_payload(
                request,
                claim=claim,
                result=result,
                job=job,
                analysis_source="queued_job" if created else "existing_job",
            ),
            status=status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK,
        )

    asset_payloads = [_serialize_video_asset(asset) for asset in assets]
    timeline = _build_timeline_from_assets(asset_payloads)
    available_assets = [asset for asset in asset_payloads if asset["file_exists"]]
    missing_assets = [asset for asset in asset_payloads if not asset["file_exists"]]

    if not asset_payloads:
        analysis_status = ClaimVideoAnalysisResult.Status.FAILED
        summary_text = "No video assets were available for analysis."
    elif available_assets:
        analysis_status = ClaimVideoAnalysisResult.Status.COMPLETED
        summary_text = (
            f"Analyzed {len(asset_payloads)} video asset(s); "
            f"{len(available_assets)} file(s) available and {len(missing_assets)} missing."
        )
    else:
        analysis_status = ClaimVideoAnalysisResult.Status.FAILED
        summary_text = (
            f"Recorded {len(asset_payloads)} video asset(s), but all files were missing."
        )

    analysis = ClaimVideoAnalysisResult.objects.create(
        complaint=claim,
        video_asset=assets[0] if assets else None,
        status=analysis_status,
        summary_text=summary_text,
        keyframes_json=_json_safe(
            [
                {
                    "asset_id": asset["id"],
                    "source_path": asset["source_path"],
                    "file_exists": asset["file_exists"],
                }
                for asset in available_assets[:5]
            ]
        ),
        timeline_json=_json_safe(timeline),
        metrics_json=_json_safe(
            {
                "video_assets_count": len(asset_payloads),
                "available_files": len(available_assets),
                "missing_files": len(missing_assets),
                "analysis_mode": "inventory_only",
            }
        ),
    )

    return Response(
        _analysis_payload(
            claim=claim,
            assets=assets,
            analysis=analysis,
            analysis_source="persisted_analysis",
        ),
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def batch_validate_claims(request):
    """
    Validate a batch of claims using complaint_ids as the request body anchor.
    """
    complaint_ids_raw = request.data.get("complaint_ids")
    if not isinstance(complaint_ids_raw, list):
        return _api_error_response(
            request,
            message="complaint_ids must be provided as a list",
            developer_message="batch validation expects a JSON body with complaint_ids",
            error_code="invalid_request",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    complaint_ids = []
    seen = set()
    for raw in complaint_ids_raw:
        cid = str(raw or "").strip()
        if not cid or cid in seen:
            continue
        seen.add(cid)
        complaint_ids.append(cid)

    claims = {
        claim.complaint_id: claim
        for claim in FnolClaim.objects.filter(complaint_id__in=complaint_ids)
    }
    latest_analyses: dict[str, ClaimVideoAnalysisResult] = {}
    for row in ClaimVideoAnalysisResult.objects.filter(
        complaint_id__in=complaint_ids
    ).order_by("complaint_id", "-created_at", "-id"):
        latest_analyses.setdefault(row.complaint_id, row)
    video_asset_counts = {
        row["complaint_id"]: row["asset_count"]
        for row in ClaimVideoAsset.objects.filter(complaint_id__in=complaint_ids)
        .values("complaint_id")
        .annotate(asset_count=Count("id"))
    }
    part_counts = {
        row["complaint_id"]: row["part_count"]
        for row in DamagePartAssessment.objects.filter(complaint_id__in=complaint_ids)
        .values("complaint_id")
        .annotate(part_count=Count("id"))
    }

    results = []
    missing_claim_ids = []
    for complaint_id in complaint_ids:
        claim = claims.get(complaint_id)
        if not claim:
            missing_claim_ids.append(complaint_id)
            results.append(
                {
                    "complaint_id": complaint_id,
                    "validation_status": "missing_claim",
                    "claim_found": False,
                    "issues": ["claim_not_found"],
                }
            )
            continue

        assets = list(claim.video_assets.order_by("id"))
        asset_payloads = [_serialize_video_asset(asset) for asset in assets]
        missing_files = [asset for asset in asset_payloads if not asset["file_exists"]]
        analysis = latest_analyses.get(complaint_id)
        valuation = ClaimPhase1Valuation.objects.filter(complaint=claim).first()

        issues = []
        if not asset_payloads:
            issues.append("no_video_assets")
        elif len(missing_files) == len(asset_payloads):
            issues.append("all_video_files_missing")
        if not analysis:
            issues.append("no_video_analysis")
        if not valuation:
            issues.append("no_phase1_valuation")

        results.append(
            {
                "complaint_id": complaint_id,
                "validation_status": "ok" if not issues else "needs_attention",
                "claim_found": True,
                "video_assets_count": video_asset_counts.get(complaint_id, 0),
                "missing_video_files_count": len(missing_files),
                "latest_analysis_id": analysis.id if analysis else None,
                "latest_analysis_status": analysis.status if analysis else None,
                "timeline_event_count": len(analysis.timeline_json or []) if analysis else 0,
                "phase1_context": {
                    "damage_part_count": part_counts.get(complaint_id, 0),
                    "valuation_present": bool(valuation),
                    "gross_estimate": float(valuation.gross_estimate)
                    if valuation and valuation.gross_estimate is not None
                    else None,
                    "net_payable": float(valuation.net_payable)
                    if valuation and valuation.net_payable is not None
                    else None,
                },
                "issues": issues,
            }
        )

    return Response(
        {
            "complaint_ids": complaint_ids,
            "requested_count": len(complaint_ids),
            "validated_count": len(results) - len(missing_claim_ids),
            "missing_claim_ids": missing_claim_ids,
            "results": results,
        }
    )
