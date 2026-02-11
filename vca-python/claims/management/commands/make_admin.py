"""
Grant a user the Admin role so they can create users, change roles, etc.

Usage:
    python manage.py make_admin testuser
    python manage.py make_admin admin
"""
from django.contrib.auth.models import User, Group
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Add a user to the Admin group so they can create users and manage roles."

    def add_arguments(self, parser):
        parser.add_argument(
            "username",
            type=str,
            help="Username of the user to grant Admin role.",
        )

    def handle(self, *args, **options):
        username = options["username"]
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"User '{username}' does not exist."))
            return

        # Use "admin" to match frontend role value and list_users display
        admin_group, _ = Group.objects.get_or_create(name="admin")
        if user.groups.filter(pk=admin_group.pk).exists():
            self.stdout.write(self.style.WARNING(f"User '{username}' is already in the Admin group."))
            return

        user.groups.add(admin_group)
        self.stdout.write(self.style.SUCCESS(f"User '{username}' has been added to the Admin group. They can now create users."))
