# VCA Python Backend

## User roles and create-user (403 fix)

Creating users, changing roles, resetting passwords, and deactivating users require **Admin** permission. A user is treated as admin if either:

- They have Django **staff** flag (`is_staff=True`), or  
- They belong to the **admin** group (group name `"admin"` or `"Admin"`).

**Quick fix – grant your user the Admin role:**

```bash
cd vca-python
python manage.py make_admin testuser
```

Replace `testuser` with the username you use to log in. Then log in again in the app and try creating a user; the 403 should be gone.

**Other options:**

1. **Django admin** – Open `http://localhost:8000/admin/`, edit the user, check **Staff status** or add them to a group named **admin**.
2. **Django shell** – `python manage.py shell`, then create the `admin` group and add the user to it (see `make_admin` command source in `claims/management/commands/make_admin.py`).
