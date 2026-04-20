"""
Valuation service for FNOL claims.

Computes total claim value from part-level damage assessments,
applies policy rules (excess, deductible), and returns
valuation summary (gross estimate, excess, net payable).
"""

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from claims.phase1_runtime import (
    get_claim_market_context,
    get_pricing_config_decimal,
)

logger = logging.getLogger(__name__)

# Default policy settings (can be overridden by PricingConfig)
DEFAULT_EXCESS_PERCENTAGE = Decimal("10.0")  # 10% excess
DEFAULT_EXCESS_MINIMUM = Decimal("100.00")   # Minimum excess amount
DEFAULT_EXCESS_MAXIMUM = Decimal("500.00")   # Maximum excess amount
DEFAULT_CURRENCY = "THB"


def _decimal_gt_zero(value) -> bool:
    if value in (None, ""):
        return False
    try:
        return Decimal(str(value)) > 0
    except Exception:
        return False


def _valuation_has_meaningful_output(valuation_data: dict) -> bool:
    gross_estimate = valuation_data.get("gross_estimate")
    if _decimal_gt_zero(gross_estimate):
        return True

    breakdown = valuation_data.get("breakdown") or []
    if not isinstance(breakdown, list):
        return False

    for row in breakdown:
        if not isinstance(row, dict):
            continue
        if _decimal_gt_zero(row.get("estimated_amount", row.get("estimated_cost"))):
            return True
    return False


def get_excess_settings() -> dict:
    """
    Get excess/deductible settings from PricingConfig or defaults.

    Returns dict with:
    - excess_percentage: Decimal
    - excess_minimum: Decimal
    - excess_maximum: Decimal
    """
    return {
        "excess_percentage": get_pricing_config_decimal(
            "EXCESS_PERCENTAGE", DEFAULT_EXCESS_PERCENTAGE
        ),
        "excess_minimum": get_pricing_config_decimal(
            "EXCESS_MINIMUM", DEFAULT_EXCESS_MINIMUM
        ),
        "excess_maximum": get_pricing_config_decimal(
            "EXCESS_MAXIMUM", DEFAULT_EXCESS_MAXIMUM
        ),
    }


def calculate_parts_total(complaint_id: str) -> Decimal:
    """
    Sum estimated amounts from all DamagePartAssessment rows for a claim.

    Args:
        complaint_id: The claim ID

    Returns:
        Decimal sum of all part estimated amounts
    """
    from claims.models import DamagePartAssessment, FnolClaim

    total = Decimal("0.00")

    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            return total

        assessments = DamagePartAssessment.objects.filter(complaint=claim)
        for assessment in assessments:
            if assessment.estimated_amount:
                total += assessment.estimated_amount

    except Exception:
        logger.exception("Failed to calculate parts total")

    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_excess(gross_estimate: Decimal, settings: dict) -> Decimal:
    """
    Calculate excess/deductible amount.

    Args:
        gross_estimate: Total estimated repair cost
        settings: Dict from get_excess_settings()

    Returns:
        Decimal excess amount (capped between min/max)
    """
    if gross_estimate <= 0:
        return Decimal("0.00")

    excess_percentage = settings.get("excess_percentage", DEFAULT_EXCESS_PERCENTAGE)
    excess_minimum = settings.get("excess_minimum", DEFAULT_EXCESS_MINIMUM)
    excess_maximum = settings.get("excess_maximum", DEFAULT_EXCESS_MAXIMUM)

    # Calculate percentage-based excess
    excess = (gross_estimate * excess_percentage) / Decimal("100")

    # Apply min/max caps
    if excess_minimum and excess < excess_minimum:
        excess = excess_minimum
    if excess_maximum and excess > excess_maximum:
        excess = excess_maximum

    # Cannot exceed gross estimate
    if excess > gross_estimate:
        excess = gross_estimate

    return excess.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_net_payable(gross_estimate: Decimal, excess: Decimal) -> Decimal:
    """
    Calculate net payable amount.

    Args:
        gross_estimate: Total estimated repair cost
        excess: Excess/deductible amount

    Returns:
        Decimal net payable (never negative)
    """
    net = gross_estimate - excess
    if net < 0:
        net = Decimal("0.00")
    return net.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_claim_valuation(
    complaint_id: str,
    apply_excess: bool = True,
) -> dict:
    """
    Complete valuation calculation for a claim.

    Args:
        complaint_id: The claim ID
        apply_excess: Whether to calculate and apply excess

    Returns:
        Dict with:
        - gross_estimate: Decimal
        - excess_amount: Decimal (or 0 if apply_excess=False)
        - net_payable: Decimal
        - currency_code: str
        - market_context: dict
        - breakdown: list of part assessments
        - settings: excess settings used
    """
    from claims.models import DamagePartAssessment, FnolClaim

    result = {
        "gross_estimate": Decimal("0.00"),
        "excess_amount": Decimal("0.00"),
        "net_payable": Decimal("0.00"),
        "currency_code": DEFAULT_CURRENCY,
        "market_context": get_claim_market_context(),
        "breakdown": [],
        "settings": {},
    }

    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            return result

        # Get part assessments breakdown
        assessments = DamagePartAssessment.objects.filter(complaint=claim).order_by("sort_order")
        breakdown = []
        for assessment in assessments:
            breakdown.append({
                "part_name": assessment.part_name,
                "damage_type": assessment.damage_type,
                "severity_percent": float(assessment.severity_percent) if assessment.severity_percent else 0,
                "repair_action": assessment.repair_action,
                "estimated_amount": float(assessment.estimated_amount) if assessment.estimated_amount else 0,
            })

        result["breakdown"] = breakdown

        market_context = get_claim_market_context(claim=claim)
        result["market_context"] = market_context
        result["currency_code"] = market_context["currency_code"][:8]

        # Calculate totals
        gross = calculate_parts_total(complaint_id)

        # Minimum estimate for zero-output claims (e.g., small scratch / no priced parts).
        # Default is 0 so existing behavior is unchanged unless configured.
        minimum_no_damage_gross = (
            get_pricing_config_decimal("MINIMUM_NO_DAMAGE_GROSS_ESTIMATE", Decimal("0.00"))
            or Decimal("0.00")
        )
        if (
            gross <= 0
            and not breakdown
            and minimum_no_damage_gross is not None
            and minimum_no_damage_gross > 0
        ):
            gross = minimum_no_damage_gross.quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )

        result["gross_estimate"] = gross

        if apply_excess:
            settings = get_excess_settings()
            result["settings"] = {k: float(v) for k, v in settings.items()}
            excess = calculate_excess(gross, settings)
            result["excess_amount"] = excess
        else:
            excess = Decimal("0.00")
            result["excess_amount"] = excess

        net = calculate_net_payable(gross, excess)
        result["net_payable"] = net

    except Exception:
        logger.exception("Failed to calculate claim valuation")

    return result


