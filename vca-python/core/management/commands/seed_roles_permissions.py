"""
Management command to seed default roles and permissions.
Run: python manage.py seed_roles_permissions
"""
from django.core.management.base import BaseCommand
from core.models import Role, Permission, RolePermission


DEFAULT_PERMISSIONS = [
    ("claims.view", "View Claims", "claims"),
    ("claims.create", "Create Claims", "claims"),
    ("claims.approve", "Approve Claims", "claims"),
    ("claims.reject", "Reject Claims", "claims"),
    ("masters.view", "View Masters", "masters"),
    ("masters.edit", "Edit Masters", "masters"),
    ("users.view", "View Users", "users"),
    ("users.create", "Create Users", "users"),
    ("users.edit", "Edit Users", "users"),
    ("users.manage_roles", "Manage User Roles", "users"),
]

DEFAULT_ROLES = [
    ("Admin", "Full access to all features", [
        "claims.view", "claims.create", "claims.approve", "claims.reject",
        "masters.view", "masters.edit",
        "users.view", "users.create", "users.edit", "users.manage_roles",
    ]),
    ("User", "Standard user - view and create claims", [
        "claims.view", "claims.create",
        "masters.view",
    ]),
    ("Viewer", "View-only access", [
        "claims.view",
        "masters.view",
    ]),
]


class Command(BaseCommand):
    help = "Seed default roles and permissions"

    def handle(self, *args, **options):
        self.stdout.write("Creating permissions...")
        perm_map = {}
        for codename, name, module in DEFAULT_PERMISSIONS:
            perm, _ = Permission.objects.get_or_create(
                codename=codename,
                defaults={"name": name, "module": module, "is_active": True}
            )
            perm_map[codename] = perm

        self.stdout.write("Creating roles and assigning permissions...")
        for role_name, description, permission_codenames in DEFAULT_ROLES:
            role, _ = Role.objects.get_or_create(
                name=role_name,
                defaults={"description": description, "is_active": True}
            )
            for codename in permission_codenames:
                perm = perm_map.get(codename)
                if perm:
                    RolePermission.objects.get_or_create(role=role, permission=perm)

        self.stdout.write(self.style.SUCCESS("Done. Roles and permissions seeded."))
