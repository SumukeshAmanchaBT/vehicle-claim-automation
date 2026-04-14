from __future__ import annotations

from decimal import Decimal
from typing import Optional

from claims.models import FnolClaim, PricingConfig


MARKET_HINTS = (
    {
        "keywords": (
            "bangkok",
            "thailand",
            "chiang mai",
            "phuket",
            "pattaya",
            "nonthaburi",
            "khon kaen",
            "ayutthaya",
        ),
        "country": "Thailand",
        "city": "Bangkok",
        "currency_code": "THB",
        "locale": "th-TH",
        "market_label": "Thailand vehicle repair market",
    },
    {
        "keywords": (
            "kuala lumpur",
            "malaysia",
            "selangor",
            "penang",
            "johor",
            "ipoh",
            "malacca",
            "shah alam",
            "petaling jaya",
        ),
        "country": "Malaysia",
        "city": "Kuala Lumpur",
        "currency_code": "MYR",
        "locale": "ms-MY",
        "market_label": "Malaysia vehicle repair market",
    },
)


def get_pricing_config_string(key: str, default: str = "") -> str:
    """Return a trimmed PricingConfig string value or a safe default."""
    row = PricingConfig.objects.filter(config_key=key, is_active=True).first()
    if not row or row.config_value is None:
        return default
    value = str(row.config_value).strip()
    return value or default


def get_pricing_config_decimal(
    key: str, default: Optional[Decimal] = None
) -> Optional[Decimal]:
    """Return a PricingConfig value as Decimal when possible."""
    row = PricingConfig.objects.filter(config_key=key, is_active=True).first()
    if not row or row.config_value in (None, ""):
        return default
    try:
        return Decimal(str(row.config_value).strip())
    except Exception:
        return default


def get_pricing_config_float(key: str, default: float) -> float:
    """Return a PricingConfig value as float when possible."""
    value = get_pricing_config_decimal(key)
    if value is None:
        return default
    try:
        return float(value)
    except Exception:
        return default


def get_pricing_config_boolean(key: str, default: bool = False) -> bool:
    """Return a PricingConfig value as bool when possible."""
    row = PricingConfig.objects.filter(config_key=key, is_active=True).first()
    if not row or row.config_value in (None, ""):
        return default
    return str(row.config_value).strip().lower() in {"1", "true", "yes", "on"}


def get_claim_amount_settings() -> dict[str, float]:
    """Config-backed defaults for legacy claim amount estimation."""
    return {
        "base_amount": get_pricing_config_float("claim_base_amount", 10000.0),
        "rate_per_damage": get_pricing_config_float("claim_rate_per_damage", 2000.0),
        "multiplier_minor": get_pricing_config_float("severity_multiplier_minor", 1.0),
        "multiplier_moderate": get_pricing_config_float(
            "severity_multiplier_moderate", 1.2
        ),
        "multiplier_severe": get_pricing_config_float(
            "severity_multiplier_severe", 1.5
        ),
    }


def get_major_claim_threshold() -> float:
    """
    Return the gross-repair-estimate threshold that separates 'Simple Claim' from 'Major Claim'.

    Classification rule:
        gross_estimate >= threshold  →  "Major Claim"
        gross_estimate  < threshold  →  "Simple Claim"

    Reads from PricingConfig key ``MAJOR_CLAIM_THRESHOLD``; falls back to 50 000
    (same as CLAIM_TYPE_MEDIUM_MAX_AMOUNT default) when the key is not configured.
    """
    return get_pricing_config_float("MAJOR_CLAIM_THRESHOLD", 50_000.0)


