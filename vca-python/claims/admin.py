from django.contrib import admin
from .models import (
    ClaimDuplicateCandidate,
    ClaimPhase1Valuation,
    ClaimVideoAnalysisResult,
    ClaimVideoAsset,
    ClaimVideoFrame,
    ClaimVideoProcessingJob,
    DamagePartAssessment,
    ImageFraudResult,
    PricingConfig,
)


@admin.register(PricingConfig)
class PricingConfigAdmin(admin.ModelAdmin):
    list_display = ["config_key", "config_name", "config_type", "config_value", "is_active"]


@admin.register(ImageFraudResult)
class ImageFraudResultAdmin(admin.ModelAdmin):
    list_display = ["id", "complaint", "fraud_score", "created_at"]
    list_filter = ["created_at"]
    search_fields = ["complaint__complaint_id", "sha256_hex", "p_hash"]


@admin.register(ClaimDuplicateCandidate)
class ClaimDuplicateCandidateAdmin(admin.ModelAdmin):
    list_display = ["id", "complaint", "other_complaint_id", "match_reason", "similarity_score"]
    search_fields = ["complaint__complaint_id", "other_complaint_id"]


@admin.register(DamagePartAssessment)
class DamagePartAssessmentAdmin(admin.ModelAdmin):
    list_display = ["id", "complaint", "part_name", "damage_type", "estimated_amount", "sort_order"]
    search_fields = ["complaint__complaint_id", "part_name"]


@admin.register(ClaimPhase1Valuation)
class ClaimPhase1ValuationAdmin(admin.ModelAdmin):
    list_display = ["complaint", "gross_estimate", "excess_amount", "net_payable", "updated_at"]


@admin.register(ClaimVideoAsset)
class ClaimVideoAssetAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "complaint",
        "source_type",
        "original_filename",
        "duration_ms",
        "frame_count",
        "created_at",
    ]
    search_fields = ["complaint__complaint_id", "original_filename", "source_path", "sha256_hex"]


@admin.register(ClaimVideoProcessingJob)
class ClaimVideoProcessingJobAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "complaint",
        "status",
        "progress_stage",
        "progress_percent",
        "attempt_count",
        "created_at",
        "completed_at",
    ]
    search_fields = ["complaint__complaint_id", "idempotency_key"]
    list_filter = ["status", "created_at", "completed_at"]


@admin.register(ClaimVideoAnalysisResult)
class ClaimVideoAnalysisResultAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "complaint",
        "video_asset",
        "job",
        "status",
        "processing_started_at",
        "processing_completed_at",
        "created_at",
    ]
    search_fields = ["complaint__complaint_id", "summary_text"]
    list_filter = ["status", "created_at", "processing_completed_at"]


@admin.register(ClaimVideoFrame)
class ClaimVideoFrameAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "complaint",
        "asset",
        "job",
        "frame_index",
        "timestamp_ms",
        "is_representative",
        "created_at",
    ]
    search_fields = ["complaint__complaint_id", "asset__original_filename"]
    list_filter = ["is_representative", "created_at"]
