from django.db import models


class FnolClaim(models.Model):
    """
    Stores FNOL claim data (fnol_claims table).
    Uses complaint_id as primary key.
    """

    complaint_id = models.CharField(max_length=20, primary_key=True)
    coverage_type = models.CharField(max_length=50, null=True, blank=True)
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
    claim_status = models.ForeignKey(
        "ClaimStatus",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_column="claim_status",
        related_name="fnol_claims",
    )
    created_date = models.DateTimeField(null=True, blank=True, db_column="created_date")
    created_by = models.CharField(max_length=150, null=True, blank=True, db_column="created_by")
    updated_date = models.DateTimeField(null=True, blank=True, db_column="updated_date")
    updated_by = models.CharField(max_length=150, null=True, blank=True, db_column="updated_by")

    class Meta:
        db_table = "fnol_claims"

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
    """

    complaint_id = models.CharField(max_length=20, db_column="complaint_id")
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

    def __str__(self) -> str:
        return f"ClaimEvaluationResponse(id={self.id}, complaint_id={self.complaint_id})"


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
    Master table for different claim types (Own Damage, Theft, Glass Break, etc.).
    """

    claim_type_id = models.BigAutoField(primary_key=True)
    claim_type_name = models.CharField(max_length=100)
    risk_percentage = models.DecimalField(max_digits=5, decimal_places=2)
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