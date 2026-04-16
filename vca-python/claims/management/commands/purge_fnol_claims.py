from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection
from django.db.models import Q

from claims.models import (
    Claim,
    ClaimDuplicateCandidate,
    ClaimEvaluationResponse,
    ClaimPhase1Valuation,
    DamagePartAssessment,
    FnolClaim,
    ImageFraudResult,
)
from claims.views import _delete_fnol_claim_record


def _safe_count(model, **filters) -> int:
    table_name = model._meta.db_table
    try:
        if table_name not in connection.introspection.table_names():
            return 0
        return int(model.objects.filter(**filters).count())
    except DatabaseError:
        return 0


class Command(BaseCommand):
    help = (
        "Dry-run or purge FNOL claims and their persisted Phase 1 artifacts from "
        "the active database. Uses the same cascade-safe deletion path as the API."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--complaint-id",
            action="append",
            default=[],
            help="Delete a specific complaint_id. Repeat to target multiple claims.",
        )
        parser.add_argument(
            "--complaint-id-prefix",
            action="append",
            default=[],
            help="Delete claims whose complaint_id starts with this prefix. Repeatable.",
        )
        parser.add_argument(
            "--created-by",
            action="append",
            default=[],
            help="Delete claims created by one of these actors. Repeatable.",
        )
        parser.add_argument(
            "--all-fnol",
            action="store_true",
            default=False,
            help="Target every FNOL claim in the active database.",
        )
        parser.add_argument(
            "--confirm-all-fnol",
            action="store_true",
            default=False,
            help="Required together with --all-fnol --execute to delete every FNOL claim.",
        )
        parser.add_argument(
            "--execute",
            action="store_true",
            default=False,
            help="Actually delete matching claims. Without this flag the command is dry-run only.",
        )

    def handle(self, *args, **options):
        complaint_ids = [str(value).strip() for value in options["complaint_id"] if str(value).strip()]
        prefixes = [str(value).strip() for value in options["complaint_id_prefix"] if str(value).strip()]
        created_bys = [str(value).strip() for value in options["created_by"] if str(value).strip()]
        all_fnol = bool(options["all_fnol"])
        execute = bool(options["execute"])

        if not complaint_ids and not prefixes and not created_bys and not all_fnol:
            raise CommandError(
                "Provide at least one selector (--complaint-id, --complaint-id-prefix, "
                "--created-by) or use --all-fnol."
            )

        if all_fnol and execute and not options["confirm_all_fnol"]:
            raise CommandError(
                "Deleting every FNOL claim requires --all-fnol --execute --confirm-all-fnol."
            )

        queryset = FnolClaim.objects.all()
        if not all_fnol:
            selector = Q()
            if complaint_ids:
                selector |= Q(complaint_id__in=complaint_ids)
            for prefix in prefixes:
                selector |= Q(complaint_id__startswith=prefix)
            if created_bys:
                selector |= Q(created_by__in=created_bys)
            queryset = queryset.filter(selector)

        claims = list(queryset.order_by("complaint_id"))
        matched_ids = [claim.complaint_id for claim in claims]

        self.stdout.write(
            f"Active DB vendor: {settings.DATABASES['default']['ENGINE']}"
        )
        self.stdout.write(
            f"Matched FNOL claims: {len(matched_ids)}"
        )
        if matched_ids:
            self.stdout.write("Complaint IDs: " + ", ".join(matched_ids[:25]))
            if len(matched_ids) > 25:
                self.stdout.write(f"... and {len(matched_ids) - 25} more")

        related_summary = {
            "claim_rows": _safe_count(Claim, claim_id__in=matched_ids),
            "evaluation_rows": _safe_count(
                ClaimEvaluationResponse,
                complaint_id__in=matched_ids,
            ),
            "image_fraud_rows": _safe_count(
                ImageFraudResult,
                complaint_id__in=matched_ids,
            ),
            "duplicate_rows": _safe_count(
                ClaimDuplicateCandidate,
                complaint_id__in=matched_ids,
            ),
            "reverse_duplicate_rows": _safe_count(
                ClaimDuplicateCandidate,
                other_complaint_id__in=matched_ids,
            ),
            "damage_part_rows": _safe_count(
                DamagePartAssessment,
                complaint_id__in=matched_ids,
            ),
            "valuation_rows": _safe_count(
                ClaimPhase1Valuation,
                complaint_id__in=matched_ids,
            ),
        }
        self.stdout.write("Related persisted rows:")
        for key, value in related_summary.items():
            self.stdout.write(f"  - {key}: {value}")

        if not execute:
            self.stdout.write(
                self.style.WARNING(
                    "Dry run only. Re-run with --execute to delete the matched claims "
                    "from the active database."
                )
            )
            return

        deleted_summary: dict[str, dict[str, int]] = {}
        for claim in claims:
            deleted_summary[claim.complaint_id] = _delete_fnol_claim_record(claim)

        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {len(deleted_summary)} FNOL claim(s) from the active database."
            )
        )
        for complaint_id, counts in deleted_summary.items():
            self.stdout.write(f"  - {complaint_id}: {counts}")
