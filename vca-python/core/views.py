"""
API views for User, Role, and Permission management.
"""
from django.contrib.auth.models import User
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Role, Permission, RolePermission, UserRole, UserProfile
from .permissions import is_admin, has_permission
from .serializers import (
    RoleSerializer,
    RoleCreateUpdateSerializer,
    PermissionSerializer,
    RolePermissionSerializer,
    RolePermissionAssignSerializer,
    UserWithRoleSerializer,
)


def _get_username(request):
    return getattr(getattr(request, "user", None), "username", None) or "api_user"


def _is_admin(user):
    return is_admin(user)


def _has_permission(user, codename):
    return has_permission(user, codename)


# ---------- Role APIs ----------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def role_list(request):
    if request.method == "GET":
        if not (has_permission(request.user, "roles.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - roles.view required"}, status=status.HTTP_403_FORBIDDEN)
        qs = Role.objects.all().order_by("name")
        return Response(RoleSerializer(qs, many=True).data)

    if not (has_permission(request.user, "roles.update") or is_admin(request.user)):
        return Response({"error": "Forbidden - roles.update required"}, status=status.HTTP_403_FORBIDDEN)

    serializer = RoleCreateUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    obj = serializer.save(created_by=_get_username(request), updated_by=_get_username(request))
    return Response(RoleSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def role_detail(request, pk):
    obj = get_object_or_404(Role, pk=pk)

    if request.method == "GET":
        if not (has_permission(request.user, "roles.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - roles.view required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(RoleSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        if not (has_permission(request.user, "roles.update") or is_admin(request.user)):
            return Response({"error": "Forbidden - roles.update required"}, status=status.HTTP_403_FORBIDDEN)
        serializer = RoleCreateUpdateSerializer(obj, data=request.data, partial=(request.method == "PATCH"))
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=_get_username(request))
        return Response(RoleSerializer(obj).data)

    if not (has_permission(request.user, "roles.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - roles.delete required"}, status=status.HTTP_403_FORBIDDEN)
    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- Permission APIs ----------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def permission_list(request):
    if request.method == "GET":
        if not (has_permission(request.user, "role_permissions.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - role_permissions.view required"}, status=status.HTTP_403_FORBIDDEN)
        qs = Permission.objects.all().order_by("module", "codename")
        return Response(PermissionSerializer(qs, many=True).data)

    if not (has_permission(request.user, "role_permissions.update") or is_admin(request.user)):
        return Response({"error": "Forbidden - role_permissions.update required"}, status=status.HTTP_403_FORBIDDEN)

    serializer = PermissionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    obj = serializer.save(created_by=_get_username(request))
    return Response(PermissionSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def permission_detail(request, pk):
    obj = get_object_or_404(Permission, pk=pk)

    if request.method == "GET":
        if not (has_permission(request.user, "role_permissions.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - role_permissions.view required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(PermissionSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        if not (has_permission(request.user, "role_permissions.update") or is_admin(request.user)):
            return Response({"error": "Forbidden - role_permissions.update required"}, status=status.HTTP_403_FORBIDDEN)
        serializer = PermissionSerializer(obj, data=request.data, partial=(request.method == "PATCH"))
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(PermissionSerializer(obj).data)

    if not (has_permission(request.user, "role_permissions.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - role_permissions.delete required"}, status=status.HTTP_403_FORBIDDEN)
    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- Role Permission (assign permissions to role) ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def role_permissions_list(request, role_id):
    if not (has_permission(request.user, "role_permissions.view") or is_admin(request.user)):
        return Response({"error": "Forbidden - role_permissions.view required"}, status=status.HTTP_403_FORBIDDEN)
    role = get_object_or_404(Role, pk=role_id)
    qs = RolePermission.objects.filter(role=role).select_related("permission")
    return Response(RolePermissionSerializer(qs, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def role_permissions_assign(request, role_id):
    if not (has_permission(request.user, "role_permissions.update") or is_admin(request.user)):
        return Response({"error": "Forbidden - role_permissions.update required"}, status=status.HTTP_403_FORBIDDEN)

    role = get_object_or_404(Role, pk=role_id)
    serializer = RolePermissionAssignSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    permission_ids = serializer.validated_data["permission_ids"]

    # Clear existing and add new
    RolePermission.objects.filter(role=role).delete()

    for perm_id in permission_ids:
        perm = Permission.objects.filter(pk=perm_id, is_active=True).first()
        if perm:
            RolePermission.objects.get_or_create(role=role, permission=perm)

    qs = RolePermission.objects.filter(role=role).select_related("permission")
    return Response(RolePermissionSerializer(qs, many=True).data)


# ---------- Current user (for testing permissions) ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def current_user_me(request):
    """Return the logged-in user with role and permissions. Use this to verify which permissions a user has."""
    user = request.user
    try:
        role = user.user_role.role
        role_data = {"id": role.id, "name": role.name, "description": role.description}
        perms = list(
            Permission.objects.filter(
                role_permissions__role=role,
                is_active=True,
            ).values("id", "codename", "name", "module")
        )
    except UserRole.DoesNotExist:
        role_data = None
        perms = []

    return Response({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "is_active": user.is_active,
        "role": role_data,
        "permissions": perms,
    })


# ---------- User with Role APIs ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def user_list_with_roles(request):
    if not (has_permission(request.user, "users.view") or is_admin(request.user)):
        return Response(
            {"error": "Forbidden - users.view permission or Admin role required"},
            status=status.HTTP_403_FORBIDDEN,
        )
    # Exclude only when BOTH auth_user.is_delete=1 AND profile.is_delete=1 (so setting auth_user.is_delete=0 restores visibility)
    auth_table = User._meta.db_table
    profile_table = UserProfile._meta.db_table
    users = User.objects.filter(
        Q(userprofile__isnull=True) | Q(userprofile__is_delete=False) | Q(userprofile__is_delete=True)
    ).order_by("username")
    try:
        users = users.extra(where=[
            f"(COALESCE({auth_table}.is_delete, 0) = 0) OR ({profile_table}.id IS NULL) OR ({profile_table}.is_delete = 0)"
        ])
    except Exception:
        pass
    payload = []
    for u in users:
        try:
            role = u.user_role.role
            role_data = {"id": role.id, "name": role.name, "description": role.description}
            perms = list(
                Permission.objects.filter(
                    role_permissions__role=role,
                    is_active=True
                ).values("id", "codename", "name", "module")
            )
        except UserRole.DoesNotExist:
            role_data = None
            perms = []

        payload.append({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "is_active": u.is_active,
            "role": role_data,
            "permissions": perms,
        })
    return Response(payload)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def user_assign_role(request, user_id):
    if not (has_permission(request.user, "users.update") or is_admin(request.user)):
        return Response({"error": "Forbidden - users.update required"}, status=status.HTTP_403_FORBIDDEN)

    user = get_object_or_404(User, pk=user_id)
    role_id = request.data.get("role_id")
    if role_id is None:
        return Response({"error": "role_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    role = get_object_or_404(Role, pk=role_id)
    UserRole.objects.update_or_create(user=user, defaults={"role": role})

    return Response({
        "message": "Role assigned.",
        "user_id": user.id,
        "role": {"id": role.id, "name": role.name},
    }, status=status.HTTP_200_OK)
