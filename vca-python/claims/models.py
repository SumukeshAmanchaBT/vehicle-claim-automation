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
