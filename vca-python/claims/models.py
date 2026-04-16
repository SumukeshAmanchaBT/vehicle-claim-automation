from uuid import uuid4

from django.conf import settings
from django.db import models
from pathlib import Path


class FnolClaim(models.Model):
    """
    Stores FNOL claim data (fnol_claims table).
    Uses complaint_id as primary key.
    """

    complaint_id = models.CharField(max_length=20, primary_key=True)
    # Insurer product labels (e.g. Thai motor classes, regional naming) — keep long enough for PAS strings
    coverage_type = models.CharField(max_length=128, null=True, blank=True)
    policy_number = models.CharField(max_length=50, null=True, blank=True)
    policy_status = models.CharField(max_length=20, null=True, blank=True)
    policy_start_date = models.DateField(null=True, blank=True)
    policy_end_date = models.DateField(null=True, blank=True)
    policy_holder_name = models.CharField(max_length=100, null=True, blank=True)
    vehicle_make = models.CharField(max_length=50, null=True, blank=True, db_column="vehicle_make")
    vehicle_year = models.IntegerField(null=True, blank=True)
    vehicle_model = models.CharField(max_length=50, null=True, blank=True)
    vehicle_registration_number = models.CharField(max_length=20, null=True, blank=True)
    incident_type = models.CharField(max_length=50, null=True, blank=True, db_column="incident_type")
    incident_description = models.TextField(null=True, blank=True)
    incident_date_time = models.DateTimeField(null=True, blank=True)
    accident_location = models.CharField(max_length=255, null=True, blank=True)
    liability_admission = models.BooleanField(default=False, null=True, blank=True)
    dashcam_cctv_evidence = models.BooleanField(default=False, null=True, blank=True)
    injury_indicator = models.BooleanField(default=False, null=True, blank=True)
    commercial_vehicle = models.BooleanField(default=False, null=True, blank=True)
    flood_coverage = models.BooleanField(default=False, null=True, blank=True)
    fir_document_copy = models.CharField(max_length=255, null=True, blank=True)
    insurance_document_copy = models.CharField(max_length=255, null=True, blank=True)
    excess_amount = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True, default=0
    )
    claim_status = models.ForeignKey(
        "ClaimStatus",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="claim_status",
        related_name="fnol_claims",
    )
    re_open = models.IntegerField(
        default=0,
        null=True,
        blank=True,
        db_column="re_open",
        help_text="0 = new/fetched claim, 1 = re-opened (or other use). Set to 0 when saving via Fetch FNOL Data.",
    )
    created_date = models.DateTimeField(null=True, blank=True, db_column="created_date")
    created_by = models.CharField(max_length=150, null=True, blank=True, db_column="created_by")
    updated_date = models.DateTimeField(null=True, blank=True, db_column="updated_date")
    updated_by = models.CharField(max_length=150, null=True, blank=True, db_column="updated_by")

    class Meta:
        db_table = "fnol_claims"
        indexes = [
            models.Index(
                fields=["incident_date_time", "complaint_id"],
                name="fnol_incident_claim_idx",
            ),
            models.Index(
                fields=["re_open", "incident_date_time"],
                name="fnol_reopen_incident_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"FnolClaim(complaint_id={self.complaint_id})"


class FnolDamagePhoto(models.Model):
    """
    Stores damage photo paths for FNOL claims (fnol_damage_photos table).
    """

    id = models.BigAutoField(primary_key=True)
    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="damage_photos",
    )
    photo_path = models.CharField(max_length=255)

    class Meta:
        db_table = "fnol_damage_photos"

    def __str__(self) -> str:
        return f"FnolDamagePhoto(id={self.id}, complaint_id={self.complaint_id})"


class ClaimEvaluationResponse(models.Model):
    """
    Stores evaluation results from process_claim / fraud detection (claim_evaluation_response table).
    Supports versioning: each new evaluation for a complaint_id is stored as a new row with
    version = max(version for complaint_id) + 1 and is_latest=True; previous rows get is_latest=False.
    """

    complaint_id = models.CharField(max_length=20, db_column="complaint_id")
    version = models.PositiveIntegerField(
        default=1,
        help_text="Version number per complaint_id (1, 2, 3...). New evaluation = new version.",
    )
    is_latest = models.BooleanField(
        default=True,
        db_index=True,
        help_text="True only for the most recent evaluation row for this complaint_id.",
    )
    damage_confidence = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True, default=0
    )
    estimated_amount = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, default=0
    )
    claim_amount = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True, default=0
    )
    threshold_value = models.IntegerField(null=True, blank=True, default=0)
    claim_type = models.CharField(max_length=20, null=True, blank=True)
    decision = models.CharField(max_length=20, null=True, blank=True)
    claim_status = models.CharField(max_length=50, null=True, blank=True)
    reason = models.TextField(null=True, blank=True)
    fraud_band = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        help_text="Normalized fraud band from business-rule validation (e.g. Low, High).",
    )
    fraud_rule_results = models.JSONField(
        null=True,
        blank=True,
        help_text="Persisted Business Rule Validation rule-by-rule snapshot for UI and reports.",
    )
    llm_damages = models.TextField(
        null=True,
        blank=True,
        help_text="LLM damage detection result as JSON array (e.g. [\"scratch\",\"dent\"]).",
    )
    llm_severity = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        help_text="LLM severity classification: minor, moderate, severe, None, unknown.",
    )

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.IntegerField(null=True, blank=True)
    updated_date = models.DateTimeField(auto_now=True)
    updated_by = models.IntegerField(null=True, blank=True)
    deleted_date = models.DateTimeField(null=True, blank=True)
    deleted_by = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = "claim_evaluation_response"
        indexes = [
            models.Index(fields=["complaint_id", "is_latest"], name="cer_complaint_latest"),
            models.Index(fields=["complaint_id", "version"], name="cer_complaint_version"),
        ]

    def __str__(self) -> str:
        return f"ClaimEvaluationResponse(id={self.id}, complaint_id={self.complaint_id}, v={self.version})"


