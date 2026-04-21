from __future__ import annotations

import hashlib
import json
import logging
from datetime import timedelta
from pathlib import Path
from typing import Any, Iterable

from django.core.files.base import ContentFile
from django.db import IntegrityError, connection, transaction
from django.db.models import Q
from django.utils import timezone

from claim_automation.llm_observability import llm_observation_context
from claim_automation.vca_config import cfg
from claims.digitization_s3 import cleanup_temp_path
from claims.models import (
    ClaimVideoAnalysisResult,
    ClaimVideoAsset,
    ClaimVideoFrame,
    ClaimVideoProcessingJob,
    FnolClaim,
)
from claims.video_analysis import analyze_video_file, probe_video_metadata
from claims.video_claim_flow import (
    persist_claim_video_damage_assessments,
    sync_video_damage_assessment_to_phase1,
)
from claims.video_runtime import (
    build_video_provider_selection_preview,
    get_video_pipeline_runtime_status,
)
from claims.video_storage import claim_video_asset_local_path
from damage_detection_llm.image_fraud_service import compute_file_sha256

logger = logging.getLogger(__name__)


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def ensure_video_asset_metadata(asset: ClaimVideoAsset) -> ClaimVideoAsset:
    """
    Probe an asset and persist its runtime metadata.
    """
    local_path = None
    needs_cleanup = False
    try:
        local_path, needs_cleanup = claim_video_asset_local_path(asset)
        metadata = probe_video_metadata(str(local_path))
        sha256_hex = compute_file_sha256(str(local_path))
        file_size_bytes = None
        try:
            file_size_bytes = local_path.stat().st_size
        except OSError:
            file_size_bytes = getattr(getattr(asset, "file", None), "size", None)

        current_source_path = str(getattr(asset, "source_path", "") or "").strip()
        is_remote_reference = current_source_path.startswith(("http://", "https://"))
        asset.source_path = (
            current_source_path
            if is_remote_reference
            else (
                str(getattr(asset.file, "name", "") or current_source_path or local_path.name)
                if getattr(asset, "file", None)
                else (current_source_path or str(local_path))
            )
        )
        asset.sha256_hex = sha256_hex
        asset.file_size_bytes = file_size_bytes
        asset.duration_ms = metadata.get("duration_ms")
        asset.frame_rate = metadata.get("frame_rate")
        asset.frame_count = metadata.get("frame_count")
        asset.width = metadata.get("width")
        asset.height = metadata.get("height")
        merged_metadata = dict(getattr(asset, "metadata_json", {}) or {})
        merged_metadata.update(_json_safe(metadata))
        asset.metadata_json = merged_metadata
        asset.probe_error = ""
        asset.last_probed_at = timezone.now()
        asset.save(
            update_fields=[
                "source_path",
                "sha256_hex",
                "file_size_bytes",
                "duration_ms",
                "frame_rate",
                "frame_count",
                "width",
                "height",
                "metadata_json",
                "probe_error",
                "last_probed_at",
                "updated_at",
            ]
        )
        return asset
    except Exception as exc:
        asset.probe_error = str(exc)
        asset.last_probed_at = timezone.now()
        asset.save(update_fields=["probe_error", "last_probed_at", "updated_at"])
        raise
    finally:
        cleanup_temp_path(local_path, needs_cleanup)


def create_video_asset_from_upload(
    *,
    claim: FnolClaim,
    uploaded_file,
    source_type: str,
) -> ClaimVideoAsset:
    asset = ClaimVideoAsset.objects.create(
        complaint=claim,
        source_path="",
        original_filename=getattr(uploaded_file, "name", "") or "",
        file=uploaded_file,
        source_type=source_type,
        file_size_bytes=getattr(uploaded_file, "size", None),
        mime_type=getattr(uploaded_file, "content_type", "") or "",
    )
    asset.source_path = str(getattr(asset.file, "name", "") or "")
    asset.save(update_fields=["source_path", "updated_at"])
    return ensure_video_asset_metadata(asset)


def register_video_asset(
    *,
    claim: FnolClaim,
    source_path: str,
    original_filename: str,
    source_type: str,
) -> ClaimVideoAsset:
    asset = ClaimVideoAsset.objects.create(
        complaint=claim,
        source_path=source_path,
        original_filename=original_filename or Path(str(source_path)).name,
        source_type=source_type,
    )
    return ensure_video_asset_metadata(asset)