def get_claim_type_settings() -> dict[str, float]:
    """Config-backed defaults for claim-type bucketing and fallback thresholds."""
    return {
        "simple_max_amount": get_pricing_config_float(
            "CLAIM_TYPE_SIMPLE_MAX_AMOUNT", 25000.0
        ),
        "medium_max_amount": get_pricing_config_float(
            "CLAIM_TYPE_MEDIUM_MAX_AMOUNT", 50000.0
        ),
        "fallback_threshold_percent": get_pricing_config_float(
            "DEFAULT_CLAIM_THRESHOLD_PERCENT", 75.0
        ),
        "high_amount_score_factor": get_pricing_config_float(
            "CLAIM_EVALUATION_HIGH_AMOUNT_FACTOR", 0.7
        ),
    }


def _locale_for_currency(currency_code: str) -> str:
    normalized = (currency_code or "").strip().upper()
    if normalized == "MYR":
        return "ms-MY"
    if normalized == "THB":
        return "th-TH"
    return "en-US"


def _default_market_context() -> dict[str, str]:
    currency_code = get_pricing_config_string("CURRENCY_CODE", "THB").upper() or "THB"
    locale = get_pricing_config_string(
        "CURRENCY_LOCALE", _locale_for_currency(currency_code)
    )
    country = get_pricing_config_string("DEFAULT_MARKET_COUNTRY", "Thailand")
    city = get_pricing_config_string("DEFAULT_MARKET_CITY", "Bangkok")
    market_label = get_pricing_config_string(
        "MARKET_REGION_LABEL", f"{country} vehicle repair market"
    )
    accident_location = get_pricing_config_string(
        "DEFAULT_ACCIDENT_LOCATION", f"{city}, {country}"
    )
    return {
        "country": country,
        "city": city,
        "currency_code": currency_code,
        "locale": locale,
        "market_label": market_label,
        "accident_location": accident_location,
    }


def resolve_market_context(accident_location: str | None = None) -> dict[str, str]:
    """
    Resolve market/currency metadata from accident location.

    Thailand and Malaysia are first-class mappings because the Phase 1 docs and
    deployment plan are centered on those markets. Unknown locations fall back
    to PricingConfig-backed defaults.
    """
    normalized_location = (accident_location or "").strip()
    lowered = normalized_location.lower()

    for hint in MARKET_HINTS:
        if any(keyword in lowered for keyword in hint["keywords"]):
            return {
                "country": hint["country"],
                "city": hint["city"],
                "currency_code": hint["currency_code"],
                "locale": hint["locale"],
                "market_label": hint["market_label"],
                "accident_location": normalized_location or f"{hint['city']}, {hint['country']}",
            }

    fallback = _default_market_context()
    if normalized_location:
        fallback["accident_location"] = normalized_location
    return fallback


def get_claim_market_context(
    *,
    claim: FnolClaim | None = None,
    complaint_id: str | None = None,
    accident_location: str | None = None,
) -> dict[str, str]:
    """Resolve claim-specific market metadata when a claim or complaint_id is available."""
    if claim is None and complaint_id:
        claim = (
            FnolClaim.objects.filter(complaint_id=complaint_id)
            .only("complaint_id", "accident_location")
            .first()
        )

    location = accident_location
    if location is None and claim is not None:
        location = claim.accident_location

    return resolve_market_context(location)


def get_claim_vehicle_profile(
    *,
    claim: FnolClaim | None = None,
    complaint_id: str | None = None,
) -> dict[str, str | int | None]:
    """Return the claim's declared vehicle profile for pricing context."""
    if claim is None and complaint_id:
        claim = (
            FnolClaim.objects.filter(complaint_id=complaint_id)
            .only("complaint_id", "vehicle_make", "vehicle_model", "vehicle_year")
            .first()
        )

    if claim is None:
        return {
            "make": None,
            "model": None,
            "year": None,
            "display_name": None,
        }

    make = (claim.vehicle_make or "").strip() or None
    model = (claim.vehicle_model or "").strip() or None
    year = claim.vehicle_year
    display_bits = [str(x) for x in (year, make, model) if x not in (None, "")]

    return {
        "make": make,
        "model": model,
        "year": year,
        "display_name": " ".join(display_bits) or None,
    }
