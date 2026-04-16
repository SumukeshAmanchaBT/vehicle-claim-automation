"""
Verify Azure OpenAI and Amazon S3 configuration (same env / .env as Django).

Usage:
  python manage.py verify_cloud_connections
  python manage.py verify_cloud_connections --debug
  python manage.py verify_cloud_connections --skip-azure
  python manage.py verify_cloud_connections --skip-s3

Optional: S3_VERIFY_WRITE_TEST=1 in .env runs a tiny put/delete probe on the bucket.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand


def _mask(s: str | None, keep: int = 4) -> str:
    if not s:
        return "(empty)"
    s = str(s).strip()
    if len(s) <= keep * 2:
        return "***"
    return f"{s[:keep]}...{s[-keep:]} (len={len(s)})"


class Command(BaseCommand):
    help = "Test Azure OpenAI and AWS S3 connectivity; logs details to stdout."

    def add_arguments(self, parser):
        parser.add_argument(
            "--debug",
            action="store_true",
            help="Enable DEBUG for boto3, botocore, urllib3, openai (verbose).",
        )
        parser.add_argument("--skip-azure", action="store_true")
        parser.add_argument("--skip-s3", action="store_true")

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

        if not options["skip_azure"]:
            azure_ok = self._check_azure(log)
        else:
            self.stdout.write("Skipping Azure (--skip-azure).\n")

        if not options["skip_s3"]:
            s3_ok = self._check_s3(log)
        else:
            self.stdout.write("Skipping S3 (--skip-s3).\n")

        self.stdout.write("")
        if azure_ok and s3_ok:
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
