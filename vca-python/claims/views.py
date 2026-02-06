import random
import re
from typing import Optional, Tuple

from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (
    ClaimRuleMaster,
    ClaimTypeMaster,
    DamageCodeMaster,
    FnolResponse,
)


def product_rule(policy: dict) -> bool:
    """
    Policy validation rule.
    Currently checks that policy status is Active.
    Rule definition is stored in claim_rule_master (type 'Policy Status').
    """
    _ = (
        ClaimRuleMaster.objects.filter(
            rule_type__iexact="Policy Status", is_active=True
        ).first()
    )
    return policy.get("policy_status") == "Active"


def _get_early_claim_window_days() -> int:
    """
    Reads the 'Early Claim' rule from claim_rule_master and extracts the
    day threshold from rule_expression (e.g. 'Claim < 30 days').
    Defaults to 30 if parsing fails.
    """
    rule = ClaimRuleMaster.objects.filter(
        rule_type__iexact="Early Claim", is_active=True
    ).first()
    if not rule or not rule.rule_expression:
        return 30

    match = re.search(r"(\d+)", rule.rule_expression)
    if not match:
        return 30
    try:
        return int(match.group(1))
    except ValueError:
        return 30


def fraud_check(history: dict, incident: dict, policy: dict) -> str:
    """
    Fraud check combining history and database-driven early-claim rule.
    """
    # 1) Early-claim rule based on dates and DB-configured window
    early_window_days = _get_early_claim_window_days()
    start_date = parse_date(policy.get("policy_start_date"))
    loss_dt = parse_datetime(incident.get("date_time_of_loss"))

    if start_date and loss_dt:
        days_diff = (loss_dt.date() - start_date).days
        # Claim before policy start or within "early" window is high risk
        if days_diff < 0 or days_diff < early_window_days:
            return "High"

    # 2) Historical claims rule
    if history.get("previous_claims_last_12_months", 0) >= 3:
        return "High"

    # 3) Simple location-based medium risk rule
    if "location" in incident and incident["location"] != "Bangalore":
        return "Medium"

    return "Low"


def damage_detection(incident: dict) -> int:
    """
    Damage confidence based on damage_code_master.
    Starts with a base confidence and adds severity percentages for each
    matching damage_type found in the loss description.
    """
    description = (incident.get("loss_description") or "").lower()
    base_confidence = 50.0

    for damage in DamageCodeMaster.objects.filter(is_active=True):
        damage_keyword = (damage.damage_type or "").lower()
        if damage_keyword and damage_keyword in description:
            base_confidence += float(damage.severity_percentage or 0)

    # Clamp between 0 and 100 and convert to int
    return max(0, min(int(round(base_confidence)), 100))


def _get_claim_type_threshold(
    incident: dict,
) -> Tuple[float, Optional[str]]:
    """
    Determine claim type bucket (SIMPLE / MEDIUM / COMPLEX) from
    estimated amount and read its risk_percentage from claim_type_master.
    Returns (threshold, claim_type_name).
    """
    amount = incident.get("estimated_amount") or 0

    if amount <= 25000:
        claim_type_name = "SIMPLE"
    elif amount <= 50000:
        claim_type_name = "MEDIUM"
    else:
        claim_type_name = "COMPLEX"

    row = ClaimTypeMaster.objects.filter(
        claim_type_name__iexact=claim_type_name, is_active=True
    ).first()

    if not row:
        # Fallback to previous static threshold of 0.75
        return 0.75, None

    try:
        threshold = float(row.risk_percentage) / 100.0
    except (TypeError, ValueError):
        threshold = 0.75

    return threshold, claim_type_name


def evaluate_score(confidence: int, amount: float) -> float:
    base = confidence / 100
    if amount > 50000:
        base *= 0.7
    return round(base, 2)


@api_view(['GET'])
def list_fnol(request):
    """
    Return a list of FNOL responses.
    """
    qs = FnolResponse.objects.filter(deleted_date__isnull=True).order_by(
        "-created_date"
    )
    data = [
        {
            "id": obj.id,
            "raw_response": obj.raw_response,
            "created_date": obj.created_date,
            "created_by": obj.created_by,
            "updated_date": obj.updated_date,
            "updated_by": obj.updated_by,
        }
        for obj in qs
    ]
    return Response(data)


@api_view(['GET'])
def get_fnol(request, pk: int):
    """
    Return a single FNOL response by ID.
    """
    obj = get_object_or_404(
        FnolResponse,
        pk=pk,
        deleted_date__isnull=True,
    )
    data = {
        "id": obj.id,
        "raw_response": obj.raw_response,
        "created_date": obj.created_date,
        "created_by": obj.created_by,
        "updated_date": obj.updated_date,
        "updated_by": obj.updated_by,
    }
    return Response(data)


@api_view(['POST'])
def save_fnol(request):
    """
    Basic FNOL save endpoint.
    In a real system this would persist data to the database.
    For now it validates input and echoes it back.
    """
    data = request.data.get("fnol")

    if data is None:
        return Response(
            {"detail": "Field 'fnol' is required in request body."},
            status=400,
        )

    created_by = getattr(getattr(request, "user", None), "username", None) or "api_user"

    record = FnolResponse.objects.create(
        raw_response=data,
        created_by=created_by,
        updated_by=created_by,
    )

    return Response(
        {
            "message": "FNOL saved successfully",
            "id": record.id,
        },
        status=201,
    )


@api_view(['POST'])
def process_claim(request):
    data = request.data["fnol"]

    policy = data["policy"]
    incident = data["incident"]
    history = data["history"]
    documents = data["documents"]

    # Step 1: Product Rule (policy validation via DB-driven rule)
    if not product_rule(policy):
        return Response({
            "decision": "Reject",
            "reason": "Policy inactive"
        })

    # Step 2: Fraud Check (uses Early Claim rule from DB)
    fraud_score = fraud_check(history, incident, policy)
    if fraud_score == "High":
        return Response({
            "decision": "Reject",
            "reason": "High fraud risk"
        })

    # Step 3: Document Check
    if not documents["photos_uploaded"]:
        return Response({
            "decision": "Manual Review",
            "reason": "Photos missing"
        })

    # Step 4: Damage Detection (now uses damage_code_master)
    confidence = damage_detection(incident)

    # Step 5: Evaluation
    score = evaluate_score(confidence, incident["estimated_amount"])

    # Step 6: Threshold based on claim_type_master
    threshold, claim_type_name = _get_claim_type_threshold(incident)

    if score >= threshold:
        decision = "Auto Approve"
        status = "Closed"
    else:
        decision = "Manual Review"
        status = "Open"

    return Response({
        "claim_id": data["claim_id"],
        "damage_confidence": confidence,
        "fraud_score": fraud_score,
        "evaluation_score": score,
        "threshold": threshold,
        "claim_type": claim_type_name,
        "decision": decision,
        "claim_status": status
    })

