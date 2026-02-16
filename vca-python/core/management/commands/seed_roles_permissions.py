"""
Management command to seed default roles and permissions.
Run: python manage.py seed_roles_permissions
"""
from django.core.management.base import BaseCommand
from core.models import Role, Permission, RolePermission


# 1-5: Main pages (view only)
# 6: users (view=grid, add=button, update=icon, delete=icon)
# 7: roles (view, update, delete)
# 8: role_permissions (view, update, delete)
# Master: damage_config, claim_config, fraud_rules, price_config (view, update, delete each)
DEFAULT_PERMISSIONS = [
    ("dashboard.view", "View Dashboard", "dashboard"),
    ("claims.view", "View Claims", "claims"),
    ("fraud.view", "View Fraud Detection", "fraud"),
    ("damage.view", "View Damage Detection", "damage"),
    ("reports.view", "View Reports", "reports"),
    ("users.view", "View Users", "users"),
    ("users.add", "Add User", "users"),
    ("users.update", "Update User", "users"),
    ("users.delete", "Delete User", "users"),
    ("roles.view", "View Roles", "roles"),
    ("roles.update", "Update Role", "roles"),
    ("roles.delete", "Delete Role", "roles"),
    ("role_permissions.view", "View Role Permissions", "role_permissions"),
    ("role_permissions.update", "Update Role Permissions", "role_permissions"),
    ("role_permissions.delete", "Delete Role Permissions", "role_permissions"),
    ("damage_config.view", "View Damage Configuration", "masters"),
    ("damage_config.update", "Update Damage Configuration", "masters"),
    ("damage_config.delete", "Delete Damage Configuration", "masters"),
    ("claim_config.view", "View Claim Configuration", "masters"),
    ("claim_config.update", "Update Claim Configuration", "masters"),
    ("claim_config.delete", "Delete Claim Configuration", "masters"),
    ("fraud_rules.view", "View Fraud Rules", "masters"),
    ("fraud_rules.update", "Update Fraud Rules", "masters"),
    ("fraud_rules.delete", "Delete Fraud Rules", "masters"),
    ("price_config.view", "View Price Config", "masters"),
    ("price_config.update", "Update Price Config", "masters"),
    ("price_config.delete", "Delete Price Config", "masters"),
]

DEFAULT_ROLES = [
    ("Admin", "Full access to all features", [
        "dashboard.view", "claims.view", "fraud.view", "damage.view", "reports.view",
        "users.view", "users.add", "users.update", "users.delete",
        "roles.view", "roles.update", "roles.delete",
        "role_permissions.view", "role_permissions.update", "role_permissions.delete",
        "damage_config.view", "damage_config.update", "damage_config.delete",
        "claim_config.view", "claim_config.update", "claim_config.delete",
        "fraud_rules.view", "fraud_rules.update", "fraud_rules.delete",
        "price_config.view", "price_config.update", "price_config.delete",
    ]),
    ("User", "View-only access", [
        "dashboard.view", "claims.view", "fraud.view", "damage.view", "reports.view",
        "damage_config.view", "claim_config.view", "fraud_rules.view", "price_config.view",
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
