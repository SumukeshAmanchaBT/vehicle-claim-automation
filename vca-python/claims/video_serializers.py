from __future__ import annotations

from rest_framework import serializers

from claims.models import (
    ClaimVideoAnalysisResult,
    ClaimVideoAsset,
    ClaimVideoFrame,
    ClaimVideoProcessingJob,
)


class ClaimVideoAssetRegistrationSerializer(serializers.Serializer):
    source_path = serializers.CharField(required=True, max_length=512)
    original_filename = serializers.CharField(required=False, allow_blank=True, max_length=255)
    source_type = serializers.ChoiceField(
        choices=ClaimVideoAsset.SourceType.choices,
        required=False,
        default=ClaimVideoAsset.SourceType.UPLOAD,
    )


class ClaimVideoAssetDispatchSerializer(serializers.Serializer):
    asset_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
    )
    reprocess = serializers.BooleanField(required=False, default=False)
    idempotency_key = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=128,
    )


class ClaimVideoFrameSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ClaimVideoFrame
        fields = [
            "id",
            "asset_id",
            "frame_index",
            "timestamp_ms",
            "image_url",
            "image_sha256",
            "perceptual_hash",
            "motion_score",
            "scene_score",
            "clarity_score",
            "brightness_score",
            "is_representative",
            "analysis_json",
            "created_at",
            "updated_at",
        ]

    def get_image_url(self, obj):
        request = self.context.get("request")
        if not request:
            return ""
        from claims.video_storage import build_file_field_url

        return build_file_field_url(request, getattr(obj, "image", None))


class ClaimVideoAssetSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ClaimVideoAsset
        fields = [
            "id",
            "complaint_id",
            "source_path",
            "original_filename",
            "source_type",
            "sha256_hex",
            "mime_type",
            "file_size_bytes",
            "duration_ms",
            "frame_rate",
            "frame_count",
            "width",
            "height",
            "metadata_json",
            "probe_error",
            "last_probed_at",
            "created_at",
            "updated_at",
            "file_url",
        ]

    def get_file_url(self, obj):
        request = self.context.get("request")
        if not request:
            return ""
        from claims.video_storage import build_claim_video_file_url

        return build_claim_video_file_url(request, obj)


class ClaimVideoJobSerializer(serializers.ModelSerializer):
    asset_ids = serializers.SerializerMethodField()

    class Meta:
        model = ClaimVideoProcessingJob
        fields = [
            "id",
            "complaint_id",
            "status",
            "idempotency_key",
            "request_payload_json",
            "metrics_json",
            "error_json",
            "progress_stage",
            "progress_message",
            "progress_percent",
            "attempt_count",
            "max_attempts",
            "next_retry_at",
            "locked_at",
            "worker_token",
            "started_at",
            "completed_at",
            "last_heartbeat_at",
            "created_at",
            "updated_at",
            "asset_ids",
        ]

    def get_asset_ids(self, obj):
        return list(obj.assets.order_by("id").values_list("id", flat=True))


class ClaimVideoAnalysisResultSerializer(serializers.ModelSerializer):
    frames = serializers.SerializerMethodField()

    class Meta:
        model = ClaimVideoAnalysisResult
        fields = [
            "id",
            "complaint_id",
            "video_asset_id",
            "job_id",
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
            "processing_started_at",
            "processing_completed_at",
            "created_at",
            "updated_at",
            "frames",
        ]

    def get_frames(self, obj):
        frame_limit = int(self.context.get("frame_limit", 12) or 12)
        queryset = ClaimVideoFrame.objects.none()
        if obj.job_id:
            queryset = ClaimVideoFrame.objects.filter(job_id=obj.job_id)
        elif obj.video_asset_id:
            queryset = ClaimVideoFrame.objects.filter(asset_id=obj.video_asset_id)
        return ClaimVideoFrameSerializer(
            queryset.order_by("timestamp_ms", "id")[:frame_limit],
            many=True,
            context=self.context,
        ).data
