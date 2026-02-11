from django.contrib.auth.models import User
from rest_framework import serializers

from .models import Role, Permission, RolePermission, UserRole


class RoleSerializer(serializers.ModelSerializer):
    permission_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            "id", "name", "description", "is_active",
            "permission_count",
            "created_date", "created_by", "updated_date", "updated_by",
        ]
        read_only_fields = ["id", "created_date"]

    def get_permission_count(self, obj):
        return obj.role_permissions.count()


class RoleCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["name", "description", "is_active"]


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = [
            "id", "codename", "name", "description", "module", "is_active",
            "created_date", "created_by",
        ]
        read_only_fields = ["id", "created_date"]


class RolePermissionSerializer(serializers.ModelSerializer):
    permission_codename = serializers.CharField(source="permission.codename", read_only=True)
    permission_name = serializers.CharField(source="permission.name", read_only=True)
    module = serializers.CharField(source="permission.module", read_only=True)

    class Meta:
        model = RolePermission
        fields = ["id", "role", "permission", "permission_codename", "permission_name", "module"]


class RolePermissionAssignSerializer(serializers.Serializer):
    permission_ids = serializers.ListField(
        child=serializers.IntegerField(),
        allow_empty=True
    )


class UserRoleSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)

    class Meta:
        model = UserRole
        fields = ["id", "user", "username", "role", "role_name"]


class UserWithRoleSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "is_active", "role", "permissions"]

    def get_role(self, obj):
        try:
            user_role = obj.user_role
            return {
                "id": user_role.role.id,
                "name": user_role.role.name,
                "description": user_role.role.description,
            }
        except UserRole.DoesNotExist:
            return None

    def get_permissions(self, obj):
        try:
            user_role = obj.user_role
            perms = Permission.objects.filter(
                role_permissions__role=user_role.role,
                is_active=True
            ).values("id", "codename", "name", "module")
            return list(perms)
        except UserRole.DoesNotExist:
            return []
