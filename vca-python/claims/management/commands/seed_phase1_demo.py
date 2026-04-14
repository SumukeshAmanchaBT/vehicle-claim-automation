"""
Seed a repeatable Phase 1 golden set using real local media files.

Creates curated FNOL claims and persisted Phase 1 outputs for:
- high-risk fraud escalation
- duplicate-review workflow (source + target)
- ready-to-clear reviewer case
- needs-analysis / missing-signals case
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

from claims.media_paths import resolve_media_disk_path
from claims.models import (
    Claim,
    ClaimEvaluationResponse,
    ClaimPhase1Valuation,
    ClaimStatus,
    DamagePartAssessment,
    FnolClaim,
    FnolDamagePhoto,
    ImageFraudResult,
)
from damage_detection_llm.image_fraud_service import analyze_image_fraud, check_image_reuse
from damage_detection_llm.services import run_damage_assessment_detailed
from damage_detection_llm.valuation_service import run_full_valuation

logger = logging.getLogger(__name__)


def _json_safe(value):
    """Normalize numpy scalars / Decimals for JSONField persistence."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    if isinstance(value, Decimal):
        return float(value)
    return value


@dataclass(frozen=True)
class DemoScenario:
    complaint_id: str
    policy_number: str
    policy_holder_name: str
    incident_type: str
    incident_description: str
    accident_location: str
    re_open: int
    decision: str
    claim_status: str
    media_keys: tuple[str, ...]
    notes: str


DEMO_SCENARIOS = [
    DemoScenario(
        complaint_id="DEMO-FRD-001",
        policy_number="POL-DEMO-01",
        policy_holder_name="Demo Fraud Review",
        incident_type="Collision",
        incident_description="Rear-end impact with bumper and quarter-panel damage.",
        accident_location="Bangkok, Thailand",
        re_open=1,
        decision="Reject",
        claim_status="Recommendation shared",
        media_keys=("fraud_primary", "fraud_secondary"),
        notes="High-risk fraud escalation with metadata warnings and high valuation.",
    ),
    DemoScenario(
        complaint_id="DEMO-DUP-SRC",
        policy_number="POL-DEMO-02A",
        policy_holder_name="Demo Duplicate Source",
        incident_type="Collision",
        incident_description="Older claim used as duplicate-match source.",
        accident_location="Bangkok, Thailand",
        re_open=0,
        decision="Manual Review",
        claim_status="Recommendation shared",
        media_keys=("duplicate_shared",),
        notes="Reference/source claim for exact duplicate matching.",
    ),
    DemoScenario(
        complaint_id="DEMO-DUP-002",
        policy_number="POL-DEMO-02B",
        policy_holder_name="Demo Duplicate Review",
        incident_type="Collision",
        incident_description="Front bumper damage in a parking-lot incident.",
        accident_location="Bangkok, Thailand",
        re_open=1,
        decision="Manual Review",
        claim_status="Recommendation shared",
        media_keys=("duplicate_shared",),
        notes="Duplicate-review target sharing the same local media as the source claim.",
    ),
    DemoScenario(
        complaint_id="DEMO-CLR-003",
        policy_number="POL-DEMO-03",
        policy_holder_name="Demo Clear Review",
        incident_type="Scratch",
        incident_description="Minor cosmetic scratch on the left-side door.",
        accident_location="Chiang Mai, Thailand",
        re_open=1,
        decision="Auto Approve",
        claim_status="Recommendation shared",
        media_keys=("clear_primary",),
        notes="Low-risk reviewer case ready to clear.",
    ),
    DemoScenario(
        complaint_id="DEMO-DAT-004",
        policy_number="POL-DEMO-04",
        policy_holder_name="Demo Needs Analysis",
        incident_type="Flood",
        incident_description="Water ingress reported, but image trust and valuation have not been run yet.",
        accident_location="Kuala Lumpur, Malaysia",
        re_open=1,
        decision="Manual Review",
        claim_status="Business Rule Validation-pass",
        media_keys=("pending_primary",),
        notes="Queue entry that demonstrates the Run analysis / missing signals state.",
    ),
]