class ImageFraudResult(models.Model):
    """
    Per-image fraud / media-trust signals (hashes, EXIF, ELA, composite score, optional LLM notes).
    One row per analysis run per image source (re-runs create new rows).
    """

    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="image_fraud_results",
    )
    damage_photo = models.ForeignKey(
        "FnolDamagePhoto",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fraud_results",
    )
    image_source_url = models.TextField(blank=True, default="")
    photo_path = models.CharField(max_length=512, blank=True, default="")
    sha256_hex = models.CharField(max_length=64, blank=True, default="", db_index=True)
    p_hash = models.CharField(max_length=32, blank=True, default="", db_index=True)
    d_hash = models.CharField(max_length=32, blank=True, default="", db_index=True)
    a_hash = models.CharField(max_length=32, blank=True, default="")
    exif_json = models.JSONField(null=True, blank=True)
    ela_score = models.FloatField(null=True, blank=True)
    fraud_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    signals_json = models.JSONField(null=True, blank=True)
    llm_authenticity_notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "image_fraud_results"
        indexes = [
            models.Index(fields=["complaint", "-created_at"], name="ifr_complaint_created"),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"ImageFraudResult(id={self.id}, complaint_id={self.complaint_id})"


class ClaimDuplicateCandidate(models.Model):
    """
    Cross-claim image reuse / near-duplicate hints (pHash/dHash/etc.).
    """

    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="duplicate_candidates",
    )
    other_complaint_id = models.CharField(max_length=20, db_index=True)
    match_reason = models.CharField(max_length=64)
    similarity_score = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    evidence_json = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "claim_duplicate_candidates"
        indexes = [
            models.Index(
                fields=["complaint", "other_complaint_id"],
                name="cdc_complaint_other",
            ),
        ]
        ordering = ["-similarity_score", "-created_at"]

    def __str__(self) -> str:
        return f"ClaimDuplicateCandidate({self.complaint_id} -> {self.other_complaint_id})"


class DamagePartAssessment(models.Model):
    """
    Structured part-level damage lines (part, type, severity %, repair action, estimated cost).
    """

    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="damage_part_assessments",
    )
    part_name = models.CharField(max_length=255)
    damage_type = models.CharField(max_length=128, blank=True, default="")
    severity_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    repair_action = models.CharField(max_length=255, blank=True, default="")
    estimated_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    source_image_url = models.TextField(blank=True, default="")
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "damage_part_assessments"
        indexes = [
            models.Index(fields=["complaint", "sort_order"], name="dpa_complaint_sort"),
        ]
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"DamagePartAssessment({self.complaint_id}: {self.part_name})"


class ClaimPhase1Valuation(models.Model):
    """
    Snapshot of gross repair estimate, excess/deductible, and net payable (from part rows + rules).
    """

    complaint = models.OneToOneField(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="phase1_valuation",
        primary_key=True,
    )
    gross_estimate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    excess_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    net_payable = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency_code = models.CharField(max_length=8, blank=True, default="")
    breakdown_json = models.JSONField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_phase1_valuation"

    def __str__(self) -> str:
        return f"ClaimPhase1Valuation(complaint_id={self.complaint_id})"


