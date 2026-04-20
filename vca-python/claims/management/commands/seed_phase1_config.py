"""
Management command: seed Phase 1 PricingConfig rows.

Idempotent — uses get_or_create so re-running is safe.
Skips any key that already has an active row.

Usage:
    python manage.py seed_phase1_config
    python manage.py seed_phase1_config --force  # update existing values too
"""

import logging
from django.core.management.base import BaseCommand
from claims.models import PricingConfig

logger = logging.getLogger(__name__)

PHASE1_CONFIGS = [
    # ── Straight-through decisioning ───────────────────────────────────────────
    {
        "config_key": "STP_MAX_IMAGE_FRAUD_SCORE",
        "config_name": "Straight-through max image fraud score",
        "config_value": "59",
        "config_type": "number",
        "description": (
            "Highest allowed persisted image fraud score for straight-through approval. "
            "Claims at or above this score are routed to manual review."
        ),
        "is_active": True,
    },
    {
        "config_key": "STP_BLOCK_ON_DUPLICATE_CANDIDATES",
        "config_name": "Block straight-through on duplicate candidates",
        "config_value": "true",
        "config_type": "boolean",
        "description": (
            "When true, any persisted cross-claim duplicate candidate blocks "
            "straight-through processing."
        ),
        "is_active": True,
    },
    {
        "config_key": "STP_BLOCK_ON_FAILED_BUSINESS_RULES",
        "config_name": "Block straight-through on failed business rules",
        "config_value": "true",
        "config_type": "boolean",
        "description": (
            "When true, any failed business-rule validation check blocks "
            "straight-through processing."
        ),
        "is_active": True,
    },
    {
        "config_key": "STP_BLOCK_ON_HIGH_FRAUD_BAND",
        "config_name": "Block straight-through on high fraud band",
        "config_value": "true",
        "config_type": "boolean",
        "description": (
            "When true, a High fraud band from business-rule validation blocks "
            "straight-through processing."
        ),
        "is_active": True,
    },
    {
        "config_key": "STP_REQUIRE_STRUCTURED_DAMAGE",
        "config_name": "Require structured damage for straight-through",
        "config_value": "true",
        "config_type": "boolean",
        "description": (
            "When true, claims need structured damage evidence before they can be "
            "approved automatically."
        ),
        "is_active": True,
    },
    {
        "config_key": "STP_ALLOWED_SEVERITIES",
        "config_name": "Allowed severities for straight-through",
        "config_value": "minor,moderate",
        "config_type": "text",
        "description": (
            "Comma-separated severity values that remain eligible for straight-through "
            "processing once all other checks pass."
        ),
        "is_active": True,
    },
    {
        "config_key": "STP_BLOCKING_IMAGE_RISK_CODES",
        "config_name": "Blocking image-risk categories for straight-through",
        "config_value": "ai_generated,edited,staged,stock_internet_sourced",
        "config_type": "text",
        "description": (
            "Comma-separated claim-level image authenticity categories that block "
            "straight-through processing when detected on stored image-fraud rows."
        ),
        "is_active": True,
    },
    # ── Duplicate detection thresholds ────────────────────────────────────────
    {
        "config_key": "DUPLICATE_PHASH_THRESHOLD",
        "config_name": "Duplicate pHash threshold",
        "config_value": "88",
        "config_type": "number",
        "description": (
            "Perceptual hash similarity threshold for cross-claim duplicate detection. "
            "Value 0–100 (treated as percent) or 0.0–1.0 decimal. "
            "Default 88 (= 0.88). Raise to reduce false positives; lower to catch near-matches."
        ),
        "is_active": True,
    },
    {
        "config_key": "DUPLICATE_DHASH_THRESHOLD",
        "config_name": "Duplicate dHash threshold",
        "config_value": "88",
        "config_type": "number",
        "description": (
            "Difference hash similarity threshold. When DUPLICATE_REQUIRE_BOTH_HASHES is true, "
            "both pHash and dHash must meet their respective thresholds for a non-exact match. "
            "Default 88 (= 0.88)."
        ),
        "is_active": True,
    },
    {
        "config_key": "DUPLICATE_REQUIRE_BOTH_HASHES",
        "config_name": "Require both duplicate hashes",
        "config_value": "false",
        "config_type": "boolean",
        "description": (
            "When true, a non-exact perceptual match must pass BOTH pHash and dHash thresholds. "
            "When false (default), either hash alone can trigger a duplicate flag (OR mode). "
            "Accepts: true/1/yes/on or false/0/no/off."
        ),
        "is_active": True,
    },
    # ── Valuation / excess policy ──────────────────────────────────────────────
    {
        "config_key": "EXCESS_PERCENTAGE",
        "config_name": "Excess percentage",
        "config_value": "10.0",
        "config_type": "decimal",
        "description": (
            "Percentage of gross estimate applied as policy excess/deductible. "
            "Default 10 (= 10%). Capped between EXCESS_MINIMUM and EXCESS_MAXIMUM."
        ),
        "is_active": True,
    },
    {
        "config_key": "EXCESS_MINIMUM",
        "config_name": "Excess minimum amount",
        "config_value": "100.00",
        "config_type": "decimal",
        "description": "Minimum excess/deductible amount regardless of percentage. Default 100.",
        "is_active": True,
    },
    {
        "config_key": "EXCESS_MAXIMUM",
        "config_name": "Excess maximum amount",
        "config_value": "500.00",
        "config_type": "decimal",
        "description": "Maximum excess/deductible amount cap. Default 500.",
        "is_active": True,
    },
    # ── Minimum valuation for minor/no-line-item claims ────────────────────────
    {
        "config_key": "MINIMUM_NO_DAMAGE_GROSS_ESTIMATE",
        "config_name": "Minimum gross estimate for minor/zero-output claims",
        "config_value": "2000.00",
        "config_type": "decimal",
        "description": (
            "Base gross estimate used when Damage Assessment produces no priced part lines "
            "(e.g., minor scratch/dent where part detection yields 0 breakdown). "
            "Set to a Thailand-market minimum such as 2000–5000 THB. Default 2000."
        ),
        "is_active": True,
    },
    # ── Legacy claim amount fallback (used by the older damage_assessment path) ──
    {
        "config_key": "claim_base_amount",
        "config_name": "Fallback claim base amount",
        "config_value": "10000.00",
        "config_type": "decimal",
        "description": "Base amount used when claim amount is estimated from count/severity rather than part rows.",
        "is_active": True,
    },
    {
        "config_key": "claim_rate_per_damage",
        "config_name": "Fallback claim rate per damage",
        "config_value": "2000.00",
        "config_type": "decimal",
        "description": "Per-damage increment used by the legacy claim amount estimator.",
        "is_active": True,
    },
    {
        "config_key": "severity_multiplier_minor",
        "config_name": "Minor severity multiplier",
        "config_value": "1.00",
        "config_type": "decimal",
        "description": "Multiplier used when LLM severity resolves to minor.",
        "is_active": True,
    },
    {
        "config_key": "severity_multiplier_moderate",
        "config_name": "Moderate severity multiplier",
        "config_value": "1.20",
        "config_type": "decimal",
        "description": "Multiplier used when LLM severity resolves to moderate.",
        "is_active": True,
    },
    {
        "config_key": "severity_multiplier_severe",
        "config_name": "Severe severity multiplier",
        "config_value": "1.50",
        "config_type": "decimal",
        "description": "Multiplier used when LLM severity resolves to severe.",
        "is_active": True,
    },
    # ── Claim-type evaluation thresholds ───────────────────────────────────────
    {
        "config_key": "MAJOR_CLAIM_THRESHOLD",
        "config_name": "Major claim threshold",
        "config_value": "50000.00",
        "config_type": "decimal",
        "description": (
            "Gross repair estimate threshold that separates a 'Simple Claim' from a 'Major Claim'. "
            "Claims at or above this value are classified as Major Claim; "
            "claims below are classified as Simple Claim. Default 50000."
        ),
        "is_active": True,
    },
    {
        "config_key": "CLAIM_TYPE_SIMPLE_MAX_AMOUNT",
        "config_name": "Simple claim max amount",
        "config_value": "25000.00",
        "config_type": "decimal",
        "description": "Upper bound for SIMPLE claim bucketing.",
        "is_active": True,
    },
    {
        "config_key": "CLAIM_TYPE_MEDIUM_MAX_AMOUNT",
        "config_name": "Medium claim max amount",
        "config_value": "50000.00",
        "config_type": "decimal",
        "description": "Upper bound for MEDIUM claim bucketing; higher amounts become COMPLEX.",
        "is_active": True,
    },
    {
        "config_key": "DEFAULT_CLAIM_THRESHOLD_PERCENT",
        "config_name": "Default claim threshold percent",
        "config_value": "75.00",
        "config_type": "decimal",
        "description": "Fallback threshold used when claim_type_master is not populated.",
        "is_active": True,
    },
    {
        "config_key": "CLAIM_EVALUATION_HIGH_AMOUNT_FACTOR",
        "config_name": "High amount evaluation score factor",
        "config_value": "0.70",
        "config_type": "decimal",
        "description": "Multiplier applied to evaluation score when estimated amount exceeds the medium bucket.",
        "is_active": True,
    },
    # ── Currency ───────────────────────────────────────────────────────────────
    {
        "config_key": "CURRENCY_CODE",
        "config_name": "Currency code",
        "config_value": "THB",
        "config_type": "text",
        "description": (
            "ISO 4217 currency code used in valuation summaries and API responses. "
            "Default THB (Thai Baht). Max 8 characters."
        ),
        "is_active": True,
    },
    {
        "config_key": "CURRENCY_LOCALE",
        "config_name": "Currency locale",
        "config_value": "th-TH",
        "config_type": "text",
        "description": "Locale used by the frontend for currency formatting.",
        "is_active": True,
    },
    {
        "config_key": "DEFAULT_MARKET_COUNTRY",
        "config_name": "Default market country",
        "config_value": "Thailand",
        "config_type": "text",
        "description": "Fallback country used when a claim does not provide a recognizable accident location.",
        "is_active": True,
    },
    {
        "config_key": "DEFAULT_MARKET_CITY",
        "config_name": "Default market city",
        "config_value": "Bangkok",
        "config_type": "text",
        "description": "Fallback city used when a claim does not provide a recognizable accident location.",
        "is_active": True,
    },
    {
        "config_key": "DEFAULT_ACCIDENT_LOCATION",
        "config_name": "Default accident location",
        "config_value": "Bangkok, Thailand",
        "config_type": "text",
        "description": "Fallback accident location label for valuation and pricing prompts.",
        "is_active": True,
    },
    {
        "config_key": "MARKET_REGION_LABEL",
        "config_name": "Default market region label",
        "config_value": "Thailand vehicle repair market",
        "config_type": "text",
        "description": "Fallback human-readable region used in pricing prompts and pipeline metadata.",
        "is_active": True,
    },
]