MEDIA_CHOICES = {
    "fraud_primary": ("fire_accident1.jpeg", "glass_damage1.jpg", "CLM_D004_2.jpg"),
    "fraud_secondary": ("fire_accident2.jpeg", "glass_damage2.jpg", "CLM_D004_3.jpg"),
    "duplicate_shared": ("CLM_D002_1.jpg", "CLM_D001_2.jpg", "images.jpg"),
    "clear_primary": ("CLM_D007_1.jpg", "CLM_D004_1.jpg", "CLM-0010_1.jpg"),
    "pending_primary": (
        "43ce-91da-066cd6a2ffda.png",
        "468d-a37f-5424a45d7ea0.png",
        "82f2-4895-8878-470e3dc0bb11.png",
        "flood_car1.jpg",
    ),
}


def _media_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "vehicle_damage"


def _ensure_sqlite_claim_status_table() -> None:
    if connection.vendor != "sqlite":
        return
    with connection.cursor() as cursor:
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS claim_status ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "status_name VARCHAR(150) NOT NULL"
            ");"
        )


def _available_media_names() -> list[str]:
    media_root = _media_root()
    if not media_root.is_dir():
        raise CommandError(f"Vehicle-damage media folder not found: {media_root}")
    names = sorted(path.name for path in media_root.iterdir() if path.is_file())
    if not names:
        raise CommandError(f"No media files found in {media_root}")
    return names


def _pick_media_name(media_key: str, available_names: list[str], used_names: set[str]) -> str:
    preferred = MEDIA_CHOICES.get(media_key, ())
    available_lookup = {name.lower(): name for name in available_names}
    for candidate in preferred:
        match = available_lookup.get(candidate.lower())
        if match:
            return match
    for name in available_names:
        if name not in used_names:
            return name
    return available_names[0]


def _reset_claim_artifacts(claim: FnolClaim) -> None:
    claim.damage_photos.all().delete()
    claim.image_fraud_results.all().delete()
    claim.duplicate_candidates.all().delete()
    claim.damage_part_assessments.all().delete()
    ClaimPhase1Valuation.objects.filter(complaint=claim).delete()
    ClaimEvaluationResponse.objects.filter(complaint_id=claim.complaint_id).delete()


def _resolve_claim_status(status_name: str) -> ClaimStatus | None:
    normalized = (status_name or "").strip()
    if not normalized:
        return None
    existing = (
        ClaimStatus.objects.filter(status_name__iexact=normalized)
        .order_by("id")
        .first()
    )
    if existing:
        return existing
    return ClaimStatus.objects.create(status_name=normalized)


def _upsert_claim_shell(scenario: DemoScenario, created_at) -> FnolClaim:
    claim, _ = FnolClaim.objects.update_or_create(
        complaint_id=scenario.complaint_id,
        defaults={
            "policy_number": scenario.policy_number,
            "policy_holder_name": scenario.policy_holder_name,
            "incident_type": scenario.incident_type,
            "incident_description": scenario.incident_description,
            "coverage_type": "Comprehensive",
            "policy_status": "Active",
            "accident_location": scenario.accident_location,
            "excess_amount": Decimal("0.00"),
            "claim_status": _resolve_claim_status(scenario.claim_status),
            "re_open": scenario.re_open,
            "created_date": created_at,
            "updated_date": timezone.now(),
            "created_by": "seed_phase1_demo",
            "updated_by": "seed_phase1_demo",
        },
    )
    _reset_claim_artifacts(claim)
    return claim


def _upsert_claim_projection(claim: FnolClaim, scenario: DemoScenario) -> None:
    Claim.objects.update_or_create(
        claim_id=scenario.complaint_id,
        defaults={
            "fnol": claim,
            "policy_number": claim.policy_number or scenario.policy_number,
            "insured_name": claim.policy_holder_name,
            "loss_description": scenario.incident_description,
            "estimated_amount": Decimal("0.00"),
            "claim_type": "COMPLEX" if "FRAUD" in scenario.notes.upper() else "SIMPLE",
            "automation_flag": "Complex" if scenario.decision == "Manual Review" else "Simple",
            "decision": "Manual Review" if scenario.decision == "Manual Review" else (
                "Reject" if scenario.decision == "Reject" else "Auto Approve"
            ),
            "status": "Open" if scenario.re_open else "Closed",
            "damage_confidence": 0,
            "fraud_score_numeric": 0,
            "fraud_risk_band": "Low",
            "evaluation_score": Decimal("0.00"),
            "pre_existing_damage_flag": False,
            "decision_reasons": scenario.notes,
            "created_by": "seed_phase1_demo",
            "updated_by": "seed_phase1_demo",
        },
    )


