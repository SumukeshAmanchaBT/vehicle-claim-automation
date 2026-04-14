from django.contrib.auth.models import User
from rest_framework import serializers

from .models import ClaimRuleMaster, ClaimTypeMaster, DamageCodeMaster, PricingConfig


class UserSerializer(serializers.ModelSerializer):
    """Serializer for User model."""

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']
        read_only_fields = ['id']


class LoginSerializer(serializers.Serializer):
    """Serializer for user login."""

    username = serializers.CharField(required=True)
    password = serializers.CharField(required=True, write_only=True)

    def validate(self, data):
        """Validate username and password."""
        username = data.get('username')
        password = data.get('password')

        if not username or not password:
            raise serializers.ValidationError(
                "Both username and password are required."
            )

        return data


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=True)
    role = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'password', 'role'
        ]

    def create(self, validated_data):
        role = validated_data.pop('role', None)
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        if role:
            from django.contrib.auth.models import Group

            grp, _ = Group.objects.get_or_create(name=role)
            user.groups.add(grp)
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['email', 'first_name', 'last_name']


class ChangeRoleSerializer(serializers.Serializer):
    role = serializers.CharField(required=True)


class ResetPasswordSerializer(serializers.Serializer):
    new_password = serializers.CharField(required=True, write_only=True)


class ClaimTypeMasterSerializer(serializers.ModelSerializer):
    risk_percentage = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False
    )

    class Meta:
        model = ClaimTypeMaster
        fields = [
            "claim_type_id",
            "claim_type_name",
            "risk_percentage",
            "risk_min",
            "risk_max",
            "is_active",
            "created_date",
            "created_by",
        ]
        read_only_fields = ["claim_type_id", "created_date"]

    def create(self, validated_data):
        if "risk_percentage" not in validated_data or validated_data["risk_percentage"] is None:
            validated_data["risk_percentage"] = validated_data.get("risk_max", 100)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "risk_percentage" not in validated_data:
            validated_data["risk_percentage"] = validated_data.get(
                "risk_max", instance.risk_max
            )
        return super().update(instance, validated_data)


class ClaimRuleMasterSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClaimRuleMaster
        fields = [
            "rule_id",
            "rule_type",
            "rule_group",
            "rule_description",
            "rule_expression",
            "is_active",
            "created_date",
            "created_by",
        ]
        read_only_fields = ["rule_id", "created_date"]


class DamageCodeMasterSerializer(serializers.ModelSerializer):
    class Meta:
        model = DamageCodeMaster
        fields = [
            "damage_id",
            "damage_type",
            "severity_percentage",
            "is_active",
            "created_date",
            "created_by",
        ]
        read_only_fields = ["damage_id", "created_date"]


class PricingConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = PricingConfig
        fields = [
            "config_id",
            "config_key",
            "config_name",
            "config_value",
            "config_type",
            "description",
            "is_active",
            "created_date",
            "created_by",
            "updated_date",
            "updated_by",
        ]
        read_only_fields = ["config_id", "created_date"]


class DamageAssessmentCardSummarySerializer(serializers.Serializer):
    """Outbound shape for one damage-assessment summary card (analyzer-driven)."""

    card_key = serializers.CharField()
    title = serializers.CharField()
    headline = serializers.CharField(allow_blank=True)
    status = serializers.CharField()
    primary_metric = serializers.JSONField()
    secondary_metrics = serializers.ListField(
        child=serializers.JSONField(),
        required=False,
        default=list,
    )
    view_details_enabled = serializers.BooleanField()
    last_generated_at = serializers.CharField(
        allow_null=True, required=False, allow_blank=True
    )
    caveats = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=list,
    )


class DamageAssessmentCardsResponseSerializer(serializers.Serializer):
    complaint_id = serializers.CharField()
    cards = DamageAssessmentCardSummarySerializer(many=True)


class DamageAssessmentCardDetailsSerializer(serializers.Serializer):
    """Outbound shape for drawer / detail payload for one card."""

    complaint_id = serializers.CharField()
    card_key = serializers.CharField()
    title = serializers.CharField()
    headline = serializers.CharField(allow_blank=True)
    status = serializers.CharField()
    confidence = serializers.JSONField()
    claim_context = serializers.JSONField()
    metrics = serializers.ListField(child=serializers.JSONField())
    evidence = serializers.ListField(child=serializers.JSONField())
    caveats = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=list,
    )
    unsupported_fields = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        required=False,
        default=list,
    )
    raw_evidence_bundle = serializers.JSONField(required=False)
    narrative = serializers.JSONField(
        required=False
    )  # Prompt 3 shape: summary, why_it_matters, key_takeaways, recommended_attention
    source_snapshot_hash = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    insight = serializers.JSONField(required=False, allow_null=True)