class CanonicalImageDamageAssessment(models.Model):
    """
    Shared, context-aware assessment snapshot for an exact image.

    This lets identical image bytes reuse the same part breakdown and pricing
    when the legitimate pricing context is also the same.
    """

    sha256_hex = models.CharField(max_length=64, db_index=True)
    assessment_context_key = models.CharField(max_length=64, db_index=True)
    assessment_context_json = models.JSONField(default=dict)
    analysis_source = models.CharField(max_length=32, blank=True, default="")
    source_claim_id = models.CharField(max_length=20, blank=True, default="")
    source_photo_path = models.CharField(max_length=512, blank=True, default="")
    part_breakdown_json = models.JSONField(default=list)
    total_estimated_cost = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    currency_code = models.CharField(max_length=8, blank=True, default="")
    pipeline_metadata_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "canonical_image_damage_assessments"
        constraints = [
            models.UniqueConstraint(
                fields=["sha256_hex", "assessment_context_key"],
                name="uniq_canonical_image_damage_assessment",
            ),
        ]
        indexes = [
            models.Index(
                fields=["sha256_hex", "assessment_context_key"],
                name="cida_sha_ctx",
            ),
        ]

    def __str__(self) -> str:
        return (
            "CanonicalImageDamageAssessment("
            f"sha256={self.sha256_hex[:12]}, ctx={self.assessment_context_key[:12]})"
        )


class ClaimCardInsight(models.Model):
    """
    Persisted snapshot of structured damage-assessment card summaries/details per claim.
    One row per (claim, card_key); refreshed without mutating ClaimEvaluationResponse.
    """

    class CardKey(models.TextChoices):
        IMAGE_AUTHENTICITY = "image_authenticity", "Image authenticity"
        DUPLICATE_SCREENING = "duplicate_screening", "Duplicate screening"
        ESTIMATED_VALUE = "estimated_value", "Estimated value"
        DAMAGE_DETECTION = "damage_detection", "Damage detection"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        PARTIAL = "partial", "Partial"
        FAILED = "failed", "Failed"

    claim = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="card_insights",
    )
    card_key = models.CharField(max_length=64, choices=CardKey.choices)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    summary_json = models.JSONField(default=dict)
    evidence_json = models.JSONField(default=dict)
    narrative_json = models.JSONField(default=dict)
    source_snapshot_hash = models.CharField(max_length=128, null=True, blank=True)
    model_version = models.CharField(max_length=64, null=True, blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    error_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_card_insights"
        constraints = [
            models.UniqueConstraint(
                fields=["claim", "card_key"],
                name="uniq_claim_card_insight",
            ),
        ]
        indexes = [
            models.Index(fields=["claim", "card_key"], name="cci_claim_card"),
            models.Index(fields=["status"], name="cci_status"),
        ]

    def __str__(self) -> str:
        return f"ClaimCardInsight({self.claim_id}, {self.card_key})"


class ClaimValuationExplanation(models.Model):
    """
    Persisted phase-2 pricing explanation snapshot for a claim.

    Keeps the explanation layer additive to the existing phase-1 valuation row.
    """

    complaint = models.OneToOneField(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="valuation_explanation",
        primary_key=True,
    )
    pricing_source = models.CharField(max_length=64, blank=True, default="")
    confidence_level = models.CharField(max_length=32, blank=True, default="")
    reasoning_summary = models.TextField(blank=True, default="")
    explanation_json = models.JSONField(default=dict)
    pricing_rule_snapshot_json = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_valuation_explanations"

    def __str__(self) -> str:
        return f"ClaimValuationExplanation(complaint_id={self.complaint_id})"


def claim_video_asset_upload_to(instance, filename):
    safe_name = Path(filename or "").name
    suffix = Path(safe_name).suffix or ".bin"
    return f"claim_videos/{instance.complaint_id}/{uuid4().hex}{suffix}"


def claim_video_frame_upload_to(instance, filename):
    safe_name = Path(filename or "").name
    suffix = Path(safe_name).suffix or ".jpg"
    asset_id = getattr(instance, "asset_id", None) or "unknown"
    job_id = getattr(instance, "job_id", None) or "unknown"
    frame_index = getattr(instance, "frame_index", 0)
    timestamp_ms = getattr(instance, "timestamp_ms", 0)
    return (
        f"claim_videos/frames/{instance.complaint_id}/{job_id}/{asset_id}/"
        f"{frame_index}-{timestamp_ms}{suffix}"
    )


class ClaimVideoAsset(models.Model):
    """
    Claim-linked video media for phase-3 analysis.
    """

    class SourceType(models.TextChoices):
        DASHCAM = "dashcam", "Dashcam"
        CCTV = "cctv", "CCTV"
        UPLOAD = "upload", "Upload"

    id = models.BigAutoField(primary_key=True)
    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="video_assets",
    )
    source_path = models.CharField(max_length=512)
    original_filename = models.CharField(max_length=255, blank=True, default="")
    file = models.FileField(
        upload_to=claim_video_asset_upload_to,
        null=True,
        blank=True,
        max_length=512,
    )
    source_type = models.CharField(
        max_length=20,
        choices=SourceType.choices,
        default=SourceType.UPLOAD,
        db_index=True,
    )
    sha256_hex = models.CharField(max_length=64, blank=True, default="", db_index=True)
    mime_type = models.CharField(max_length=128, blank=True, default="")
    file_size_bytes = models.BigIntegerField(null=True, blank=True)
    duration_ms = models.BigIntegerField(null=True, blank=True)
    frame_rate = models.DecimalField(
        max_digits=12, decimal_places=4, null=True, blank=True
    )
    frame_count = models.BigIntegerField(null=True, blank=True)
    width = models.IntegerField(null=True, blank=True)
    height = models.IntegerField(null=True, blank=True)
    metadata_json = models.JSONField(default=dict)
    probe_error = models.TextField(blank=True, default="")
    last_probed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_video_assets"
        indexes = [
            models.Index(fields=["complaint", "source_type"], name="cva_claim_source"),
            models.Index(fields=["complaint", "sha256_hex"], name="cva_claim_sha"),
        ]
        ordering = ["id"]

    def __str__(self) -> str:
        return f"ClaimVideoAsset(id={self.id}, complaint_id={self.complaint_id})"


