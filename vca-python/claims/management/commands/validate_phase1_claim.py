"""
Validate a claim end-to-end through the active Phase 1 media-trust, damage, and valuation path.

Intended for local/operator use against real claim photos already attached to an FNOL claim.
Outputs a JSON summary to stdout and can optionally write the same payload to disk.
"""

from __future__ import annotations

import json
import logging
from decimal import Decimal
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from claims.media_paths import resolve_media_disk_path
from claims.models import DamagePartAssessment, FnolClaim, ImageFraudResult
from claims.phase1_runtime import get_claim_market_context
from damage_detection_llm.image_fraud_service import (
    analyze_image_fraud,
    check_image_reuse,
    resolve_duplicate_detection_settings,
)
from damage_detection_llm.services import run_damage_assessment_detailed
from damage_detection_llm.valuation_service import run_full_valuation

logger = logging.getLogger(__name__)


def _json_safe(value):
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def _json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _upsert_fraud_result(claim: FnolClaim, photo, fraud_result: dict) -> ImageFraudResult:
    return ImageFraudResult.objects.update_or_create(
        complaint=claim,
        photo_path=photo.photo_path,
        defaults={
            "damage_photo": photo,
            "image_source_url": photo.photo_path,
            "sha256_hex": fraud_result.get("sha256_hex", ""),
            "p_hash": fraud_result.get("p_hash", ""),
            "d_hash": fraud_result.get("d_hash", ""),
            "a_hash": fraud_result.get("a_hash", ""),
            "exif_json": _json_safe(fraud_result.get("exif_data")),
            "ela_score": _json_safe(fraud_result.get("ela_score")),
            "fraud_score": fraud_result.get("fraud_score"),
            "signals_json": _json_safe({
                "ela_score": fraud_result.get("ela_score"),
                "exif_warnings": (fraud_result.get("exif_data") or {}).get("warnings", []),
                "llm_red_flags": (fraud_result.get("llm_authenticity") or {}).get("red_flags", []),
            }),
            "llm_authenticity_notes": (fraud_result.get("llm_authenticity") or {}).get(
                "reasoning", ""
            ),
        },
    )[0]


def _round_optional(value, digits: int = 2):
    if value is None:
        return None
    return round(float(value), digits)


