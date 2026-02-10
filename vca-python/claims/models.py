from django.db import models


class FnolResponse(models.Model):
    """
    Stores the raw FNOL JSON payload and audit fields.
    """

    raw_response = models.JSONField()
    # Foreign key to legacy claim_status lookup table (stores ID in column 'claim_status')
    claim_status = models.ForeignKey(
        "ClaimStatus",
        on_delete=models.DO_NOTHING,
        null=True,
        blank=True,
        db_column="claim_status",
        related_name="fnols",
    )

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, null=True, blank=True)

    updated_date = models.DateTimeField(auto_now=True)
    updated_by = models.CharField(max_length=150, null=True, blank=True)

    deleted_date = models.DateTimeField(null=True, blank=True)
    deleted_by = models.CharField(max_length=150, null=True, blank=True)

    class Meta:
        db_table = "fnol_response"

    def __str__(self) -> str:
        return f"FnolResponse(id={self.id})"


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
        FnolResponse,
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
