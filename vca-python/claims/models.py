from django.db import models


class FnolResponse(models.Model):
    """
    Stores the raw FNOL JSON payload and audit fields.
    """

    raw_response = models.JSONField()

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
