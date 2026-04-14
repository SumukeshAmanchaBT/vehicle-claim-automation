from django.contrib import admin
from .models import (
    ClaimDuplicateCandidate,
    ClaimPhase1Valuation,
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
