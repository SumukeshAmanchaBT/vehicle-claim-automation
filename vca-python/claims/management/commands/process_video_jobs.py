from __future__ import annotations

import time
from uuid import uuid4

from django.core.management.base import BaseCommand

from claim_automation.vca_config import cfg
from claims.video_runtime import get_video_pipeline_runtime_status
from claims.video_jobs import run_ready_video_jobs


class Command(BaseCommand):
    help = "Process queued claim video analysis jobs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--once",
            action="store_true",
            help="Process at most the current batch and then exit.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=1,
            help="Maximum number of jobs to process per batch.",
        )
        parser.add_argument(
            "--poll-interval",
            type=int,
            default=cfg.video_worker_poll_interval_s,
            help="Seconds to wait between polling attempts when running continuously.",
        )

    def handle(self, *args, **options):
        once = bool(options["once"])
        limit = max(1, int(options["limit"] or 1))
        poll_interval = max(1, int(options["poll_interval"] or cfg.video_worker_poll_interval_s))
        worker_token = uuid4().hex
        runtime_status = get_video_pipeline_runtime_status()

        self.stdout.write(
            "Video pipeline runtime: "
            f"requested={runtime_status.get('requested_primary_provider') or 'n/a'} "
            f"effective={runtime_status.get('effective_primary_provider') or 'none'} "
            f"ready={bool(runtime_status.get('ready'))} "
            f"langgraph_mode={((runtime_status.get('orchestration') or {}).get('selected_mode') or 'n/a')}"
        )
        if runtime_status.get("selection_reason"):
            self.stdout.write(
                f"Runtime note: {runtime_status.get('selection_reason')}"
            )

        while True:
            processed = run_ready_video_jobs(limit=limit, worker_token=worker_token)
            if processed:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Processed {len(processed)} video job(s): "
                        + ", ".join(str(job.id) for job in processed)
                    )
                )
            elif once:
                self.stdout.write("No queued video jobs were ready.")

            if once:
                break

            time.sleep(poll_interval)
