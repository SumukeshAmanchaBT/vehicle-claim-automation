from django.contrib.auth.models import User
from rest_framework import serializers

from .models import ClaimRuleMaster, ClaimTypeMaster, DamageCodeMaster


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
    class Meta:
        model = ClaimTypeMaster
        fields = [
            "claim_type_id",
            "claim_type_name",
            "risk_percentage",
            "is_active",
            "created_date",
            "created_by",
        ]
        read_only_fields = ["claim_type_id", "created_date"]


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
