from __future__ import annotations

from decimal import Decimal

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from claims.models import (
    ClaimPhase1Valuation,
    ClaimVideoAnalysisResult,
    ClaimVideoProcessingJob,
    DamagePartAssessment,
    FnolClaim,
)
from claims.video_jobs import (
    create_video_asset_from_upload,
    create_video_processing_job,
    latest_claim_video_result,
    register_video_asset,
)
from claims.video_claim_flow import (
    build_claim_video_damage_assessment_payload,
    latest_claim_video_job,
)
from claims.video_runtime import get_video_pipeline_runtime_status
from claims.video_serializers import (
    ClaimVideoAnalysisResultSerializer,
    ClaimVideoAssetDispatchSerializer,
    ClaimVideoAssetRegistrationSerializer,
    ClaimVideoAssetSerializer,
    ClaimVideoJobSerializer,
)
from claims.views import _api_error_response


def _json_safe(value):
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


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


def _asset_inventory_timeline(asset_payloads: list[dict]) -> list[dict]:
    timeline = []
    for asset in asset_payloads:
        timeline.append(
            {
                "asset_id": asset["id"],
                "source_type": asset["source_type"],
                "summary": "Video asset registered for claim analysis.",
            }
        )
    return timeline


def _claim_video_payload(
    request,
    *,
    claim: FnolClaim,
    result: ClaimVideoAnalysisResult | None,
    job: ClaimVideoProcessingJob | None = None,
    analysis_source: str,
) -> dict:
    assets = list(claim.video_assets.order_by("id"))
    asset_payloads = ClaimVideoAssetSerializer(
        assets,
        many=True,
        context={"request": request},
    ).data
    analysis_payload = (
        ClaimVideoAnalysisResultSerializer(
            result,
            context={"request": request},
        ).data
        if result is not None
        else None
    )
    timeline = []
    if analysis_payload:
        timeline = analysis_payload.get("timeline_json") or []
    if not timeline:
        timeline = _asset_inventory_timeline(asset_payloads)

    latest_job = job
    if latest_job is None:
        latest_job = latest_claim_video_job(claim)

    return {
        "complaint_id": claim.complaint_id,
        "analysis_source": analysis_source,
        "analysis": analysis_payload,
        "timeline": timeline,
        "video_assets": asset_payloads,
        "video_asset_count": len(asset_payloads),
        "job": ClaimVideoJobSerializer(latest_job).data if latest_job else None,
        "video_pipeline_runtime": get_video_pipeline_runtime_status(),
        "video_damage_assessment": build_claim_video_damage_assessment_payload(
            claim=claim,
            result=result,
            job=latest_job,
        ),
        "phase1_context": _serialize_phase1_context(claim),
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def video_assets_collection(request, complaint_id: str):
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)

    if request.method == "GET":
        assets = claim.video_assets.order_by("id")
        serializer = ClaimVideoAssetSerializer(
            assets,
            many=True,
            context={"request": request},
        )
        return Response(
            {
                "complaint_id": claim.complaint_id,
                "video_assets": serializer.data,
                "video_asset_count": len(serializer.data),
            },
            status=status.HTTP_200_OK,
        )

    source_type = request.data.get("source_type") or "upload"
    created_assets = []

    files = request.FILES.getlist("files")
    if files:
        for uploaded_file in files:
            try:
                created_assets.append(
                    create_video_asset_from_upload(
                        claim=claim,
                        uploaded_file=uploaded_file,
                        source_type=source_type,
                    )
                )
            except Exception as exc:
                return _api_error_response(
                    request,
                    message="Unable to ingest uploaded video asset.",
                    developer_message=str(exc),
                    error_code="video_asset_ingest_failed",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
    else:
        assets_payload = request.data.get("assets")
        if not isinstance(assets_payload, list) or not assets_payload:
            return _api_error_response(
                request,
                message="Provide files or an assets list.",
                developer_message="Video asset creation requires multipart files or a JSON assets array.",
                error_code="invalid_video_asset_payload",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        for raw_asset in assets_payload:
            serializer = ClaimVideoAssetRegistrationSerializer(data=raw_asset)
            serializer.is_valid(raise_exception=True)
            try:
                created_assets.append(
                    register_video_asset(
                        claim=claim,
                        source_path=serializer.validated_data["source_path"],
                        original_filename=serializer.validated_data.get("original_filename")
                        or "",
                        source_type=serializer.validated_data["source_type"],
                    )
                )
            except Exception as exc:
                return _api_error_response(
                    request,
                    message="Unable to register video asset.",
                    developer_message=str(exc),
                    error_code="video_asset_registration_failed",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

    response_serializer = ClaimVideoAssetSerializer(
        created_assets,
        many=True,
        context={"request": request},
    )
    return Response(
        {
            "complaint_id": claim.complaint_id,
            "video_assets": response_serializer.data,
            "video_asset_count": len(response_serializer.data),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def video_jobs_collection(request, complaint_id: str):
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    serializer = ClaimVideoAssetDispatchSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    asset_ids = serializer.validated_data.get("asset_ids") or []
    if asset_ids:
        assets = list(claim.video_assets.filter(id__in=asset_ids).order_by("id"))
    else:
        assets = list(claim.video_assets.order_by("id"))

    if not assets:
        return _api_error_response(
            request,
            message="No video assets were found for this claim.",
            developer_message="Dispatch requested without any registered claim video assets.",
            error_code="video_assets_missing",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    job, result, created = create_video_processing_job(
        claim=claim,
        assets=assets,
        requested_by=request.user,
        request_payload=serializer.validated_data,
        reprocess=serializer.validated_data.get("reprocess", False),
        idempotency_key=serializer.validated_data.get("idempotency_key", ""),
    )
    payload = _claim_video_payload(
        request,
        claim=claim,
        result=result,
        job=job,
        analysis_source="queued_job" if created else "existing_job",
    )
    payload.update(
        {
            "poll_url": request.build_absolute_uri(
                f"/api/claims/{claim.complaint_id}/video/jobs/{job.id}"
            ),
            "result_url": request.build_absolute_uri(
                f"/api/claims/{claim.complaint_id}/video/results"
            ),
        }
    )
    return Response(
        payload,
        status=status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK,
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def video_damage_assessment(request, complaint_id: str):
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    latest_result = latest_claim_video_result(claim)
    latest_job = latest_claim_video_job(claim)

    if request.method == "GET":
        return Response(
            _claim_video_payload(
                request,
                claim=claim,
                result=latest_result,
                job=latest_job,
                analysis_source="stored_analysis" if latest_result else "asset_inventory",
            ),
            status=status.HTTP_200_OK,
        )

    serializer = ClaimVideoAssetDispatchSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    reprocess = serializer.validated_data.get("reprocess", False)
    asset_ids = serializer.validated_data.get("asset_ids") or []

    if asset_ids:
        assets = list(claim.video_assets.filter(id__in=asset_ids).order_by("id"))
    else:
        assets = list(claim.video_assets.order_by("id"))
    requested_asset_ids = [asset.id for asset in assets]
    latest_job_asset_ids = (
        list(latest_job.assets.order_by("id").values_list("id", flat=True))
        if latest_job is not None
        else []
    )
    selection_matches_latest = requested_asset_ids == latest_job_asset_ids

    if not assets:
        if latest_result is not None:
            return Response(
                _claim_video_payload(
                    request,
                    claim=claim,
                    result=latest_result,
                    job=latest_job,
                    analysis_source="stored_analysis",
                ),
                status=status.HTTP_200_OK,
            )
        return _api_error_response(
            request,
            message="No claim-linked videos were found for this claim.",
            developer_message="Video damage assessment was requested before any video asset was registered.",
            error_code="video_assets_missing",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if (
        not reprocess
        and selection_matches_latest
        and latest_job is not None
        and latest_job.status
        in {
            ClaimVideoProcessingJob.Status.QUEUED,
            ClaimVideoProcessingJob.Status.RUNNING,
            ClaimVideoProcessingJob.Status.RETRYING,
        }
    ):
        return Response(
            _claim_video_payload(
                request,
                claim=claim,
                result=latest_result,
                job=latest_job,
                analysis_source="existing_job",
            ),
            status=status.HTTP_200_OK,
        )

    if (
        not reprocess
        and selection_matches_latest
        and latest_result is not None
        and latest_result.status == ClaimVideoAnalysisResult.Status.COMPLETED
    ):
        return Response(
            _claim_video_payload(
                request,
                claim=claim,
                result=latest_result,
                job=latest_job,
                analysis_source="stored_analysis",
            ),
            status=status.HTTP_200_OK,
        )

    job, result, created = create_video_processing_job(
        claim=claim,
        assets=assets,
        requested_by=request.user,
        request_payload=serializer.validated_data,
        reprocess=reprocess,
        idempotency_key=serializer.validated_data.get("idempotency_key", ""),
    )
    payload = _claim_video_payload(
        request,
        claim=claim,
        result=result,
        job=job,
        analysis_source="queued_job" if created else "existing_job",
    )
    payload.update(
        {
            "poll_url": request.build_absolute_uri(
                f"/api/claims/{claim.complaint_id}/video/jobs/{job.id}"
            ),
            "result_url": request.build_absolute_uri(
                f"/api/claims/{claim.complaint_id}/video/results"
            ),
        }
    )
    return Response(
        payload,
        status=status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def video_job_detail(request, complaint_id: str, job_id: int):
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    job = get_object_or_404(
        ClaimVideoProcessingJob.objects.prefetch_related("assets"),
        complaint=claim,
        id=job_id,
    )
    serializer = ClaimVideoJobSerializer(job)
    return Response(
        {
            "complaint_id": claim.complaint_id,
            "job": serializer.data,
            "video_pipeline_runtime": get_video_pipeline_runtime_status(),
            "analysis": ClaimVideoAnalysisResultSerializer(
                job.analysis_results.order_by("-created_at", "-id").first(),
                context={"request": request},
            ).data
            if job.analysis_results.exists()
            else None,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def video_results(request, complaint_id: str):
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    result = latest_claim_video_result(claim)
    if result is None:
        return Response(
            _claim_video_payload(
                request,
                claim=claim,
                result=None,
                analysis_source="asset_inventory",
            ),
            status=status.HTTP_200_OK,
        )
    return Response(
        _claim_video_payload(
            request,
            claim=claim,
            result=result,
            analysis_source="stored_analysis",
        ),
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def video_timeline(request, complaint_id: str):
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    result = latest_claim_video_result(claim)
    analysis_source = "stored_analysis" if result else "asset_inventory"
    return Response(
        _claim_video_payload(
            request,
            claim=claim,
            result=result,
            analysis_source=analysis_source,
        ),
        status=status.HTTP_200_OK,
    )
