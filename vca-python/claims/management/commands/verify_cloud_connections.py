"""
Verify Azure OpenAI and Amazon S3 configuration (same env / .env as Django).

Usage:
  python manage.py verify_cloud_connections
  python manage.py verify_cloud_connections --debug
  python manage.py verify_cloud_connections --skip-azure
  python manage.py verify_cloud_connections --skip-s3
  python manage.py verify_cloud_connections --skip-azure-monitor

Optional: S3_VERIFY_WRITE_TEST=1 in .env runs a tiny put/delete probe on the bucket.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand

from claim_automation.llm_observability import llm_observation_context

def _mask(s: str | None, keep: int = 4) -> str:
    if not s:
        return "(empty)"
    s = str(s).strip()
    if len(s) <= keep * 2:
        return "***"
    return f"{s[:keep]}...{s[-keep:]} (len={len(s)})"


class Command(BaseCommand):
    help = "Test Azure OpenAI, Azure Monitor, and AWS S3 connectivity; logs details to stdout."

    def add_arguments(self, parser):
        parser.add_argument(
            "--debug",
            action="store_true",
            help="Enable DEBUG for boto3, botocore, urllib3, openai (verbose).",
        )
        parser.add_argument("--skip-azure", action="store_true")
        parser.add_argument("--skip-s3", action="store_true")
        parser.add_argument("--skip-azure-monitor", action="store_true")

    def handle(self, *args: Any, **options: Any):
        log = logging.getLogger("verify_cloud")
        log.setLevel(logging.DEBUG)
        if not log.handlers:
            h = logging.StreamHandler(sys.stdout)
            h.setFormatter(
                logging.Formatter("%(levelname)s [%(name)s] %(message)s")
            )
            log.addHandler(h)

        if options["debug"]:
            logging.getLogger("botocore").setLevel(logging.DEBUG)
            logging.getLogger("boto3").setLevel(logging.DEBUG)
            logging.getLogger("urllib3").setLevel(logging.DEBUG)
            logging.getLogger("openai").setLevel(logging.DEBUG)

        self.stdout.write(self.style.NOTICE("=== Cloud connectivity check ===\n"))

        azure_ok = True
        s3_ok = True
        azure_monitor_ok = True

        if not options["skip_azure"]:
            azure_ok = self._check_azure(log)
        else:
            self.stdout.write("Skipping Azure (--skip-azure).\n")

        if not options["skip_s3"]:
            s3_ok = self._check_s3(log)
        else:
            self.stdout.write("Skipping S3 (--skip-s3).\n")

        if not options["skip_azure_monitor"]:
            azure_monitor_ok = self._check_azure_monitor(log)
        else:
            self.stdout.write("Skipping Azure Monitor (--skip-azure-monitor).\n")

        self.stdout.write("")
        if azure_ok and s3_ok and azure_monitor_ok:
            self.stdout.write(self.style.SUCCESS("Summary: all executed checks passed."))
        else:
            self.stdout.write(
                self.style.ERROR(
                    "Summary: one or more checks failed — see messages above."
                )
            )
            sys.exit(1)

    def _check_azure(self, log: logging.Logger) -> bool:
        self.stdout.write(self.style.HTTP_INFO("--- Azure OpenAI ---"))
        ep = (getattr(settings, "AZURE_OPENAI_ENDPOINT", "") or "").strip()
        dep = (getattr(settings, "AZURE_OPENAI_DEPLOYMENT", "") or "").strip()
        mini_dep = (getattr(settings, "AZURE_OPENAI_MINI_DEPLOYMENT", "") or "").strip()
        ver = (getattr(settings, "AZURE_OPENAI_API_VERSION", "") or "").strip()
        key = (getattr(settings, "AZURE_OPENAI_API_KEY", "") or "").strip()
        oai = (getattr(settings, "OPENAI_API_KEY", "") or "").strip()
        openai_mini = (getattr(settings, "OPENAI_MINI_MODEL", "") or "").strip()
        openai_rich = (getattr(settings, "OPENAI_RICH_MODEL", "") or "").strip()

        log.info("AZURE_OPENAI_ENDPOINT=%s", ep or "(empty)")
        log.info("AZURE_OPENAI_DEPLOYMENT=%s", dep or "(empty)")
        log.info("AZURE_OPENAI_MINI_DEPLOYMENT=%s", mini_dep or "(empty)")
        log.info("AZURE_OPENAI_API_VERSION=%s", ver or "(empty)")
        log.info("AZURE_OPENAI_API_KEY=%s", _mask(key))
        log.info("OPENAI_API_KEY (fallback)=%s", _mask(oai))
        log.info("OPENAI_MINI_MODEL=%s", openai_mini or "(empty)")
        log.info("OPENAI_RICH_MODEL=%s", openai_rich or "(empty)")

        from claim_automation.llm_client import (
            get_chat_completion_client_and_model,
            get_chat_completion_target,
        )

        client, model = get_chat_completion_client_and_model()
        if client is None or not model:
            self.stdout.write(
                self.style.WARNING(
                    "No LLM client: set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY + "
                    "AZURE_OPENAI_DEPLOYMENT, or OPENAI_API_KEY."
                )
            )
            return False

        log.info("Using client type=%s model/deployment=%s", type(client).__name__, model)
        light_target = get_chat_completion_target(profile="light")
        rich_target = get_chat_completion_target(profile="rich")
        log.info(
            "Resolved light target=%s/%s rich target=%s/%s",
            getattr(light_target, "provider", None),
            getattr(light_target, "model", None),
            getattr(rich_target, "provider", None),
            getattr(rich_target, "model", None),
        )

        with llm_observation_context(
            correlation_id="verify-cloud-connections",
            execution_scope="management_command",
            management_command="verify_cloud_connections",
        ):
            try:
                log.info("Calling chat.completions.create (minimal test message)...")
                resp = client.chat.completions.create(
                    model=model,
                    messages=[
                        {
                            "role": "user",
                            "content": 'Reply with exactly the word "pong" and nothing else.',
                        }
                    ],
                    max_tokens=16,
                    temperature=0,
                )
                text = (resp.choices[0].message.content or "").strip()
                log.info("Response content: %r", text[:200])
                usage = getattr(resp, "usage", None)
                if usage:
                    log.info("Usage: %s", usage)
                self.stdout.write(
                    self.style.SUCCESS(f"Azure/OpenAI LLM: OK (reply preview: {text[:80]!r})")
                )
                return True
            except Exception as e:
                log.exception("Azure/OpenAI call failed")
                self.stdout.write(self.style.ERROR(f"Azure/OpenAI LLM: FAILED — {e}"))
                return False

    def _check_s3(self, log: logging.Logger) -> bool:
        self.stdout.write(self.style.HTTP_INFO("--- Amazon S3 ---"))
        bucket = (getattr(settings, "AWS_STORAGE_BUCKET_NAME", None) or "").strip()
        region = (getattr(settings, "AWS_S3_REGION_NAME", None) or "").strip()
        access = (getattr(settings, "AWS_ACCESS_KEY_ID", None) or "").strip()
        secret = (getattr(settings, "AWS_SECRET_ACCESS_KEY", None) or "").strip()
        use_s3 = getattr(settings, "USE_S3_FOR_MEDIA", False)

        log.info("USE_S3_FOR_MEDIA=%s", use_s3)
        log.info("AWS_STORAGE_BUCKET_NAME=%s", bucket or "(empty)")
        log.info("AWS_S3_REGION_NAME=%s", region or "(empty)")
        log.info("AWS_ACCESS_KEY_ID=%s", _mask(access))
        log.info("AWS_SECRET_ACCESS_KEY=%s", _mask(secret))

        if not use_s3:
            self.stdout.write(
                self.style.NOTICE(
                    "S3: skipped — USE_S3_FOR_MEDIA is not enabled. "
                    "Django uses local MEDIA_ROOT. To test S3: set USE_S3_FOR_MEDIA=1 plus "
                    "AWS_S3_BUCKET_NAME, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY, "
                    "with django-storages and boto3 installed."
                )
            )
            return True

        if not bucket:
            self.stdout.write(self.style.ERROR("S3: bucket name missing."))
            return False

        try:
            import boto3
            from botocore.exceptions import ClientError
        except ImportError:
            self.stdout.write(
                self.style.ERROR("boto3 not installed. pip install boto3 django-storages")
            )
            return False

        session = boto3.Session(
            aws_access_key_id=access or None,
            aws_secret_access_key=secret or None,
            region_name=region or None,
        )
        s3 = session.client("s3", region_name=region or None)

        try:
            log.info("Calling head_bucket(Bucket=%r)...", bucket)
            s3.head_bucket(Bucket=bucket)
            self.stdout.write(self.style.SUCCESS(f"S3 head_bucket: OK ({bucket})"))
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            log.exception("head_bucket failed")
            self.stdout.write(
                self.style.ERROR(f"S3 head_bucket: FAILED ({code}) — {e}")
            )
            return False

        try:
            log.info("Calling list_objects_v2(Bucket=%r, MaxKeys=1)...", bucket)
            lst = s3.list_objects_v2(Bucket=bucket, MaxKeys=1)
            count = lst.get("KeyCount", 0)
            self.stdout.write(
                self.style.SUCCESS(
                    f"S3 list_objects_v2: OK (KeyCount={count}, "
                    f"truncated={lst.get('IsTruncated')})"
                )
            )
        except ClientError as e:
            log.exception("list_objects_v2 failed")
            self.stdout.write(self.style.ERROR(f"S3 list_objects_v2: FAILED — {e}"))
            return False

        import os

        if os.getenv("S3_VERIFY_WRITE_TEST", "").strip().lower() in ("1", "true", "yes"):
            key = "_vca_connection_test.txt"
            body = b"vca-python verify_cloud_connections write test"
            try:
                log.info("PutObject %r (S3_VERIFY_WRITE_TEST enabled)", key)
                s3.put_object(Bucket=bucket, Key=key, Body=body)
                s3.delete_object(Bucket=bucket, Key=key)
                self.stdout.write(self.style.SUCCESS("S3 put/delete probe: OK"))
            except ClientError as e:
                log.exception("put/delete probe failed")
                self.stdout.write(self.style.ERROR(f"S3 put/delete probe: FAILED — {e}"))
                return False

        return True

    def _check_azure_monitor(self, log: logging.Logger) -> bool:
        self.stdout.write(self.style.HTTP_INFO("--- Azure Monitor (Cloud-Truth Metrics) ---"))
        resource_id = (getattr(settings, "AZURE_OPENAI_RESOURCE_ID", "") or "").strip()
        enabled = (os.getenv("AZURE_MONITOR_METRICS_ENABLED", "1") or "1").strip()

        log.info("AZURE_OPENAI_RESOURCE_ID=%s", resource_id or "(empty)")
        log.info("AZURE_MONITOR_METRICS_ENABLED=%s", enabled)

        if enabled.lower() in {"0", "false", "no", "off"}:
            self.stdout.write(
                self.style.NOTICE(
                    "Azure Monitor: skipped — AZURE_MONITOR_METRICS_ENABLED is disabled."
                )
            )
            return True

        if not resource_id:
            self.stdout.write(
                self.style.NOTICE(
                    "Azure Monitor: skipped — AZURE_OPENAI_RESOURCE_ID not set. "
                    "Set it to enable cloud-truth metrics enrichment."
                )
            )
            return True

        # Parse resource ID
        from claim_automation.azure_monitor_client import parse_azure_resource_id

        ctx = parse_azure_resource_id(resource_id)
        if not ctx:
            self.stdout.write(
                self.style.ERROR(
                    f"Azure Monitor: FAILED — invalid AZURE_OPENAI_RESOURCE_ID format: {resource_id}"
                )
            )
            return False

        log.info("Subscription ID: %s", ctx.subscription_id)
        log.info("Resource Group: %s", ctx.resource_group)
        log.info("Resource Name: %s", ctx.resource_name)

        # Check if Azure SDK is available
        try:
            from azure.identity import DefaultAzureCredential
            from azure.monitor.query import MetricsQueryClient
        except ImportError:
            self.stdout.write(
                self.style.WARNING(
                    "Azure Monitor: SDK not installed. "
                    "Install with: pip install azure-identity azure-monitor-query"
                )
            )
            return False

        # Test authentication and metrics query
        try:
            log.info("Authenticating with DefaultAzureCredential...")
            credential = DefaultAzureCredential()
            client = MetricsQueryClient(credential)

            log.info("Querying Azure Monitor metrics for %s...", ctx.resource_name)
            from datetime import datetime, timedelta, timezone

            end_time = datetime.now(timezone.utc)
            start_time = end_time - timedelta(minutes=5)

            # Query a basic metric to verify connectivity
            metrics_response = client.query_resource(
                resource_uri=ctx.resource_id,
                metric_names=["Requests"],
                timespan=(start_time, end_time),
                granularity=timedelta(minutes=1),
                aggregations=["Total"],
            )

            metric_count = len(metrics_response.metrics)
            log.info("Received %d metric(s) from Azure Monitor", metric_count)

            # Display some metrics details
            for metric in metrics_response.metrics:
                log.info("  Metric: %s", metric.name)
                if metric.timeseries:
                    data_points = sum(len(ts.data) for ts in metric.timeseries)
                    log.info("    Data points: %d", data_points)

            self.stdout.write(
                self.style.SUCCESS(
                    f"Azure Monitor: OK — retrieved {metric_count} metric(s) for {ctx.resource_name}"
                )
            )

            # Test the observability integration
            log.info("Testing observability integration...")
            from claim_automation.azure_monitor_client import (
                get_azure_metrics_snapshot,
                get_cache_stats,
            )

            snapshot = get_azure_metrics_snapshot(
                resource_id, time_window_minutes=5, use_cache=False
            )
            if snapshot:
                metrics = snapshot.get("metrics", {})
                log.info("  Snapshot metrics: %s", ", ".join(metrics.keys()))
                cache_stats = get_cache_stats()
                log.info("  Cache entries: %d", cache_stats["entries"])
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  Observability integration: OK — {len(metrics)} metric types fetched"
                    )
                )
            else:
                self.stdout.write(
                    self.style.WARNING("  Observability integration: No metrics returned")
                )

            return True

        except Exception as e:
            log.exception("Azure Monitor query failed")
            self.stdout.write(
                self.style.ERROR(
                    f"Azure Monitor: FAILED — {type(e).__name__}: {e}\n\n"
                    "Common causes:\n"
                    "  1. Authentication: Ensure DefaultAzureCredential can authenticate\n"
                    "     - Set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, or\n"
                    "     - Use 'az login' for local dev, or\n"
                    "     - Use managed identity in Azure\n"
                    "  2. Permissions: Ensure the identity has 'Monitoring Reader' role on the resource\n"
                    "  3. Resource ID: Verify AZURE_OPENAI_RESOURCE_ID is correct"
                )
            )
            return False