def _build_reason(
    default_reason: str,
    *,
    valuation: dict | None = None,
    max_fraud_score: float = 0.0,
    duplicate_count: int = 0,
) -> str:
    parts = [default_reason]
    if max_fraud_score > 0:
        parts.append(f"Highest fraud score {int(round(max_fraud_score))}.")
    if duplicate_count > 0:
        parts.append(
            f"{duplicate_count} duplicate candidate{'s' if duplicate_count != 1 else ''} detected."
        )
    if valuation and valuation.get("gross_estimate"):
        market_context = valuation.get("market_context") or {}
        currency_code = valuation.get("currency_code") or market_context.get("currency_code") or "THB"
        parts.append(
            f"Gross estimate {currency_code} {float(valuation.get('gross_estimate', 0)):,.2f}."
        )
    return " ".join(parts)[:500]


def _dynamic_claim_type_and_threshold(estimated_amount: Decimal) -> tuple[str, int]:
    from claims.views import _get_claim_type_threshold
    from claims.phase1_runtime import get_claim_type_settings

    threshold, claim_type_name = _get_claim_type_threshold(
        {"estimated_amount": float(estimated_amount or 0)}
    )
    settings = get_claim_type_settings()
    claim_type = claim_type_name or (
        "COMPLEX"
        if estimated_amount >= Decimal(str(settings["medium_max_amount"]))
        else "SIMPLE"
    )
    threshold_value = int(round((threshold or 0) * 100))
    return claim_type, threshold_value


def _sync_claim_projection(
    claim: FnolClaim,
    *,
    estimated_amount: Decimal,
    decision: str,
    reason: str,
    max_fraud_score: float = 0.0,
) -> None:
    claim_type, _ = _dynamic_claim_type_and_threshold(estimated_amount)
    Claim.objects.filter(claim_id=claim.complaint_id).update(
        estimated_amount=estimated_amount,
        claim_type=claim_type,
        automation_flag="Simple" if decision == "Auto Approve" else "Complex",
        decision=decision,
        status="Open" if claim.re_open else "Closed",
        fraud_score_numeric=int(round(max_fraud_score)),
        fraud_risk_band=(
            "High" if max_fraud_score >= 70 else "Medium" if max_fraud_score >= 40 else "Low"
        ),
        evaluation_score=Decimal(str(round(max_fraud_score / 100.0, 2))),
        decision_reasons=reason,
        updated_by="seed_phase1_demo",
    )


def _persist_live_fraud_result(
    claim: FnolClaim,
    photo: FnolDamagePhoto,
    *,
    persist_duplicates: bool = False,
) -> tuple[ImageFraudResult | None, dict, Path | None]:
    disk_path = resolve_media_disk_path(photo.photo_path)
    if not disk_path:
        return None, {"candidate_count": 0}, None

    disk_file = Path(disk_path)
    if not disk_file.is_file():
        return None, {"candidate_count": 0}, None

    try:
        fraud_result = analyze_image_fraud(str(disk_file))
        row = ImageFraudResult.objects.create(
            complaint=claim,
            damage_photo=photo,
            image_source_url=photo.photo_path,
            photo_path=photo.photo_path,
            sha256_hex=fraud_result["sha256_hex"],
            p_hash=fraud_result["p_hash"],
            d_hash=fraud_result["d_hash"],
            a_hash=fraud_result["a_hash"],
            exif_json=_json_safe(fraud_result["exif_data"]),
            ela_score=_json_safe(fraud_result["ela_score"]),
            fraud_score=fraud_result["fraud_score"],
            signals_json=_json_safe({
                "ela_score": fraud_result["ela_score"],
                "exif_warnings": fraud_result["exif_data"].get("warnings", []),
            }),
            llm_authenticity_notes=fraud_result["llm_authenticity"].get("reasoning", ""),
        )
        duplicate_summary = check_image_reuse(
            str(disk_file), claim.complaint_id, persist=persist_duplicates
        )
        return row, duplicate_summary, disk_file
    except Exception:
        logger.exception("Live fraud seeding failed for %s / %s", claim.complaint_id, photo.photo_path)
        return None, {"candidate_count": 0}, disk_file


