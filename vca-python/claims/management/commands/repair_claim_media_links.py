from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from claims.media_repair import repair_claim_media_links


class Command(BaseCommand):
    help = (
        "Repair legacy claim media linkage by moving video-like fnol_damage_photos rows "
        "into claim_video_assets and reassigning uniquely matched orphan video assets."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--claim-id",
            dest="claim_id",
            default="",
            help="Optional complaint_id to repair a single claim.",
        )
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Persist the repairs. Without this flag the command runs in report-only mode.",
        )

    def handle(self, *args, **options):
        summary = repair_claim_media_links(
            complaint_id=(options.get("claim_id") or "").strip() or None,
            apply=bool(options.get("apply")),
        )
        self.stdout.write(json.dumps(summary, indent=2, sort_keys=True))
