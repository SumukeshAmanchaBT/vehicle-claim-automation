"""
Shared permission checks for role-based access.
Use these in both core and claims to enforce Admin vs User permissions.
"""
from .models import Permission, UserRole


def is_admin(user) -> bool:
    """True if user is admin: staff, Admin role via UserRole, or in Django Group 'admin'."""
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "is_staff", False):
        return True
    try:
        if user.user_role.role.name.lower() == "admin":
            return True
    except (UserRole.DoesNotExist, AttributeError):
        pass
    return getattr(user, "groups", None).filter(name__iexact="admin").exists()


def has_permission(user, codename: str) -> bool:
    """True if user has the given permission via their role (UserRole -> Role -> RolePermission)."""
    if not user or not user.is_authenticated:
        return False
    if is_admin(user):
        return True
    try:
        return Permission.objects.filter(
            role_permissions__role=user.user_role.role,
            codename=codename,
            is_active=True,
        ).exists()
    except (UserRole.DoesNotExist, AttributeError):
        return False


def has_user_update_permission(user) -> bool:
    """True if user can update other users (either users.update or users.edit)."""
    return has_permission(user, "users.update") or has_permission(user, "users.edit")