def _create_photo_rows(claim: FnolClaim, photo_names: list[str]) -> list[FnolDamagePhoto]:
    return [
        FnolDamagePhoto.objects.create(complaint=claim, photo_path=name)
        for name in photo_names
    ]


def _create_evaluation_row(
    scenario: DemoScenario,
    estimated_amount: Decimal,
    reason: str,
    *,
    decision: str | None = None,
    claim_status: str | None = None,
) -> None:
    claim_type, threshold_value = _dynamic_claim_type_and_threshold(estimated_amount)
    ClaimEvaluationResponse.objects.create(
        complaint_id=scenario.complaint_id,
        version=1,
        is_latest=True,
        estimated_amount=estimated_amount,
        claim_amount=estimated_amount,
        threshold_value=threshold_value,
        claim_type=claim_type,
        decision=decision or scenario.decision,
        claim_status=claim_status or scenario.claim_status,
        reason=reason,
    )


def _seed_fraud_escalation(claim: FnolClaim, scenario: DemoScenario, photos: list[FnolDamagePhoto]) -> dict:
    fraud_scores: list[float] = []
    for photo in photos:
        row, _duplicate_summary, disk_path = _persist_live_fraud_result(claim, photo)
        if row and row.fraud_score is not None:
            fraud_scores.append(float(row.fraud_score))
        if disk_path and disk_path.is_file():
            run_damage_assessment_detailed(
                image_path=str(disk_path),
                complaint_id=claim.complaint_id,
                incident_description=scenario.incident_description,
                image_url=photo.photo_path,
            )

    valuation = run_full_valuation(claim.complaint_id)
    gross_est = Decimal(str(valuation.get("gross_estimate", 0)))
    reason = _build_reason(
        "Live media-trust analysis and part-level valuation are ready for investigator review.",
        valuation=valuation,
        max_fraud_score=max(fraud_scores, default=0.0),
    )

    _create_evaluation_row(
        scenario,
        gross_est,
        reason,
    )
    claim.excess_amount = Decimal(str(valuation.get("excess_amount", 0)))
    claim.save(update_fields=["excess_amount", "updated_date"])
    _sync_claim_projection(
        claim,
        estimated_amount=gross_est,
        decision=scenario.decision,
        reason=reason,
        max_fraud_score=max(fraud_scores, default=0.0),
    )
    return {
        "review_state": "escalate",
        "photos": [p.photo_path for p in photos],
    }


def _seed_duplicate_pair(
    source_claim: FnolClaim,
    target_claim: FnolClaim,
    source_scenario: DemoScenario,
    target_scenario: DemoScenario,
    source_photo: FnolDamagePhoto,
    target_photo: FnolDamagePhoto,
) -> tuple[dict, dict]:
    source_row, _source_duplicates, src_disk_path = _persist_live_fraud_result(
        source_claim,
        source_photo,
    )
    target_row, target_duplicates, tgt_disk_path = _persist_live_fraud_result(
        target_claim,
        target_photo,
        persist_duplicates=True,
    )

    if src_disk_path and src_disk_path.is_file():
        run_damage_assessment_detailed(
            image_path=str(src_disk_path),
            complaint_id=source_claim.complaint_id,
            incident_description=source_scenario.incident_description,
            image_url=source_photo.photo_path,
        )
    src_val = run_full_valuation(source_claim.complaint_id)
    src_reason = _build_reason(
        "Older claim retained as the duplicate-review source case.",
        valuation=src_val,
        max_fraud_score=float(source_row.fraud_score) if source_row and source_row.fraud_score is not None else 0.0,
    )
    _create_evaluation_row(
        source_scenario,
        Decimal(str(src_val.get("gross_estimate", 0))),
        src_reason,
    )
    source_claim.excess_amount = Decimal(str(src_val.get("excess_amount", 0)))
    source_claim.save(update_fields=["excess_amount", "updated_date"])
    _sync_claim_projection(
        source_claim,
        estimated_amount=Decimal(str(src_val.get("gross_estimate", 0))),
        decision=source_scenario.decision,
        reason=src_reason,
        max_fraud_score=float(source_row.fraud_score) if source_row and source_row.fraud_score is not None else 0.0,
    )

    if tgt_disk_path and tgt_disk_path.is_file():
        run_damage_assessment_detailed(
            image_path=str(tgt_disk_path),
            complaint_id=target_claim.complaint_id,
            incident_description=target_scenario.incident_description,
            image_url=target_photo.photo_path,
        )
    tgt_val = run_full_valuation(target_claim.complaint_id)
    duplicate_count = int(target_duplicates.get("candidate_count", 0) or 0)
    target_reason = _build_reason(
        f"Live duplicate review found matches against {source_claim.complaint_id}.",
        valuation=tgt_val,
        max_fraud_score=float(target_row.fraud_score) if target_row and target_row.fraud_score is not None else 0.0,
        duplicate_count=duplicate_count,
    )
    _create_evaluation_row(
        target_scenario,
        Decimal(str(tgt_val.get("gross_estimate", 0))),
        target_reason,
    )
    target_claim.excess_amount = Decimal(str(tgt_val.get("excess_amount", 0)))
    target_claim.save(update_fields=["excess_amount", "updated_date"])
    _sync_claim_projection(
        target_claim,
        estimated_amount=Decimal(str(tgt_val.get("gross_estimate", 0))),
        decision=target_scenario.decision,
        reason=target_reason,
        max_fraud_score=float(target_row.fraud_score) if target_row and target_row.fraud_score is not None else 0.0,
    )
    return (
        {"review_state": "source", "photos": [source_photo.photo_path]},
        {"review_state": "duplicate", "photos": [target_photo.photo_path]},
    )


