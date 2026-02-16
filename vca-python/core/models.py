"""
Core models for User, Role, and Permission management.
"""
from django.db import models
from django.contrib.auth.models import User


class Role(models.Model):
    """
    Role model for access control.
    Synced with Django Group for backward compatibility.
    """
    name = models.CharField(max_length=150, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, null=True, blank=True)
    updated_date = models.DateTimeField(auto_now=True)
    updated_by = models.CharField(max_length=150, null=True, blank=True)

    class Meta:
        db_table = "role"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Permission(models.Model):
    """
    Custom permission for API/feature-level access control.
    """
    codename = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    module = models.CharField(max_length=100, blank=True)  # e.g., claims, masters, users
    is_active = models.BooleanField(default=True)

    created_date = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, null=True, blank=True)

    class Meta:
        db_table = "permission"
        ordering = ["module", "codename"]

    def __str__(self):
        return f"{self.module}.{self.codename}" if self.module else self.codename


class RolePermission(models.Model):
    """
    Many-to-many relationship between Role and Permission.
    """
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="role_permissions")

    class Meta:
        db_table = "role_permission"
        unique_together = [["role", "permission"]]

    def __str__(self):
        return f"{self.role.name} -> {self.permission.codename}"


class UserRole(models.Model):
    """
    Links User to Role. One user can have one primary role.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="user_role")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="user_roles")

    class Meta:
        db_table = "user_role"

    def __str__(self):
        return f"{self.user.username} -> {self.role.name}"


class UserProfile(models.Model):
    """
    Extended user profile for soft delete. is_delete=0 (default) means active;
    is_delete=1 means soft-deleted (user hidden from lists).
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="userprofile")
    is_delete = models.BooleanField(default=False, db_column="is_delete")

    class Meta:
        db_table = "user_profile"

    def __str__(self):
        return f"{self.user.username} (is_delete={self.is_delete})"