class Command(BaseCommand):
    help = (
        "Validate a claim through Phase 1 fraud, duplicate, detailed-damage, and valuation flows "
        "and print a JSON summary."
    )

    def add_arguments(self, parser):
        parser.add_argument("complaint_id", type=str, help="FnolClaim complaint_id to validate.")
        parser.add_argument(
            "--phash-threshold",
            type=float,
            default=None,
            help="Optional pHash override for this run. Accepts 0.0-1.0 or 0-100 percent.",
        )
        parser.add_argument(
            "--dhash-threshold",
            type=float,
            default=None,
            help="Optional dHash override for this run. Accepts 0.0-1.0 or 0-100 percent.",
        )
        require_group = parser.add_mutually_exclusive_group()
        require_group.add_argument(
            "--require-both",
            dest="require_both",
            action="store_true",
            help="Require both pHash and dHash for non-exact duplicate matches during this run.",
        )
        require_group.add_argument(
            "--allow-either-hash",
            dest="require_both",
            action="store_false",
            help="Allow either pHash or dHash to trigger non-exact duplicate matches during this run.",
        )
        parser.set_defaults(require_both=None)
        parser.add_argument(
            "--persist-duplicates",
            action="store_true",
            default=False,
            help="Persist duplicate candidates found during this validation run.",
        )
        parser.add_argument(
            "--persist-fraud-results",
            action="store_true",
            default=False,
            help="Upsert ImageFraudResult rows for this claim so later validation runs can detect duplicates.",
        )
        parser.add_argument(
            "--skip-fraud",
            action="store_true",
            default=False,
            help="Skip image-fraud and duplicate analysis.",
        )
        parser.add_argument(
            "--skip-damage",
            action="store_true",
            default=False,
            help="Skip detailed damage assessment/persistence.",
        )
        parser.add_argument(
            "--skip-valuation",
            action="store_true",
            default=False,
            help="Skip valuation calculation/persistence.",
        )
        parser.add_argument(
            "--write-json",
            type=str,
            default="",
            help="Optional filename to output the JSON summary to. Will be forced into vca-python/demo_outputs/.",
        )

    def handle(self, *args, **options):
        complaint_id = options["complaint_id"]
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            raise CommandError(f"Claim {complaint_id} not found")

        photos = list(claim.damage_photos.all())
        if not photos:
            raise CommandError(f"Claim {complaint_id} has no damage photos")

        phash_threshold = options["phash_threshold"]
        dhash_threshold = options["dhash_threshold"]
        if phash_threshold is not None and dhash_threshold is None:
            # For CLI tuning runs, matching both thresholds by default is usually less surprising.
            dhash_threshold = phash_threshold

        duplicate_detection = resolve_duplicate_detection_settings(
            phash_threshold=phash_threshold,
            dhash_threshold=dhash_threshold,
            require_both_non_exact=options["require_both"],
        )

        summary = {
            "complaint_id": complaint_id,
            "market_context": _json_safe(
                get_claim_market_context(complaint_id=complaint_id)
            ),
            "duplicate_detection": duplicate_detection,
            "persist_duplicates": options["persist_duplicates"],
            "persist_fraud_results": options["persist_fraud_results"],
            "photos": [],
            "damage_assessment": None,
            "valuation": None,
            "errors": [],
        }

        for photo in photos:
            disk_path = resolve_media_disk_path(photo.photo_path)
            photo_summary = {
                "photo_id": photo.id,
                "photo_path": photo.photo_path,
                "disk_path": _json_safe(disk_path),
                "file_exists": bool(disk_path and Path(disk_path).is_file()),
            }

            if not photo_summary["file_exists"]:
                photo_summary["errors"] = ["Image file not found on disk"]
                summary["photos"].append(photo_summary)
                summary["errors"].append(
                    {"photo_path": photo.photo_path, "stage": "resolve", "error": "Image file not found on disk"}
                )
                continue

            if not options["skip_fraud"]:
                try:
                    fraud = analyze_image_fraud(disk_path)
                    persisted_fraud_result_id = None
                    if options["persist_fraud_results"]:
                        persisted_row = _upsert_fraud_result(claim, photo, fraud)
                        persisted_fraud_result_id = persisted_row.id
                    reuse = check_image_reuse(
                        disk_path,
                        complaint_id,
                        persist=options["persist_duplicates"],
                        phash_threshold=duplicate_detection["phash_threshold"],
                        dhash_threshold=duplicate_detection["dhash_threshold"],
                        require_both_non_exact=duplicate_detection["require_both_non_exact"],
                    )
                    photo_summary["fraud_analysis"] = {
                        "fraud_score": float(fraud["fraud_score"]),
                        "ela_score": _round_optional(fraud["ela_score"]),
                        "exif_present": fraud["exif_data"].get("exif_present", False),
                        "exif_warnings": _json_safe(fraud["exif_data"].get("warnings", [])),
                        "llm_notes": _json_safe(fraud["llm_authenticity"].get("reasoning", "")),
                        "persisted_result_id": persisted_fraud_result_id,
                        "duplicate_candidate_count": _json_safe(reuse["candidate_count"]),
                        "duplicate_candidates": _json_safe(reuse["duplicate_candidates"]),
                    }
                except Exception as exc:
                    logger.exception("Phase 1 fraud validation failed for photo")
                    photo_summary.setdefault("errors", []).append(str(exc))
                    summary["errors"].append(
                        {"photo_path": photo.photo_path, "stage": "fraud", "error": str(exc)}
                    )

            if not options["skip_damage"]:
                try:
                    damage = run_damage_assessment_detailed(
                        image_path=disk_path,
                        complaint_id=complaint_id,
                        incident_description=claim.incident_description,
                        flood_coverage=getattr(claim, "flood_coverage", False),
                        image_url=photo.photo_path,
                    )
                    photo_summary["damage_assessment"] = {
                        "total_parts": damage.get("total_parts", 0),
                        "total_estimated_cost": _json_safe(damage.get("total_estimated_cost", 0)),
                        "currency_code": damage.get("currency_code"),
                        "market_context": _json_safe(damage.get("market_context")),
                        "pipeline_metadata": _json_safe(damage.get("pipeline_metadata", {})),
                        "part_breakdown": _json_safe(damage.get("part_breakdown", [])),
                    }
                except Exception as exc:
                    logger.exception("Phase 1 detailed damage validation failed for photo")
                    photo_summary.setdefault("errors", []).append(str(exc))
                    summary["errors"].append(
                        {"photo_path": photo.photo_path, "stage": "damage", "error": str(exc)}
                    )

            summary["photos"].append(photo_summary)

        if not options["skip_damage"]:
            assessments = DamagePartAssessment.objects.filter(complaint=claim).order_by("sort_order")
            summary["damage_assessment"] = {
                "total_parts": assessments.count(),
                "total_estimated_cost": round(
                    sum(float(a.estimated_amount or 0) for a in assessments),
                    2,
                ),
                "currency_code": summary["market_context"].get("currency_code"),
                "market_context": summary["market_context"],
                "pipeline_runs": [
                    photo_summary["damage_assessment"]["pipeline_metadata"]
                    for photo_summary in summary["photos"]
                    if photo_summary.get("damage_assessment", {}).get("pipeline_metadata")
                ],
                "part_breakdown": [
                    {
                        "part_name": a.part_name,
                        "damage_type": a.damage_type,
                        "severity_percent": float(a.severity_percent) if a.severity_percent else 0,
                        "repair_action": a.repair_action,
                        "estimated_amount": float(a.estimated_amount) if a.estimated_amount else 0,
                        "source_image_url": a.source_image_url or "",
                    }
                    for a in assessments
                ],
            }

        if not options["skip_valuation"]:
            try:
                valuation = run_full_valuation(complaint_id)
                summary["valuation"] = _json_safe({
                    **valuation,
                    "part_count": len(valuation.get("breakdown", [])),
                    "parts_total_cross_check": round(
                        sum(float(x.get("estimated_amount") or 0) for x in valuation.get("breakdown", [])),
                        2,
                    ),
                })
            except Exception as exc:
                logger.exception("Phase 1 valuation validation failed")
                summary["errors"].append({"stage": "valuation", "error": str(exc)})

        payload = json.dumps(summary, indent=2, default=_json_default)
        self.stdout.write(payload)

        write_json = (options.get("write_json") or "").strip()
        if write_json:
            from django.conf import settings
            filename = Path(write_json).name
            out_path = Path(settings.BASE_DIR) / "demo_outputs" / filename
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(payload + "\n", encoding="utf-8")
            self.stdout.write(f"Validation output written to dedicated folder: {out_path.absolute()}")
