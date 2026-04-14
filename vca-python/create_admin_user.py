"""
Standalone diagnostic + user-creation script.
Run from vca-python directory with the venv active:
    python create_admin_user.py

What it does:
  1. Connects to the database configured in .env (MySQL if USE_SQLITE=0)
  2. Lists all existing users (id, username, email, is_active, is_staff, last_login)
  3. Creates / resets the 'admin' user (password: Admin@1234) if it doesn't exist
     or resets password if it does exist, then adds it to the 'admin' group.
"""
import os
import sys
import django
from pathlib import Path

# ── Bootstrap Django ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "claim_automation.settings")

# Load .env manually so USE_SQLITE / MYSQL_* are visible before Django sets up
def _load_env(path):
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val

_load_env(BASE_DIR / ".env")
django.setup()

# ── Now import Django models ──────────────────────────────────────
from django.contrib.auth.models import User, Group
from django.db import connection

print("\n" + "=" * 60)
print("  VCA Admin Diagnostic & User Creation Script")
print("=" * 60)

# Show which DB we're connected to
db_settings = connection.settings_dict
engine = db_settings.get("ENGINE", "")
if "sqlite" in engine:
    print(f"\n[DB] Using SQLite: {db_settings.get('NAME')}")
else:
    print(f"\n[DB] Using MySQL")
    print(f"      Host     : {db_settings.get('HOST')}")
    print(f"      Port     : {db_settings.get('PORT')}")
    print(f"      Database : {db_settings.get('NAME')}")
    print(f"      User     : {db_settings.get('USER')}")

# Test connection
try:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    print("\n[OK] Database connection successful.")
except Exception as e:
    print(f"\n[ERROR] Cannot connect to database: {e}")
    sys.exit(1)

# ── List existing users ───────────────────────────────────────────
print("\n[Users found in auth_user table]")
print("-" * 60)
users = User.objects.all().order_by("id")
if not users.exists():
    print("  (no users found)")
else:
    for u in users:
        groups = ", ".join(u.groups.values_list("name", flat=True)) or "(no group)"
        print(f"  id={u.id:3d}  username={u.username:<25}  active={u.is_active}  staff={u.is_staff}  groups=[{groups}]")

# ── Create / reset 'admin' user ───────────────────────────────────
TARGET_USERNAME = "admin"
TARGET_PASSWORD = "Admin@1234"   # meets Django's password validators

print(f"\n[Action] Ensuring user '{TARGET_USERNAME}' exists with a known-good password...")

user, created = User.objects.get_or_create(username=TARGET_USERNAME)
user.set_password(TARGET_PASSWORD)
user.is_active = True
user.is_staff = True       # allows /admin/ login & is_admin check
user.is_superuser = True   # full privileges
user.email = "admin@vca.local"
user.first_name = "Admin"
user.last_name = "User"
user.save()

if created:
    print(f"  [CREATED] New user '{TARGET_USERNAME}' created.")
else:
    print(f"  [UPDATED] Existing user '{TARGET_USERNAME}' password has been reset.")

# Ensure the user is in the 'admin' group (used by _is_admin_user check)
admin_group, _ = Group.objects.get_or_create(name="admin")
user.groups.add(admin_group)
print(f"  [GROUP]   '{TARGET_USERNAME}' added to 'admin' group.")

# Also create a DRF auth token for this user
try:
    from rest_framework.authtoken.models import Token
    token, tok_created = Token.objects.get_or_create(user=user)
    tok_status = "created" if tok_created else "already exists"
    print(f"  [TOKEN]   Auth token {tok_status}: {token.key}")
except Exception as e:
    print(f"  [WARN]    Could not create auth token: {e}")

print("\n" + "=" * 60)
print("  SUCCESS — Login credentials:")
print(f"    Username : {TARGET_USERNAME}")
print(f"    Password : {TARGET_PASSWORD}")
print("=" * 60)
print("\nOpen http://127.0.0.1:8000 and use the credentials above.\n")
