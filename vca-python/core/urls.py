from django.urls import path
from .views import (
    role_list,
    role_detail,
    permission_list,
    permission_detail,
    role_permissions_list,
    role_permissions_assign,
    user_list_with_roles,
    user_assign_role,
)

urlpatterns = [
    # Roles
    path("roles/", role_list, name="role_list"),
    path("roles/<int:pk>/", role_detail, name="role_detail"),
    # Permissions
    path("permissions/", permission_list, name="permission_list"),
    path("permissions/<int:pk>/", permission_detail, name="permission_detail"),
    # Role-Permissions (assign must come before permissions/ to avoid path conflict)
    path("roles/<int:role_id>/permissions/assign/", role_permissions_assign, name="role_permissions_assign"),
    path("roles/<int:role_id>/permissions/", role_permissions_list, name="role_permissions_list"),
    # Users with roles
    path("users/", user_list_with_roles, name="user_list_with_roles"),
    path("users/<int:user_id>/assign-role/", user_assign_role, name="user_assign_role"),
]