class Command(BaseCommand):
    help = "Seed Phase 1 PricingConfig rows (idempotent). Use --force to overwrite existing values."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Update config_value even if the key already exists.",
        )

    def handle(self, *args, **options):
        force = options["force"]
        created_count = 0
        updated_count = 0
        skipped_count = 0

        for cfg in PHASE1_CONFIGS:
            existing = PricingConfig.objects.filter(config_key=cfg["config_key"]).first()

            if existing is None:
                try:
                    PricingConfig.objects.create(**cfg)
                    self.stdout.write(
                        self.style.SUCCESS(f"  Created  {cfg['config_key']} = {cfg['config_value']}")
                    )
                    created_count += 1
                except Exception as exc:
                    self.stdout.write(
                        self.style.ERROR(f"  Failed   {cfg['config_key']}: {exc}")
                    )
            elif force:
                for field in ("config_value", "config_name", "description", "is_active"):
                    setattr(existing, field, cfg[field])
                existing.save(update_fields=["config_value", "config_name", "description", "is_active"])
                self.stdout.write(
                    self.style.WARNING(f"  Updated  {cfg['config_key']} = {cfg['config_value']}")
                )
                updated_count += 1
            else:
                self.stdout.write(
                    f"  Skipped  {cfg['config_key']} (already exists; use --force to overwrite)"
                )
                skipped_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone - created: {created_count}, updated: {updated_count}, skipped: {skipped_count}"
            )
        )
