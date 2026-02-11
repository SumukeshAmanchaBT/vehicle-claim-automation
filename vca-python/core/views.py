"""
API views for User, Role, and Permission management.
"""
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Role, Permission, RolePermission, UserRole
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
    """Check if user is admin (staff, Admin role via UserRole, or Django Group)."""
    if user.is_staff:
        return True
    try:
        if user.user_role.role.name.lower() == "admin":
            return True
    except (UserRole.DoesNotExist, AttributeError):
        pass
    return user.groups.filter(name__iexact="admin").exists()


def _has_permission(user, codename):
    """Check if user has the given permission via their role."""
    try:
        return Permission.objects.filter(
            role_permissions__role=user.user_role.role,
            codename=codename,
            is_active=True
        ).exists()
    except (UserRole.DoesNotExist, AttributeError):
        return False


# ---------- Role APIs ----------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def role_list(request):
    if request.method == "GET":
        qs = Role.objects.all().order_by("name")
        return Response(RoleSerializer(qs, many=True).data)

    if not _is_admin(request.user):
        return Response({"error": "Admin required"}, status=status.HTTP_403_FORBIDDEN)

    serializer = RoleCreateUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    obj = serializer.save(created_by=_get_username(request), updated_by=_get_username(request))
    return Response(RoleSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def role_detail(request, pk):
    obj = get_object_or_404(Role, pk=pk)

    if request.method == "GET":
        return Response(RoleSerializer(obj).data)

    if not _is_admin(request.user):
        return Response({"error": "Admin required"}, status=status.HTTP_403_FORBIDDEN)

    if request.method in ("PUT", "PATCH"):
        serializer = RoleCreateUpdateSerializer(obj, data=request.data, partial=(request.method == "PATCH"))
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=_get_username(request))
        return Response(RoleSerializer(obj).data)

    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- Permission APIs ----------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def permission_list(request):
    if request.method == "GET":
        qs = Permission.objects.all().order_by("module", "codename")
        return Response(PermissionSerializer(qs, many=True).data)

    if not _is_admin(request.user):
        return Response({"error": "Admin required"}, status=status.HTTP_403_FORBIDDEN)

    serializer = PermissionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    obj = serializer.save(created_by=_get_username(request))
    return Response(PermissionSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def permission_detail(request, pk):
    obj = get_object_or_404(Permission, pk=pk)

    if request.method == "GET":
        return Response(PermissionSerializer(obj).data)

    if not _is_admin(request.user):
        return Response({"error": "Admin required"}, status=status.HTTP_403_FORBIDDEN)

    if request.method in ("PUT", "PATCH"):
        serializer = PermissionSerializer(obj, data=request.data, partial=(request.method == "PATCH"))
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(PermissionSerializer(obj).data)

    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ---------- Role Permission (assign permissions to role) ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def role_permissions_list(request, role_id):
    role = get_object_or_404(Role, pk=role_id)
    qs = RolePermission.objects.filter(role=role).select_related("permission")
    return Response(RolePermissionSerializer(qs, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def role_permissions_assign(request, role_id):
    if not _is_admin(request.user):
        return Response({"error": "Admin required"}, status=status.HTTP_403_FORBIDDEN)

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


# ---------- User with Role APIs ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def user_list_with_roles(request):
    users = User.objects.all().order_by("username")
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
    if not _is_admin(request.user):
        return Response({"error": "Admin required"}, status=status.HTTP_403_FORBIDDEN)

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