def _seed_clear_case(claim: FnolClaim, scenario: DemoScenario, photo: FnolDamagePhoto) -> dict:
    row, _duplicate_summary, disk_path = _persist_live_fraud_result(claim, photo)
    if disk_path and disk_path.is_file():
        run_damage_assessment_detailed(
            image_path=str(disk_path),
            complaint_id=claim.complaint_id,
            incident_description=scenario.incident_description,
            image_url=photo.photo_path,
        )

    valuation = run_full_valuation(claim.complaint_id)
    gross_est = Decimal(str(valuation.get("gross_estimate", 0)))
    reason = _build_reason(
        "Business-rule and media-trust checks are clear.",
        valuation=valuation,
        max_fraud_score=float(row.fraud_score) if row and row.fraud_score is not None else 0.0,
    )

    _create_evaluation_row(
        scenario,
        gross_est,
        reason,
    )
    claim.excess_amount = Decimal(str(valuation.get("excess_amount", 0)))
    claim.save(update_fields=["excess_amount", "updated_date"])
    _sync_claim_projection(
        claim,
        estimated_amount=gross_est,
        decision=scenario.decision,
        reason=reason,
        max_fraud_score=float(row.fraud_score) if row and row.fraud_score is not None else 0.0,
    )
    return {"review_state": "clear", "photos": [photo.photo_path]}


def _seed_pending_case(claim: FnolClaim, scenario: DemoScenario, photo: FnolDamagePhoto) -> dict:
    reason = "Awaiting image trust, duplicate screening, and valuation analysis."
    _create_evaluation_row(
        scenario,
        Decimal("0.00"),
        reason,
    )
    _sync_claim_projection(
        claim,
        estimated_amount=Decimal("0.00"),
        decision=scenario.decision,
        reason=reason,
        max_fraud_score=0.0,
    )
    return {"review_state": "needs_analysis", "photos": [photo.photo_path]}