def save_valuation_summary(
    complaint_id: str,
    valuation_data: dict,
    persist_sentinel: bool = True,
) -> bool:
    """
    Save valuation results to the claim valuation snapshot and update ClaimEvaluationResponse.

    Args:
        complaint_id:     The claim ID
        valuation_data:   Dict from calculate_claim_valuation
        persist_sentinel: When True (default) and valuation has no meaningful output,
                          upsert a zero sentinel row so workflow_state can detect that
                          DA ran but found nothing.  Pass False from GET-only paths
                          (e.g. run_full_valuation) so that a sentinel is not created
                          before any DA has actually been executed.

    Returns:
        True if saved successfully
    """
    from claims.models import ClaimPhase1Valuation, ClaimEvaluationResponse, FnolClaim

    try:
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            return False

        if not _valuation_has_meaningful_output(valuation_data):
            if persist_sentinel:
                # Upsert a zero sentinel row so that workflow_state can detect "DA ran
                # but produced no meaningful financial output" via has_current_da_artifact.
                # This avoids the UI incorrectly showing "Damage Assessment not yet run"
                # when DA completed but found no priced parts (e.g. LLM unavailability).
                ClaimPhase1Valuation.objects.update_or_create(
                    complaint=claim,
                    defaults={
                        "gross_estimate": Decimal("0.00"),
                        "excess_amount": Decimal("0.00"),
                        "net_payable": Decimal("0.00"),
                        "currency_code": valuation_data.get("currency_code", DEFAULT_CURRENCY),
                        "breakdown_json": valuation_data.get("breakdown") or [],
                    },
                )
            return True

        valuation, created = ClaimPhase1Valuation.objects.update_or_create(
            complaint=claim,
            defaults={
                "gross_estimate": valuation_data.get("gross_estimate"),
                "excess_amount": valuation_data.get("excess_amount"),
                "net_payable": valuation_data.get("net_payable"),
                "currency_code": valuation_data.get("currency_code", DEFAULT_CURRENCY),
                "breakdown_json": valuation_data.get("breakdown"),
            },
        )

        # Also update ClaimEvaluationResponse if exists
        latest_eval = ClaimEvaluationResponse.objects.filter(
            complaint_id=complaint_id, is_latest=True
        ).first()

        if latest_eval:
            latest_eval.estimated_amount = valuation_data.get("gross_estimate")
            latest_eval.claim_amount = valuation_data.get("net_payable")
            latest_eval.save(update_fields=["estimated_amount", "claim_amount", "updated_date"])

        return True

    except Exception:
        logger.exception("Failed to save valuation summary")
        return False


def run_full_valuation(complaint_id: str, *, persist_sentinel: bool = False) -> dict:
    """
    Complete valuation pipeline: calculate and persist.

    Args:
        complaint_id: The claim ID
        persist_sentinel: When True, persist a valuation snapshot even if the valuation
            is zero-output (used after DA runs so workflow advances and UI shows the
            configured minimum/no-damage base amount). Keep False for GET-only calls.

    Returns:
        Valuation dict with all amounts
    """
    # Calculate valuation
    valuation = calculate_claim_valuation(complaint_id, apply_excess=True)

    # Persist results
    save_valuation_summary(complaint_id, valuation, persist_sentinel=persist_sentinel)

    # Convert Decimal to float for JSON serialization
    return {
        "gross_estimate": float(valuation["gross_estimate"]),
        "excess_amount": float(valuation["excess_amount"]),
        "net_payable": float(valuation["net_payable"]),
        "currency_code": valuation["currency_code"],
        "market_context": valuation.get("market_context", {}),
        "breakdown": valuation["breakdown"],
    }