def _job_idempotency_key(
    *,
    claim: FnolClaim,
    assets: Iterable[ClaimVideoAsset],
    reprocess: bool,
    payload: dict[str, Any] | None,
) -> str:
    asset_fingerprint = [
        {
            "id": asset.id,
            "sha256_hex": asset.sha256_hex,
            "source_path": asset.source_path,
            "source_type": asset.source_type,
        }
        for asset in assets
    ]
    blob = json.dumps(
        {
            "complaint_id": claim.complaint_id,
            "assets": asset_fingerprint,
            "reprocess": bool(reprocess),
            "payload": payload or {},
        },
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _latest_result_for_job(job: ClaimVideoProcessingJob) -> ClaimVideoAnalysisResult | None:
    return job.analysis_results.order_by("-created_at", "-id").first()


def create_video_processing_job(
    *,
    claim: FnolClaim,
    assets: list[ClaimVideoAsset],
    requested_by,
    request_payload: dict[str, Any] | None = None,
    reprocess: bool = False,
    idempotency_key: str = "",
) -> tuple[ClaimVideoProcessingJob, ClaimVideoAnalysisResult, bool]:
    if not assets:
        raise ValueError("At least one video asset is required.")

    normalized_payload = _json_safe(request_payload or {})
    effective_key = (
        str(idempotency_key or "").strip()
        or _job_idempotency_key(
            claim=claim,
            assets=assets,
            reprocess=reprocess,
            payload=normalized_payload,
        )
    )
    existing_job = (
        ClaimVideoProcessingJob.objects.filter(
            complaint=claim,
            idempotency_key=effective_key,
        )
        .order_by("-created_at", "-id")
        .first()
    )
    if existing_job and not reprocess:
        existing_result = _latest_result_for_job(existing_job)
        if existing_result:
            return existing_job, existing_result, False

    pipeline_runtime = get_video_pipeline_runtime_status()
    provider_selection_preview = build_video_provider_selection_preview(pipeline_runtime)
    try:
        with transaction.atomic():
            job = ClaimVideoProcessingJob.objects.create(
                complaint=claim,
                requested_by=requested_by if getattr(requested_by, "pk", None) else None,
                status=ClaimVideoProcessingJob.Status.QUEUED,
                idempotency_key=effective_key,
                request_payload_json=normalized_payload,
                metrics_json={
                    "execution_backend": "database_polling_worker",
                    "pipeline_runtime": _json_safe(pipeline_runtime),
                },
                progress_stage="queued",
                progress_message="Video analysis job queued.",
                progress_percent=0,
                max_attempts=cfg.video_job_max_attempts,
            )
            job.assets.set([asset.id for asset in assets])
            result = ClaimVideoAnalysisResult.objects.create(
                complaint=claim,
                video_asset=assets[0],
                job=job,
                status=ClaimVideoAnalysisResult.Status.PENDING,
                summary_text="Video analysis queued.",
                analysis_context_json={
                    "asset_ids": [asset.id for asset in assets],
                    "idempotency_key": effective_key,
                    "reprocess": bool(reprocess),
                    "pipeline_stage": "queued",
                    "pipeline_runtime": _json_safe(pipeline_runtime),
                    "provider_selection": _json_safe(provider_selection_preview),
                },
                progress_json={
                    "stage": "queued",
                    "percent": 0.0,
                    "message": "Video analysis job queued.",
                },
                metrics_json={
                    "video_asset_count": len(assets),
                    "execution_backend": "database_polling_worker",
                    "pipeline_runtime": _json_safe(
                        {
                            "ready": bool(pipeline_runtime.get("ready")),
                            "effective_primary_provider": pipeline_runtime.get(
                                "effective_primary_provider"
                            ),
                            "selection_reason": pipeline_runtime.get("selection_reason"),
                        }
                    ),
                },
            )
        return job, result, True
    except IntegrityError:
        if reprocess:
            raise
        existing_job = (
            ClaimVideoProcessingJob.objects.filter(
                complaint=claim,
                idempotency_key=effective_key,
            )
            .order_by("-created_at", "-id")
            .first()
        )
        existing_result = _latest_result_for_job(existing_job) if existing_job else None
        if existing_job and existing_result:
            return existing_job, existing_result, False
        raise


def _claimable_jobs_queryset():
    queryset = ClaimVideoProcessingJob.objects
    if connection.features.has_select_for_update_skip_locked:
        return queryset.select_for_update(skip_locked=True)
    return queryset.select_for_update()


def _claim_job(job_id: int, *, worker_token: str) -> ClaimVideoProcessingJob | None:
    with transaction.atomic():
        now = timezone.now()
        cutoff = now - timedelta(seconds=cfg.video_job_lock_timeout_s)
        (
            ClaimVideoProcessingJob.objects.filter(
                status=ClaimVideoProcessingJob.Status.RUNNING,
            )
            .filter(
                Q(last_heartbeat_at__isnull=True, locked_at__lt=cutoff)
                | Q(last_heartbeat_at__lt=cutoff)
            ).update(
                status=ClaimVideoProcessingJob.Status.RETRYING,
                next_retry_at=now,
                worker_token="",
                progress_stage="retrying",
                progress_message="Job lock expired; re-queued for retry.",
                locked_at=None,
                last_heartbeat_at=now,
                updated_at=now,
            )
        )

        filters = Q(id=job_id) if job_id else Q()
        eligible = (
            _claimable_jobs_queryset()
            .filter(filters)
            .filter(
                status__in=[
                    ClaimVideoProcessingJob.Status.QUEUED,
                    ClaimVideoProcessingJob.Status.RETRYING,
                ]
            )
            .filter(Q(next_retry_at__isnull=True) | Q(next_retry_at__lte=now))
            .order_by("created_at", "id")
            .first()
        )
        if not eligible:
            return None

        eligible.status = ClaimVideoProcessingJob.Status.RUNNING
        eligible.worker_token = worker_token
        eligible.locked_at = now
        eligible.started_at = eligible.started_at or now
        eligible.last_heartbeat_at = now
        eligible.attempt_count = int(eligible.attempt_count or 0) + 1
        eligible.next_retry_at = None
        eligible.progress_stage = "running"
        eligible.progress_message = "Video analysis job claimed by worker."
        eligible.progress_percent = 0
        eligible.save(
            update_fields=[
                "status",
                "worker_token",
                "locked_at",
                "started_at",
                "last_heartbeat_at",
                "attempt_count",
                "next_retry_at",
                "progress_stage",
                "progress_message",
                "progress_percent",
                "updated_at",
            ]
        )
        return eligible


def claim_video_processing_job(
    *,
    job_id: int = 0,
    worker_token: str,
) -> ClaimVideoProcessingJob | None:
    """
    Claim a queued/retrying video job for this worker token.

    Public wrapper kept intentionally small so future queue backends can reuse
    the same claimed-job execution path without reimplementing lease logic.
    """
    return _claim_job(job_id, worker_token=worker_token)


def _job_progress(
    *,
    job: ClaimVideoProcessingJob,
    result: ClaimVideoAnalysisResult,
    stage: str,
    percent: float,
    message: str,
    metrics: dict[str, Any] | None = None,
) -> None:
    now = timezone.now()
    merged_metrics = dict(job.metrics_json or {})
    if metrics:
        merged_metrics.update(_json_safe(metrics))

    progress_percent = round(max(0.0, min(100.0, float(percent or 0.0))), 2)
    job.progress_stage = stage
    job.progress_message = message
    job.progress_percent = progress_percent
    job.metrics_json = merged_metrics
    job.last_heartbeat_at = now
    if (
        job.status == ClaimVideoProcessingJob.Status.RUNNING
        and str(getattr(job, "worker_token", "") or "").strip()
    ):
        job.locked_at = now
    job.save(
        update_fields=[
            "progress_stage",
            "progress_message",
            "progress_percent",
            "metrics_json",
            "last_heartbeat_at",
            "locked_at",
            "updated_at",
        ]
    )

    result.status = ClaimVideoAnalysisResult.Status.RUNNING
    result.progress_json = {
        "stage": stage,
        "percent": progress_percent,
        "message": message,
    }
    result.metrics_json = merged_metrics
    result.processing_started_at = result.processing_started_at or now
    result.save(
        update_fields=[
            "status",
            "progress_json",
            "metrics_json",
            "processing_started_at",
            "updated_at",
        ]
    )


def _persist_frame_artifacts(
    *,
    claim: FnolClaim,
    asset: ClaimVideoAsset,
    job: ClaimVideoProcessingJob,
    frame_artifacts: list[dict[str, Any]],
) -> list[ClaimVideoFrame]:
    persisted: list[ClaimVideoFrame] = []
    for artifact in frame_artifacts:
        frame_row, _created = ClaimVideoFrame.objects.update_or_create(
            complaint=claim,
            asset=asset,
            job=job,
            timestamp_ms=int(artifact.get("timestamp_ms") or 0),
            defaults={
                "frame_index": int(artifact.get("frame_index") or 0),
                "image_sha256": hashlib.sha256(artifact["frame_bytes"]).hexdigest(),
                "perceptual_hash": str(artifact.get("fingerprint") or ""),
                "motion_score": float(artifact.get("motion_score") or 0.0),
                "scene_score": float(artifact.get("scene_score") or 0.0),
                "clarity_score": float(artifact.get("clarity_score") or 0.0),
                "brightness_score": float(artifact.get("brightness_score") or 0.0),
                "is_representative": True,
                "analysis_json": _json_safe(artifact.get("analysis") or {}),
            },
        )
        filename = (
            f"frame-{artifact.get('frame_index') or 0}-{artifact.get('timestamp_ms') or 0}.jpg"
        )
        frame_row.image.save(filename, ContentFile(artifact["frame_bytes"]), save=False)
        frame_row.save(update_fields=["image", "updated_at"])
        persisted.append(frame_row)
    return persisted


def _merge_asset_payloads(asset_payloads: list[dict[str, Any]]) -> dict[str, Any]:
    keyframes = []
    timeline = []
    asset_metrics = []
    summaries = []
    scenario_assets = []
    fraud_assets = []
    decision_assets = []
    analysis_context_assets = []
    highest_frame_fraud_score = 0.0
    damage_labels: list[str] = []
    aggregated_damage_parts: list[dict[str, Any]] = []
    currency_code = ""
    max_estimated_frame_cost = 0.0

    for payload in asset_payloads:
        asset = payload["asset"]
        result = payload["analysis"]
        summaries.append(
            {
                "asset_id": asset.id,
                "source_type": asset.source_type,
                "summary_text": result["summary_text"],
            }
        )
        asset_metrics.append(
            {
                "asset_id": asset.id,
                "source_type": asset.source_type,
                **_json_safe(result.get("metrics_json") or {}),
            }
        )
        analysis_context_assets.append(
            {
                "asset_id": asset.id,
                "source_type": asset.source_type,
                **_json_safe(result.get("analysis_context_json") or {}),
            }
        )
        scenario_assets.append(
            {
                "asset_id": asset.id,
                "source_type": asset.source_type,
                **_json_safe(result.get("scenario_summary_json") or {}),
            }
        )
        scenario_damage = (result.get("scenario_summary_json") or {}).get("damage_assessment") or {}
        if not currency_code:
            currency_code = str(scenario_damage.get("currency_code") or "").strip().upper()
        max_estimated_frame_cost = max(
            max_estimated_frame_cost,
            float(scenario_damage.get("max_estimated_frame_cost") or 0.0),
        )
        for label in scenario_damage.get("damage_labels") or []:
            label_value = str(label).strip()
            if label_value and label_value not in damage_labels:
                damage_labels.append(label_value)
        for part in scenario_damage.get("aggregated_parts") or []:
            if not isinstance(part, dict):
                continue
            aggregated_damage_parts.append(
                {
                    "asset_id": asset.id,
                    "source_type": asset.source_type,
                    **_json_safe(part),
                }
            )
        fraud_assets.append(
            {
                "asset_id": asset.id,
                "source_type": asset.source_type,
                **_json_safe(result.get("fraud_signals_json") or {}),
            }
        )
        decision_assets.append(
            {
                "asset_id": asset.id,
                "source_type": asset.source_type,
                **_json_safe(result.get("decision_support_json") or {}),
            }
        )
        highest_frame_fraud_score = max(
            highest_frame_fraud_score,
            float((result.get("metrics_json") or {}).get("highest_frame_fraud_score") or 0.0),
        )
        for frame in result.get("keyframes_json") or []:
            merged_frame = {"asset_id": asset.id, "source_type": asset.source_type, **frame}
            keyframes.append(_json_safe(merged_frame))
        for event in result.get("timeline_json") or []:
            merged_event = {"asset_id": asset.id, "source_type": asset.source_type, **event}
            timeline.append(_json_safe(merged_event))

    timeline.sort(
        key=lambda event: (
            int(event.get("timestamp_ms") or 0),
            int(event.get("asset_id") or 0),
        )
    )
    keyframes.sort(
        key=lambda frame: (
            int(frame.get("timestamp_ms") or 0),
            int(frame.get("asset_id") or 0),
        )
    )
    recommended_action = "standard_review"
    if any(
        str(asset.get("recommended_action") or "") == "manual_review"
        for asset in decision_assets
    ):
        recommended_action = "manual_review"

    structured_targets = []
    reasoning_targets = []
    structured_applied = False
    reasoning_applied = False
    pipeline_versions: list[str] = []
    for asset_context in analysis_context_assets:
        llm_pipeline = asset_context.get("llm_pipeline") or {}
        pipeline_version = str(asset_context.get("pipeline_version") or "").strip()
        if pipeline_version and pipeline_version not in pipeline_versions:
            pipeline_versions.append(pipeline_version)
        structured_target = llm_pipeline.get("structured_summary_target")
        reasoning_target = llm_pipeline.get("reasoning_target")
        if structured_target:
            structured_targets.append(structured_target)
        if reasoning_target:
            reasoning_targets.append(reasoning_target)
        structured_applied = structured_applied or bool(
            llm_pipeline.get("structured_summary_applied")
        )
        reasoning_applied = reasoning_applied or bool(
            llm_pipeline.get("reasoning_applied")
        )

    merged_pipeline_version = (
        pipeline_versions[0]
        if len(pipeline_versions) == 1
        else "video_analysis_multi_asset_v1"
    )
    return {
        "summary_text": " ".join(
            piece["summary_text"] for piece in summaries if piece.get("summary_text")
        ).strip()
        or "Video analysis completed.",
        "keyframes_json": keyframes,
        "timeline_json": timeline,
        "analysis_context_json": {
            "pipeline_version": merged_pipeline_version,
            "llm_pipeline": {
                "structured_summary_targets": structured_targets,
                "structured_summary_applied": structured_applied,
                "reasoning_targets": reasoning_targets,
                "reasoning_applied": reasoning_applied,
            },
            "pipeline_versions": pipeline_versions,
            "assets": analysis_context_assets,
        },
        "metrics_json": {
            "asset_count": len(asset_payloads),
            "assets": asset_metrics,
            "highest_frame_fraud_score": round(highest_frame_fraud_score, 2),
            "timeline_event_count": len(timeline),
            "representative_frame_count": len(keyframes),
        },
        "motion_summary_json": {
            "assets": [
                {
                    "asset_id": payload["asset"].id,
                    "source_type": payload["asset"].source_type,
                    **_json_safe(payload["analysis"].get("motion_summary_json") or {}),
                }
                for payload in asset_payloads
            ]
        },
        "scenario_summary_json": {
            "assets": scenario_assets,
            "summary_text": " ".join(
                str(asset.get("summary_text") or "")
                for asset in scenario_assets
                if asset.get("summary_text")
            ).strip(),
            "damage_assessment": {
                "currency_code": currency_code,
                "damage_labels": damage_labels,
                "aggregated_parts": aggregated_damage_parts,
                "part_count": len(aggregated_damage_parts),
                "asset_count": len(asset_payloads),
                "max_estimated_frame_cost": round(max_estimated_frame_cost, 2),
            },
        },
        "fraud_signals_json": {
            "assets": fraud_assets,
            "highest_frame_fraud_score": round(highest_frame_fraud_score, 2),
        },
        "decision_support_json": {
            "assets": decision_assets,
            "recommended_action": recommended_action,
        },
    }


def _retry_or_fail_job(
    *,
    job: ClaimVideoProcessingJob,
    result: ClaimVideoAnalysisResult,
    error: Exception,
) -> None:
    now = timezone.now()
    max_attempts = max(1, int(job.max_attempts or cfg.video_job_max_attempts))
    should_retry = int(job.attempt_count or 0) < max_attempts
    error_json = {
        "message": str(error),
        "exception_type": error.__class__.__name__,
    }
    job.error_json = error_json
    result.error_json = error_json

    if should_retry:
        backoff_seconds = cfg.video_job_retry_backoff_s * max(1, int(job.attempt_count or 1))
        retry_at = now + timedelta(seconds=backoff_seconds)
        job.status = ClaimVideoProcessingJob.Status.RETRYING
        job.next_retry_at = retry_at
        job.progress_stage = "retrying"
        job.progress_message = f"Video analysis failed; retry scheduled for {retry_at.isoformat()}."
        result.status = ClaimVideoAnalysisResult.Status.PENDING
        result.progress_json = {
            "stage": "retrying",
            "percent": float(job.progress_percent or 0.0),
            "message": job.progress_message,
        }
    else:
        job.status = ClaimVideoProcessingJob.Status.FAILED
        job.completed_at = now
        job.progress_stage = "failed"
        job.progress_message = "Video analysis failed after exhausting retries."
        result.status = ClaimVideoAnalysisResult.Status.FAILED
        result.summary_text = "Video analysis failed."
        result.processing_completed_at = now
        result.progress_json = {
            "stage": "failed",
            "percent": float(job.progress_percent or 0.0),
            "message": job.progress_message,
        }

    job.worker_token = ""
    job.locked_at = None
    job.last_heartbeat_at = now
    with transaction.atomic():
        job.save(
            update_fields=[
                "status",
                "next_retry_at",
                "completed_at",
                "progress_stage",
                "progress_message",
                "error_json",
                "worker_token",
                "locked_at",
                "last_heartbeat_at",
                "updated_at",
            ]
        )
        result.save(
            update_fields=[
                "status",
                "summary_text",
                "progress_json",
                "error_json",
                "processing_completed_at",
                "updated_at",
            ]
        )


def process_video_processing_job(
    *,
    job_id: int,
    worker_token: str,
) -> ClaimVideoProcessingJob | None:
    job = claim_video_processing_job(job_id=job_id, worker_token=worker_token)
    if job is None:
        return None

    return process_claimed_video_processing_job(job=job)


def process_claimed_video_processing_job(
    *,
    job: ClaimVideoProcessingJob,
) -> ClaimVideoProcessingJob | None:
    """
    Execute a job that has already been leased to a worker.

    This keeps the current database-polling worker fully intact while making
    the processing step reusable for future queue-based dispatchers.
    """

    result = _latest_result_for_job(job)
    if result is None:
        raise ValueError(f"Video job {job.id} has no analysis result row.")

    with llm_observation_context(
        correlation_id=f"video-job-{job.id}",
        execution_scope="video_worker",
        job_id=job.id,
        management_command="process_video_jobs",
    ):
        try:
            assets = list(job.assets.select_related("complaint").order_by("id"))
            if not assets:
                raise ValueError("No video assets were linked to the job.")

            claim = job.complaint
            asset_payloads: list[dict[str, Any]] = []
            asset_count = len(assets)
            for asset_index, asset in enumerate(assets, start=1):
                ensure_video_asset_metadata(asset)
                _job_progress(
                    job=job,
                    result=result,
                    stage="asset_preparation",
                    percent=((asset_index - 1) / max(1, asset_count)) * 100.0,
                    message=f"Preparing asset {asset_index} of {asset_count} for analysis.",
                    metrics={
                        "current_asset_id": asset.id,
                        "current_asset_index": asset_index,
                        "asset_count": asset_count,
                    },
                )

                local_path = None
                needs_cleanup = False
                try:
                    local_path, needs_cleanup = claim_video_asset_local_path(asset)

                    def _progress(stage: str, percent: float, message: str, metrics: dict[str, Any] | None):
                        asset_base = (asset_index - 1) / max(1, asset_count)
                        asset_span = 1.0 / max(1, asset_count)
                        overall_percent = (asset_base + (float(percent or 0.0) / 100.0) * asset_span) * 100.0
                        _job_progress(
                            job=job,
                            result=result,
                            stage=stage,
                            percent=overall_percent,
                            message=message,
                            metrics=metrics,
                        )

                    asset_result = analyze_video_file(
                        str(local_path),
                        complaint_id=claim.complaint_id,
                        incident_description=claim.incident_description,
                        flood_coverage=bool(getattr(claim, "flood_coverage", False)),
                        source_hint=asset.source_path or asset.original_filename,
                        progress_callback=_progress,
                    )
                    persisted_frames = _persist_frame_artifacts(
                        claim=claim,
                        asset=asset,
                        job=job,
                        frame_artifacts=asset_result["frame_artifacts"],
                    )
                    asset_result["keyframes_json"] = [
                        {
                            **frame_payload,
                            "frame_row_id": persisted_frames[index].id
                            if index < len(persisted_frames)
                            else None,
                        }
                        for index, frame_payload in enumerate(asset_result["keyframes_json"])
                    ]
                    asset_payloads.append({"asset": asset, "analysis": asset_result})
                    partial_merge = _merge_asset_payloads(asset_payloads)
                    result.keyframes_json = partial_merge["keyframes_json"]
                    result.timeline_json = partial_merge["timeline_json"]
                    result.save(update_fields=["keyframes_json", "timeline_json", "updated_at"])
                finally:
                    cleanup_temp_path(local_path, needs_cleanup)

            merged = _merge_asset_payloads(asset_payloads)
            now = timezone.now()
            result_metrics = {
                **_json_safe(result.metrics_json or {}),
                **_json_safe(merged["metrics_json"]),
            }
            job_metrics = {
                **_json_safe(job.metrics_json or {}),
                **_json_safe(merged["metrics_json"]),
                "execution_backend": "database_polling_worker",
            }
            with transaction.atomic():
                result.status = ClaimVideoAnalysisResult.Status.COMPLETED
                result.summary_text = merged["summary_text"]
                result.analysis_context_json = merged["analysis_context_json"]
                result.keyframes_json = merged["keyframes_json"]
                result.timeline_json = merged["timeline_json"]
                result.metrics_json = result_metrics
                result.motion_summary_json = merged["motion_summary_json"]
                result.scenario_summary_json = merged["scenario_summary_json"]
                result.fraud_signals_json = merged["fraud_signals_json"]
                result.decision_support_json = merged["decision_support_json"]
                result.progress_json = {
                    "stage": "completed",
                    "percent": 100.0,
                    "message": "Video analysis completed.",
                }
                result.error_json = {}
                result.processing_completed_at = now
                result.save(
                    update_fields=[
                        "status",
                        "summary_text",
                        "analysis_context_json",
                        "keyframes_json",
                        "timeline_json",
                        "metrics_json",
                        "motion_summary_json",
                        "scenario_summary_json",
                        "fraud_signals_json",
                        "decision_support_json",
                        "progress_json",
                        "error_json",
                        "processing_completed_at",
                        "updated_at",
                    ]
                )
                persist_claim_video_damage_assessments(
                    claim=claim,
                    job=job,
                    result=result,
                    scenario_summary_json=merged["scenario_summary_json"],
                )

                job.status = ClaimVideoProcessingJob.Status.COMPLETED
                job.progress_stage = "completed"
                job.progress_message = "Video analysis completed."
                job.progress_percent = 100.0
                job.completed_at = now
                job.next_retry_at = None
                job.error_json = {}
                job.locked_at = None
                job.worker_token = ""
                job.last_heartbeat_at = now
                job.metrics_json = job_metrics
                job.save(
                    update_fields=[
                        "status",
                        "progress_stage",
                        "progress_message",
                        "progress_percent",
                        "completed_at",
                        "next_retry_at",
                        "error_json",
                        "locked_at",
                        "worker_token",
                        "last_heartbeat_at",
                        "metrics_json",
                        "updated_at",
                    ]
                )
            try:
                sync_video_damage_assessment_to_phase1(
                    claim=claim,
                    result=result,
                    job=job,
                )
            except Exception:
                logger.exception(
                    "Video processing job %s completed but canonical phase-1 sync failed",
                    job.id,
                )
            return job
        except Exception as exc:
            logger.exception("Video processing job %s failed", job.id)
            _retry_or_fail_job(job=job, result=result, error=exc)
            return job


def run_ready_video_jobs(*, limit: int = 1, worker_token: str) -> list[ClaimVideoProcessingJob]:
    processed: list[ClaimVideoProcessingJob] = []
    for _ in range(max(1, int(limit or 1))):
        job = process_video_processing_job(job_id=0, worker_token=worker_token)
        if job:
            processed.append(job)
        else:
            break
    return processed


def latest_claim_video_result(claim: FnolClaim) -> ClaimVideoAnalysisResult | None:
    return (
        ClaimVideoAnalysisResult.objects.filter(complaint=claim)
        .order_by("-created_at", "-id")
        .first()
    )