class ClaimVideoProcessingJob(models.Model):
    """
    Durable async-safe processing job for claim video analysis.
    """

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        RETRYING = "retrying", "Retrying"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    id = models.BigAutoField(primary_key=True)
    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="video_processing_jobs",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="claim_video_processing_jobs",
    )
    assets = models.ManyToManyField(
        "ClaimVideoAsset",
        related_name="processing_jobs",
        blank=True,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.QUEUED,
        db_index=True,
    )
    idempotency_key = models.CharField(max_length=128, blank=True, default="")
    request_payload_json = models.JSONField(default=dict)
    metrics_json = models.JSONField(default=dict)
    error_json = models.JSONField(default=dict)
    progress_stage = models.CharField(max_length=64, blank=True, default="")
    progress_message = models.CharField(max_length=255, blank=True, default="")
    progress_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=0
    )
    attempt_count = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=0)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    worker_token = models.CharField(max_length=64, blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    last_heartbeat_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_video_processing_jobs"
        constraints = [
            models.UniqueConstraint(
                fields=["complaint", "idempotency_key"],
                name="uniq_claim_video_processing_job_idem",
            ),
        ]
        indexes = [
            models.Index(
                fields=["complaint", "status", "created_at"],
                name="cvpj_claim_status",
            ),
            models.Index(
                fields=["status", "next_retry_at"],
                name="cvpj_retry_schedule",
            ),
        ]
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"ClaimVideoProcessingJob(id={self.id}, complaint_id={self.complaint_id})"


class ClaimVideoAnalysisResult(models.Model):
    """
    Phase-3 POC timeline + frame analysis snapshot for a claim video.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    id = models.BigAutoField(primary_key=True)
    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="video_analysis_results",
    )
    video_asset = models.ForeignKey(
        "ClaimVideoAsset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="analysis_results",
    )
    job = models.ForeignKey(
        "ClaimVideoProcessingJob",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="analysis_results",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    summary_text = models.TextField(blank=True, default="")
    analysis_context_json = models.JSONField(default=dict)
    keyframes_json = models.JSONField(default=list)
    timeline_json = models.JSONField(default=list)
    metrics_json = models.JSONField(default=dict)
    motion_summary_json = models.JSONField(default=dict)
    scenario_summary_json = models.JSONField(default=dict)
    fraud_signals_json = models.JSONField(default=dict)
    decision_support_json = models.JSONField(default=dict)
    progress_json = models.JSONField(default=dict)
    error_json = models.JSONField(default=dict)
    processing_started_at = models.DateTimeField(null=True, blank=True)
    processing_completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_video_analysis_results"
        indexes = [
            models.Index(fields=["complaint", "-created_at"], name="cvar_claim_created"),
            models.Index(fields=["status"], name="cvar_status"),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"ClaimVideoAnalysisResult(id={self.id}, complaint_id={self.complaint_id})"


class ClaimVideoDamageAssessment(models.Model):
    """
    Claim-level persisted video damage findings, mirroring image part rows
    while preserving video-specific temporal context.
    """

    id = models.BigAutoField(primary_key=True)
    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        related_name="video_damage_assessments",
    )
    video_asset = models.ForeignKey(
        "ClaimVideoAsset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="damage_assessments",
    )
    job = models.ForeignKey(
        "ClaimVideoProcessingJob",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="damage_assessments",
    )
    analysis_result = models.ForeignKey(
        "ClaimVideoAnalysisResult",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="damage_assessments",
    )
    part_name = models.CharField(max_length=255)
    damage_type = models.CharField(max_length=128, blank=True, default="")
    severity_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
    )
    repair_action = models.CharField(max_length=255, blank=True, default="")
    estimated_amount_min = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )
    estimated_amount_max = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )
    currency_code = models.CharField(max_length=8, blank=True, default="")
    observed_frame_count = models.PositiveIntegerField(default=0)
    observed_timestamps_json = models.JSONField(default=list)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_video_damage_assessments"
        indexes = [
            models.Index(
                fields=["complaint", "sort_order"],
                name="cvda_claim_sort",
            ),
            models.Index(
                fields=["analysis_result", "video_asset"],
                name="cvda_result_asset",
            ),
        ]
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return (
            "ClaimVideoDamageAssessment("
            f"id={self.id}, complaint_id={self.complaint_id}, part={self.part_name})"
        )


class ClaimVideoFrame(models.Model):
    """
    Persisted extracted frame metadata and optional image artifact for one job.
    """

    id = models.BigAutoField(primary_key=True)
    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="video_frames",
    )
    asset = models.ForeignKey(
        "ClaimVideoAsset",
        on_delete=models.CASCADE,
        related_name="frames",
    )
    job = models.ForeignKey(
        "ClaimVideoProcessingJob",
        on_delete=models.CASCADE,
        related_name="frames",
    )
    frame_index = models.BigIntegerField()
    timestamp_ms = models.BigIntegerField(db_index=True)
    image = models.ImageField(
        upload_to=claim_video_frame_upload_to,
        null=True,
        blank=True,
        max_length=512,
    )
    image_sha256 = models.CharField(max_length=64, blank=True, default="")
    perceptual_hash = models.CharField(max_length=64, blank=True, default="")
    motion_score = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True
    )
    scene_score = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True
    )
    clarity_score = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True
    )
    brightness_score = models.DecimalField(
        max_digits=12, decimal_places=6, null=True, blank=True
    )
    is_representative = models.BooleanField(default=False)
    analysis_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_video_frames"
        constraints = [
            models.UniqueConstraint(
                fields=["job", "asset", "timestamp_ms"],
                name="uniq_claim_video_frame_job_asset_ts",
            ),
        ]
        indexes = [
            models.Index(fields=["complaint", "job"], name="cvf_claim_job"),
            models.Index(fields=["asset", "is_representative"], name="cvf_asset_repr"),
        ]
        ordering = ["timestamp_ms", "id"]

    def __str__(self) -> str:
        return (
            "ClaimVideoFrame("
            f"id={self.id}, complaint_id={self.complaint_id}, timestamp_ms={self.timestamp_ms})"
        )


class ClaimRuleMaster(models.Model):
    """
    Master table for all rules (policy / fraud / damage / document).
    """

    rule_id = models.BigAutoField(primary_key=True)
    rule_type = models.CharField(max_length=50)  # Policy / Fraud / Damage / Document
    rule_group = models.CharField(max_length=100)
    rule_description = models.TextField()
    rule_expression = models.TextField()
    is_active = models.BooleanField(default=True)

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, null=True, blank=True)

    class Meta:
        db_table = "claim_rule_master"

    def __str__(self) -> str:
        return f"Rule {self.rule_id} - {self.rule_type}"


class DamageCodeMaster(models.Model):
    """
    Master table for different damage codes (e.g. bumper, glass, door, engine).
    """

    damage_id = models.BigAutoField(primary_key=True, db_column="damage_id")
    damage_type = models.CharField(max_length=100)
    severity_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    is_active = models.BooleanField(default=True)

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, null=True, blank=True)

    class Meta:
        db_table = "damage_code_master"

    def __str__(self) -> str:
        return f"Damage {self.damage_id} - {self.damage_type}"


class ClaimTypeMaster(models.Model):
    """
    Master table for different claim types (SIMPLE, MEDIUM, COMPLEX).
    risk_min and risk_max define the Risk % Range for each type.
    """

    claim_type_id = models.BigAutoField(primary_key=True)
    claim_type_name = models.CharField(max_length=100)
    risk_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    risk_min = models.DecimalField(
        max_digits=5, decimal_places=2, default=0
    )
    risk_max = models.DecimalField(
        max_digits=5, decimal_places=2, default=100
    )
    is_active = models.BooleanField(default=True)

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, null=True, blank=True)

    class Meta:
        db_table = "claim_type_master"

    def __str__(self) -> str:
        return f"ClaimType {self.claim_type_id} - {self.claim_type_name}"


class Claim(models.Model):
    """
    Stores the evaluated claim record after the rules engine has run.
    This is the main entity exposed to the frontend for list/detail views.
    """

    SIMPLE = "SIMPLE"
    MEDIUM = "MEDIUM"
    COMPLEX = "COMPLEX"

    CLAIM_TYPE_CHOICES = [
        (SIMPLE, "Simple"),
        (MEDIUM, "Medium"),
        (COMPLEX, "Complex"),
    ]

    AUTOMATION_SIMPLE = "Simple"
    AUTOMATION_COMPLEX = "Complex"

    AUTOMATION_FLAG_CHOICES = [
        (AUTOMATION_SIMPLE, "Simple"),
        (AUTOMATION_COMPLEX, "Complex"),
    ]

    DECISION_AUTO_APPROVE = "Auto Approve"
    DECISION_MANUAL_REVIEW = "Manual Review"
    DECISION_REJECT = "Reject"

    DECISION_CHOICES = [
        (DECISION_AUTO_APPROVE, "Auto Approve"),
        (DECISION_MANUAL_REVIEW, "Manual Review"),
        (DECISION_REJECT, "Reject"),
    ]

    STATUS_OPEN = "Open"
    STATUS_CLOSED = "Closed"
    STATUS_REJECTED = "Rejected"
    STATUS_PROCESSING = "Processing"

    STATUS_CHOICES = [
        (STATUS_OPEN, "Open"),
        (STATUS_CLOSED, "Closed"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_PROCESSING, "Processing"),
    ]

    claim_id = models.CharField(
        max_length=100,
        unique=True,
        help_text="External/business claim identifier coming from FNOL/core system.",
    )
    fnol = models.ForeignKey(
        FnolClaim,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="claims",
    )

    policy_number = models.CharField(max_length=100)
    insured_name = models.CharField(max_length=150, null=True, blank=True)

    incident_date = models.DateField(null=True, blank=True)
    loss_description = models.TextField(blank=True)
    estimated_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        help_text="Estimated claim amount in policy currency.",
    )

    claim_type = models.CharField(
        max_length=20,
        choices=CLAIM_TYPE_CHOICES,
        null=True,
        blank=True,
    )
    automation_flag = models.CharField(
        max_length=20,
        choices=AUTOMATION_FLAG_CHOICES,
        default=AUTOMATION_COMPLEX,
        help_text="Simple vs Complex, based on rules-engine decision.",
    )
    decision = models.CharField(
        max_length=50,
        choices=DECISION_CHOICES,
        default=DECISION_MANUAL_REVIEW,
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_OPEN,
    )

    damage_confidence = models.IntegerField(
        default=0,
        help_text="Damage detection confidence (0-100).",
    )
    fraud_score_numeric = models.IntegerField(
        default=0,
        help_text="Numeric fraud score (0-100) derived from fraud band.",
    )
    fraud_risk_band = models.CharField(
        max_length=20,
        help_text="Low / Medium / High fraud risk band.",
    )
    evaluation_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=0,
        help_text="Normalized evaluation score used for threshold comparison.",
    )
    pre_existing_damage_flag = models.BooleanField(
        default=False,
        help_text="True when pre-existing damage is suspected.",
    )
    decision_reasons = models.TextField(
        null=True,
        blank=True,
        help_text="Optional human-readable explanation of decision and flags.",
    )

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, null=True, blank=True)
    updated_date = models.DateTimeField(auto_now=True)
    updated_by = models.CharField(max_length=150, null=True, blank=True)

    class Meta:
        db_table = "claim"

    def __str__(self) -> str:
        return f"Claim(id={self.id}, claim_id={self.claim_id})"


class ClaimStatus(models.Model):
    """
    Lookup table for claim status names.
    Maps integer IDs in fnol_response.claim_status to human-readable names.
    """

    status_name = models.CharField(max_length=150, db_column="status_name")

    class Meta:
        db_table = "claim_status"
        managed = False  # existing legacy table; Django will not create/modify it

    def __str__(self) -> str:
        return self.status_name


class PricingConfig(models.Model):
    """
    Master table for pricing configuration.
    Used for claim amounts, thresholds, rates, etc.
    """
    config_id = models.BigAutoField(primary_key=True)
    config_key = models.CharField(max_length=100, unique=True)
    config_name = models.CharField(max_length=255)
    config_value = models.TextField()
    config_type = models.CharField(
        max_length=50,
        default="string",
        help_text="string, number, decimal, json, boolean",
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, null=True, blank=True)
    updated_date = models.DateTimeField(auto_now=True)
    updated_by = models.CharField(max_length=150, null=True, blank=True)

    class Meta:
        db_table = "pricing_config"
        ordering = ["config_key"]

    def __str__(self) -> str:
        return f"{self.config_key}: {self.config_value}"


def digitization_document_upload_to(instance, filename):
    """
    Store files under digitization/<complaint_id>/ so S3 listing can derive Claim ID.
    """
    from pathlib import Path
    safe_name = Path(filename).name
    return f"digitization/{instance.complaint_id}/{safe_name}"


class DigitizationDocument(models.Model):
    """
    Stores uploaded documents for claim digitization (repair invoice, other docs, etc.).
    """

    DOCUMENT_CATEGORY_REPAIR = "repair"
    DOCUMENT_CATEGORY_OTHER = "other"
    DOCUMENT_CATEGORY_UNCLASSIFIED = "unclassified"

    DOCUMENT_CATEGORY_CHOICES = [
        (DOCUMENT_CATEGORY_REPAIR, "Repair Documents"),
        (DOCUMENT_CATEGORY_OTHER, "Other Documents"),
        (DOCUMENT_CATEGORY_UNCLASSIFIED, "Unclassified"),
    ]

    id = models.BigAutoField(primary_key=True)
    complaint_id = models.CharField(max_length=20, db_index=True)

    file = models.FileField(upload_to=digitization_document_upload_to)
    original_filename = models.CharField(max_length=255, blank=True, default="")

    document_category = models.CharField(
        max_length=30,
        choices=DOCUMENT_CATEGORY_CHOICES,
        default=DOCUMENT_CATEGORY_UNCLASSIFIED,
        db_index=True,
    )
    # Free-text document type (e.g., "Tax Invoice", "Repair Invoice", etc.)
    document_type = models.CharField(max_length=100, blank=True, default="", db_index=True)

    created_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "digitization_documents"
        indexes = [
            models.Index(fields=["complaint_id", "document_category"], name="dd_complaint_category_idx"),
            models.Index(fields=["complaint_id", "document_type"], name="dd_complaint_type_idx"),
        ]

    def __str__(self) -> str:
        return f"DigitizationDocument(id={self.id}, complaint_id={self.complaint_id}, type={self.document_type})"


class DigitizationExtraction(models.Model):
    """
    Stores extracted header + raw JSON from a digitized document.
    """

    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_PENDING = "pending"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
    ]

    document = models.OneToOneField(
        DigitizationDocument,
        on_delete=models.CASCADE,
        related_name="extraction",
    )

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    error_message = models.TextField(null=True, blank=True)

    # Common header fields (best-effort; may be null)
    claim_number = models.CharField(max_length=100, null=True, blank=True)
    vehicle_number = models.CharField(max_length=100, null=True, blank=True)
    engine_number = models.CharField(max_length=100, null=True, blank=True)
    chassis_number = models.CharField(max_length=100, null=True, blank=True)
    make_model = models.CharField(max_length=150, null=True, blank=True)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    extracted_json = models.TextField(null=True, blank=True)

    created_date = models.DateTimeField(auto_now_add=True)
    updated_date = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "digitization_extractions"

    def __str__(self) -> str:
        return f"DigitizationExtraction(document_id={self.document_id}, status={self.status})"


class ClaimInvoiceAnalysis(models.Model):
    """
    Phase-2 invoice extraction + discrepancy analysis snapshot.

    Reuses digitization document/extraction rows as the upstream source of truth.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    id = models.BigAutoField(primary_key=True)
    complaint = models.ForeignKey(
        FnolClaim,
        on_delete=models.CASCADE,
        db_column="complaint_id",
        to_field="complaint_id",
        related_name="invoice_analyses",
    )
    document = models.ForeignKey(
        DigitizationDocument,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="claim_invoice_analyses",
    )
    extraction = models.ForeignKey(
        DigitizationExtraction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="claim_invoice_analyses",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    invoice_total = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    valuation_total = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    discrepancy_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    requires_manual_review = models.BooleanField(default=False)
    summary_text = models.TextField(blank=True, default="")
    extracted_payload_json = models.JSONField(default=dict)
    discrepancy_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "claim_invoice_analyses"
        indexes = [
            models.Index(fields=["complaint", "-created_at"], name="cia_complaint_created"),
            models.Index(fields=["status"], name="cia_status"),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"ClaimInvoiceAnalysis(id={self.id}, complaint_id={self.complaint_id})"


class DigitizationPartLine(models.Model):
    """
    Extracted parts line items for a digitized document.
    """

    extraction = models.ForeignKey(
        DigitizationExtraction,
        on_delete=models.CASCADE,
        related_name="parts",
    )

    line_index = models.PositiveIntegerField(default=0, db_index=True)
    description = models.CharField(max_length=255, blank=True, default="")

    quantity = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = "digitization_part_lines"
        indexes = [
            models.Index(fields=["extraction", "line_index"], name="dpl_extraction_line_idx"),
        ]
        ordering = ["line_index", "id"]

    def __str__(self) -> str:
        return f"DigitizationPartLine(extraction_id={self.extraction_id}, desc={self.description[:30]})"


class InvoiceCoreDetails(models.Model):
    """
    Maps to MySQL table: vehicle_invoice_details
    (User-managed table; Django will not create/alter it.)
    """

    claim_number = models.CharField(max_length=50, primary_key=True)

    vehicle_number = models.CharField(max_length=50, null=True, blank=True)
    engine_number = models.CharField(max_length=50, null=True, blank=True)
    chassis_number = models.CharField(max_length=100, null=True, blank=True)
    make = models.CharField(max_length=50, null=True, blank=True)
    model_number = models.CharField(max_length=50, null=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    created_by = models.IntegerField(null=True, blank=True)
    created_date = models.DateTimeField(null=True, blank=True)
    updated_by = models.IntegerField(null=True, blank=True)
    updated_date = models.DateTimeField(null=True, blank=True)
    deleted_by = models.IntegerField(null=True, blank=True)
    deleted_date = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "vehicle_invoice_details"
        managed = False

    def __str__(self) -> str:
        return f"InvoiceCoreDetails(claim_number={self.claim_number})"


class InvoicePartDetails(models.Model):
    """
    Maps to MySQL table: vehicle_invoice_part_details
    (User-managed table; Django will not create/alter it.)
    """

    id = models.AutoField(primary_key=True)
    claim_number = models.ForeignKey(
        InvoiceCoreDetails,
        on_delete=models.CASCADE,
        db_column="claim_number",
        to_field="claim_number",
        related_name="invoice_parts",
    )

    description = models.CharField(max_length=255, null=True, blank=True)
    quantity = models.IntegerField(null=True, blank=True)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    created_by = models.IntegerField(null=True, blank=True)
    created_date = models.DateTimeField(null=True, blank=True)
    updated_by = models.IntegerField(null=True, blank=True)
    updated_date = models.DateTimeField(null=True, blank=True)
    deleted_by = models.IntegerField(null=True, blank=True)
    deleted_date = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "vehicle_invoice_part_details"
        managed = False

    def __str__(self) -> str:
        return f"InvoicePartDetails(id={self.id}, claim_number={self.claim_number_id})"


class PartsMaster(models.Model):
    """
    Maps to MySQL table: parts_master
    (User-managed table; Django will not create/alter it.)
    """

    id = models.AutoField(primary_key=True)
    part_name = models.CharField(max_length=255, unique=True)
    part_code = models.CharField(max_length=100, null=True, blank=True)
    category = models.CharField(max_length=100, null=True, blank=True)

    created_by = models.IntegerField(null=True, blank=True)
    created_date = models.DateTimeField(null=True, blank=True)
    updated_by = models.IntegerField(null=True, blank=True)
    updated_date = models.DateTimeField(null=True, blank=True)
    deleted_by = models.IntegerField(null=True, blank=True)
    deleted_date = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "parts_master"
        managed = False

    def __str__(self) -> str:
        return f"PartsMaster(id={self.id}, part_name={self.part_name})"