class Command(BaseCommand):
    help = "Seed a repeatable Phase 1 golden set using real local media files."

    def add_arguments(self, parser):
        parser.add_argument(
            "--clean",
            action="store_true",
            default=False,
            help="Delete existing DEMO-* claims and evaluations before seeding.",
        )
        parser.add_argument(
            "--manifest-name",
            type=str,
            default="phase1_demo_manifest.json",
            help="Filename for the manifest. Will be forced into vca-python/demo_outputs/.",
        )

    def handle(self, *args, **options):
        _ensure_sqlite_claim_status_table()

        if options["clean"]:
            Claim.objects.filter(claim_id__startswith="DEMO-").delete()
            ClaimEvaluationResponse.objects.filter(complaint_id__startswith="DEMO-").delete()
            FnolClaim.objects.filter(complaint_id__startswith="DEMO-").delete()
            self.stdout.write(self.style.WARNING("Deleted existing DEMO-* claims and evaluations."))

        available_names = _available_media_names()
        used_names: set[str] = set()
        selected_media: dict[str, str] = {}
        for media_key in MEDIA_CHOICES:
            selected = _pick_media_name(media_key, available_names, used_names)
            selected_media[media_key] = selected
            if media_key != "duplicate_shared":
                used_names.add(selected)

        seed_time = timezone.now() - timedelta(minutes=10)
        manifest = {
            "generated_at": timezone.now().isoformat(),
            "media_root": str(_media_root()),
            "claims": {},
        }

        scenario_lookup = {scenario.complaint_id: scenario for scenario in DEMO_SCENARIOS}

        fraud_claim = _upsert_claim_shell(scenario_lookup["DEMO-FRD-001"], seed_time)
        _upsert_claim_projection(fraud_claim, scenario_lookup["DEMO-FRD-001"])
        fraud_photos = _create_photo_rows(
            fraud_claim,
            [selected_media["fraud_primary"], selected_media["fraud_secondary"]],
        )
        manifest["claims"][fraud_claim.complaint_id] = _seed_fraud_escalation(
            fraud_claim,
            scenario_lookup["DEMO-FRD-001"],
            fraud_photos,
        )

        duplicate_source = _upsert_claim_shell(scenario_lookup["DEMO-DUP-SRC"], seed_time + timedelta(minutes=1))
        _upsert_claim_projection(duplicate_source, scenario_lookup["DEMO-DUP-SRC"])
        duplicate_source_photo = _create_photo_rows(
            duplicate_source,
            [selected_media["duplicate_shared"]],
        )[0]

        duplicate_target = _upsert_claim_shell(scenario_lookup["DEMO-DUP-002"], seed_time + timedelta(minutes=2))
        _upsert_claim_projection(duplicate_target, scenario_lookup["DEMO-DUP-002"])
        duplicate_target_photo = _create_photo_rows(
            duplicate_target,
            [selected_media["duplicate_shared"]],
        )[0]

        src_manifest, dup_manifest = _seed_duplicate_pair(
            duplicate_source,
            duplicate_target,
            scenario_lookup["DEMO-DUP-SRC"],
            scenario_lookup["DEMO-DUP-002"],
            duplicate_source_photo,
            duplicate_target_photo,
        )
        manifest["claims"][duplicate_source.complaint_id] = src_manifest
        manifest["claims"][duplicate_target.complaint_id] = dup_manifest

        clear_claim = _upsert_claim_shell(scenario_lookup["DEMO-CLR-003"], seed_time + timedelta(minutes=3))
        _upsert_claim_projection(clear_claim, scenario_lookup["DEMO-CLR-003"])
        clear_photo = _create_photo_rows(clear_claim, [selected_media["clear_primary"]])[0]
        manifest["claims"][clear_claim.complaint_id] = _seed_clear_case(
            clear_claim,
            scenario_lookup["DEMO-CLR-003"],
            clear_photo,
        )

        pending_claim = _upsert_claim_shell(scenario_lookup["DEMO-DAT-004"], seed_time + timedelta(minutes=4))
        _upsert_claim_projection(pending_claim, scenario_lookup["DEMO-DAT-004"])
        pending_photo = _create_photo_rows(pending_claim, [selected_media["pending_primary"]])[0]
        manifest["claims"][pending_claim.complaint_id] = _seed_pending_case(
            pending_claim,
            scenario_lookup["DEMO-DAT-004"],
            pending_photo,
        )

        filename = Path(options.get("manifest_name")).name
        if filename:
            out_path = Path(settings.BASE_DIR) / "demo_outputs" / filename
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            self.stdout.write(f"Manifest written to dedicated folder: {out_path.absolute()}")

        self.stdout.write(self.style.SUCCESS("Seeded Phase 1 golden-set claims using local media."))
        self.stdout.write("Queue-ready complaint IDs:")
        self.stdout.write("  - DEMO-FRD-001 (fraud escalation)")
        self.stdout.write("  - DEMO-DUP-002 (duplicate review)")
        self.stdout.write("  - DEMO-CLR-003 (ready to clear)")
        self.stdout.write("  - DEMO-DAT-004 (needs analysis)")
