import shutil
from pathlib import Path

from django.conf import settings
from django.core.management import BaseCommand, CommandError, call_command
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone


SAFE_FAKE_MIGRATIONS = [
    (
        "0002_claimrulemaster_claimtypemaster_damagecodemaster",
        lambda command: command._table_exists("claim_rule_master")
        and command._table_exists("claim_type_master")
        and command._table_exists("damage_code_master"),
    ),
    (
        "0003_pricingconfig",
        lambda command: command._table_exists("pricing_config"),
    ),
    (
        "0004_add_llm_response_to_claim_evaluation",
        lambda command: command._column_exists(
            "claim_evaluation_response", "llm_damages"
        )
        and command._column_exists("claim_evaluation_response", "llm_severity"),
    ),
    (
        "0005_claimtypemaster_risk_min_risk_max",
        lambda command: command._column_exists("claim_type_master", "risk_min")
        and command._column_exists("claim_type_master", "risk_max"),
    ),
    (
        "0006_phase1_fraud_damage_valuation_models",
        lambda command: command._table_exists("image_fraud_results")
        and command._table_exists("claim_duplicate_candidates")
        and command._table_exists("damage_part_assessments")
        and command._table_exists("claim_phase1_valuation"),
    ),
]


class Command(BaseCommand):
    help = (
        "Repair SQLite claims migration history when schema tables already exist "
        "but django_migrations is missing the matching rows."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-backup",
            action="store_true",
            help="Skip the automatic db.sqlite3 backup before repairing state.",
        )
        parser.add_argument(
            "--skip-migrate",
            action="store_true",
            help="Only repair django_migrations rows; do not run migrate afterward.",
        )

    def handle(self, *args, **options):
        if connection.vendor != "sqlite":
            raise CommandError("This repair command only supports SQLite.")

        db_name = settings.DATABASES["default"]["NAME"]
        db_name_str = str(db_name)
        is_in_memory_db = db_name_str == ":memory:" or db_name_str.startswith("file:")
        db_path = Path(db_name_str) if not is_in_memory_db else None

        if not options["no_backup"]:
            if is_in_memory_db:
                self.stdout.write("Skipping backup for in-memory SQLite database.")
            else:
                if db_path is None or not db_path.exists():
                    raise CommandError(f"SQLite database does not exist: {db_name_str}")
            timestamp = timezone.now().strftime("%Y%m%d-%H%M%S")
            if db_path is not None:
                backup_path = db_path.with_name(f"{db_path.name}.bak-{timestamp}")
                shutil.copy2(db_path, backup_path)
                self.stdout.write(
                    self.style.SUCCESS(f"Created backup: {backup_path}")
                )

        removed = self._dedupe_claims_migration_rows()
        if removed:
            self.stdout.write(
                self.style.WARNING(
                    f"Removed {removed} duplicate claims migration row(s)."
                )
            )
        else:
            self.stdout.write("No duplicate claims migration rows found.")

        recorder = MigrationRecorder(connection)
        applied = {
            migration
            for app, migration in recorder.applied_migrations()
            if app == "claims"
        }

        recorded = []
        skipped = []
        missing = []
        for migration_name, marker in SAFE_FAKE_MIGRATIONS:
            if migration_name in applied:
                skipped.append(migration_name)
                continue

            if marker(self):
                recorder.record_applied("claims", migration_name)
                recorded.append(migration_name)
            else:
                missing.append(migration_name)

        for migration_name in recorded:
            self.stdout.write(
                self.style.SUCCESS(f"Recorded claims.{migration_name} as applied")
            )

        for migration_name in skipped:
            self.stdout.write(f"Already applied: claims.{migration_name}")

        for migration_name in missing:
            self.stdout.write(
                self.style.WARNING(
                    f"Did not record claims.{migration_name}; schema marker not found."
                )
            )

        self._commit_if_allowed()

        if options["skip_migrate"]:
            self.stdout.write("Skipped migrate step by request.")
            return

        self.stdout.write("Running migrate for claims...")
        call_command("migrate", "claims", verbosity=options["verbosity"])
        self._commit_if_allowed()

    def _table_exists(self, table_name: str) -> bool:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name = %s",
                [table_name],
            )
            return cursor.fetchone() is not None

    def _column_exists(self, table_name: str, column_name: str) -> bool:
        if not self._table_exists(table_name):
            return False
        with connection.cursor() as cursor:
            cursor.execute(f"PRAGMA table_info({table_name})")
            return any(row[1] == column_name for row in cursor.fetchall())

    def _dedupe_claims_migration_rows(self) -> int:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT name, MIN(rowid) AS keep_rowid
                FROM django_migrations
                WHERE app = 'claims'
                GROUP BY name
                HAVING COUNT(*) > 1
                """
            )
            duplicates = cursor.fetchall()
            removed = 0
            for migration_name, keep_rowid in duplicates:
                cursor.execute(
                    """
                    DELETE FROM django_migrations
                    WHERE app = 'claims' AND name = %s AND rowid != %s
                    """,
                    [migration_name, keep_rowid],
                )
                removed += cursor.rowcount
            return removed

    def _commit_if_allowed(self) -> None:
        if connection.in_atomic_block:
            return
        connection.commit()
