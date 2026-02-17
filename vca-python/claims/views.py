import json
import random
import re
from datetime import date
from typing import Optional, Tuple

from django.contrib.auth import authenticate
from django.contrib.auth.models import User, Group
from django.db import connection
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from core.models import UserProfile
from core.permissions import has_permission, has_user_update_permission, is_admin
from .models import (
    ClaimRuleMaster,
    ClaimTypeMaster,
    ClaimStatus,
    DamageCodeMaster,
    ClaimEvaluationResponse,
    FnolClaim,
    FnolDamagePhoto,
    Claim,
    PricingConfig,
)
from .serializers import (
    LoginSerializer,
    UserSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    ChangeRoleSerializer,
    ResetPasswordSerializer,
    ClaimTypeMasterSerializer,
    ClaimRuleMasterSerializer,
    DamageCodeMasterSerializer,
    PricingConfigSerializer,
)


def _is_admin_user(user) -> bool:
    """True if user is admin (uses core.permissions so UserRole and Django Group are respected)."""
    return is_admin(user)


def _get_pricing_config_value(key: str, default: float) -> float:
    """Get numeric config value from PricingConfig by config_key."""
    try:
        row = PricingConfig.objects.filter(config_key=key, is_active=True).first()
        if row and row.config_value:
            return float(row.config_value)
    except (ValueError, TypeError, AttributeError):
        pass
    return default


def estimate_claim_amount_from_config(
    damages: list, severity: str, base_estimated_amount: float = 0
) -> float:
    """
    Estimate claim amount from PricingConfig based on LLM damages and severity.
    Formula: (base_amount + damage_count * rate_per_damage) * severity_multiplier
    Config keys: claim_base_amount, claim_rate_per_damage,
                 severity_multiplier_minor, severity_multiplier_moderate, severity_multiplier_severe
    """
    base = _get_pricing_config_value("claim_base_amount", 10000.0)
    rate_per_damage = _get_pricing_config_value("claim_rate_per_damage", 2000.0)
    mult_minor = _get_pricing_config_value("severity_multiplier_minor", 1.0)
    mult_moderate = _get_pricing_config_value("severity_multiplier_moderate", 1.2)
    mult_severe = _get_pricing_config_value("severity_multiplier_severe", 1.5)

    severity_lower = (severity or "").strip().lower()
    if severity_lower == "minor":
        mult = mult_minor
    elif severity_lower == "moderate":
        mult = mult_moderate
    elif severity_lower == "severe":
        mult = mult_severe
    else:
        mult = mult_moderate  # default

    damage_count = len([d for d in damages if d and str(d).lower() != "none"])
    if damage_count == 0:
        damage_count = 1  # at least 1 for "no damage" case
    amount = (base + damage_count * rate_per_damage) * mult
    if base_estimated_amount and base_estimated_amount > 0:
        amount = max(amount, float(base_estimated_amount))
    return round(amount, 2)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_user(request):
    if not (has_permission(request.user, "users.add") or is_admin(request.user)):
        return Response(
            {"error": "Forbidden - users.add permission or Admin role required"},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = UserCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

    user = serializer.save()
    UserProfile.objects.get_or_create(user=user, defaults={"is_delete": False})
    _set_auth_user_is_delete(user.pk, 0)
    return Response({"user": UserSerializer(user).data, "message": "User created."}, status=status.HTTP_201_CREATED)


def _user_not_deleted_queryset():
    """Exclude users only when BOTH auth_user.is_delete=1 AND profile.is_delete=1. Show if is_delete=0 in auth_user (restored) or profile not deleted."""
    auth_table = User._meta.db_table
    profile_table = UserProfile._meta.db_table
    # Join user_profile so we can reference it in WHERE (all users: no profile OR profile with any is_delete)
    qs = User.objects.filter(
        Q(userprofile__isnull=True) | Q(userprofile__is_delete=False) | Q(userprofile__is_delete=True)
    )
    try:
        # Show when: auth says not deleted OR no profile OR profile says not deleted (so restored users with auth_user.is_delete=0 appear)
        qs = qs.extra(where=[
            f"(COALESCE({auth_table}.is_delete, 0) = 0) OR ({profile_table}.id IS NULL) OR ({profile_table}.is_delete = 0)"
        ])
    except Exception:
        pass
    return qs


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_users(request):
    if not (has_permission(request.user, "users.view") or is_admin(request.user)):
        return Response(
            {"error": "Forbidden - users.view permission or Admin role required"},
            status=status.HTTP_403_FORBIDDEN,
        )
    users = _user_not_deleted_queryset()
    payload = []
    for u in users:
        role = u.groups.first().name if u.groups.exists() else 'User'
        status_text = 'Active' if u.is_active else 'Inactive'
        
        # Try to get claims count, gracefully handle if table doesn't exist
        try:
            claims_handled = Claim.objects.filter(created_by=u.username).count()
        except Exception:
            claims_handled = 0
            
        payload.append({
            'id': u.id,
            'username': u.username,
            'email': u.email,
            'first_name': u.first_name,
            'last_name': u.last_name,
            'role': 'Admin' if u.is_superuser == 1 else 'Users',
            'status': status_text,
            'claims_handled': claims_handled,
            'last_login': u.last_login,
        })

    return Response(payload, status=status.HTTP_200_OK)


@api_view(['PATCH', 'PUT'])
@permission_classes([IsAuthenticated])
def edit_user(request, pk):
    user = get_object_or_404(User, pk=pk)
    if user.id != request.user.id and not has_user_update_permission(request.user):
        return Response({"error": "Forbidden - users.update/users.edit permission or Admin role required to edit others"}, status=status.HTTP_403_FORBIDDEN)
    
    serializer = UserUpdateSerializer(user, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    return Response({"user": UserSerializer(user).data, "message": "User updated."}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_role(request, pk):
    if not has_user_update_permission(request.user):
        return Response({"error": "Forbidden - users.update/users.edit permission or Admin role required"}, status=status.HTTP_403_FORBIDDEN)

    user = get_object_or_404(User, pk=pk)
    serializer = ChangeRoleSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
    role = serializer.validated_data.get('role')
    grp, _ = Group.objects.get_or_create(name=role)
    user.groups.clear()
    user.groups.add(grp)
    return Response({"message": "Role updated.", "role": role}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reset_password(request, pk):
    if not has_user_update_permission(request.user):
        return Response({"error": "Forbidden - users.update/users.edit permission or Admin role required"}, status=status.HTTP_403_FORBIDDEN)

    user = get_object_or_404(User, pk=pk)
    serializer = ResetPasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
    new_password = serializer.validated_data.get('new_password')
    user.set_password(new_password)
    user.save()
    return Response({"message": "Password reset."}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def deactivate_user(request, pk):
    if not (has_permission(request.user, "users.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - users.delete permission or Admin role required"}, status=status.HTTP_403_FORBIDDEN)

    user = get_object_or_404(User, pk=pk)
    user.is_active = False
    user.save()
    return Response({"message": "User deactivated."}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def activate_user(request, pk):
    if not (has_permission(request.user, "users.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - users.delete permission or Admin role required"}, status=status.HTTP_403_FORBIDDEN)

    user = get_object_or_404(User, pk=pk)
    user.is_active = True
    user.save()
    return Response({"message": "User activated."}, status=status.HTTP_200_OK)


def _set_auth_user_is_delete(user_id: int, value: int) -> None:
    """Update auth_user.is_delete in DB (column may exist without being on Django User model)."""
    table = User._meta.db_table
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f"UPDATE {table} SET is_delete = %s WHERE id = %s",
                [value, user_id],
            )
    except Exception:
        pass


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def soft_delete_user(request, pk):
    """Soft delete: set is_delete=1 in auth_user and UserProfile so user is hidden from lists. Also set is_active=False."""
    if not (has_permission(request.user, "users.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - users.delete permission or Admin role required"}, status=status.HTTP_403_FORBIDDEN)

    user = get_object_or_404(User, pk=pk)
    profile, _ = UserProfile.objects.get_or_create(user=user, defaults={"is_delete": False})
    profile.is_delete = True
    profile.save()
    user.is_active = False
    user.save()
    _set_auth_user_is_delete(user.pk, 1)
    return Response({"message": "User soft-deleted."}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    """
    User login endpoint.
    
    Accepts POST request with username and password.
    Returns authentication token and user information.
    
    Request body:
    {
        "username": "string",
        "password": "string"
    }
    
    Response:
    {
        "token": "string",
        "user": {
            "id": "int",
            "username": "string",
            "email": "string",
            "first_name": "string",
            "last_name": "string"
        },
        "message": "string"
    }
    """
    serializer = LoginSerializer(data=request.data)
    
    if not serializer.is_valid():
        return Response(
            {
                "error": serializer.errors,
                "message": "Invalid credentials provided."
            },
            status=status.HTTP_400_BAD_REQUEST
        )
    
    username = serializer.validated_data.get('username')
    password = serializer.validated_data.get('password')
    
    # Authenticate user
    user = authenticate(username=username, password=password)
    
    if user is None:
        return Response(
            {
                "error": "Invalid username or password.",
                "message": "Authentication failed."
            },
            status=status.HTTP_401_UNAUTHORIZED
        )
    
    # Get or create token for user
    token, created = Token.objects.get_or_create(user=user)
    
    user_serializer = UserSerializer(user)
    
    return Response(
        {
            "token": token.key,
            "user": user_serializer.data,
            "message": "Login successful."
        },
        status=status.HTTP_200_OK
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


def _is_fraud_rule_active(rule_type: str) -> bool:
    """Check if a Fraud Check rule is active in claim_rule_master."""
    return ClaimRuleMaster.objects.filter(
        rule_type__iexact=rule_type,
        rule_group__iexact="Fraud Check",
        is_active=True,
    ).exists()


def _get_fraud_rule_description(rule_type: str) -> str:
    """Return rule_description from claim_rule_master for Fraud Check rules, else rule_type."""
    rule = ClaimRuleMaster.objects.filter(
        rule_type__iexact=rule_type,
        rule_group__iexact="Fraud Check",
        is_active=True,
    ).first()
    return (rule.rule_description or rule_type).strip() if rule else rule_type


def fraud_check(
    history: dict, incident: dict, policy: dict, vehicle: Optional[dict] = None
) -> Tuple[str, str]:
    """
    Fraud check using claim_rule_master (Fraud Check rules).
    Returns (fraud_band, reason).
    """
    vehicle = vehicle or {}

    # 1) Early Claim - policy_start_date, date_time_of_loss
    if _is_fraud_rule_active("Early Claim"):
        early_window_days = _get_early_claim_window_days()
        start_date = parse_date(policy.get("policy_start_date"))
        loss_dt = parse_datetime(incident.get("date_time_of_loss"))
        if start_date and loss_dt:
            days_diff = (loss_dt.date() - start_date).days
            if days_diff < 0 or days_diff < early_window_days:
                return "High", _get_fraud_rule_description("Early Claim")

    # 2) Data missing - incident_description empty
    if _is_fraud_rule_active("Data missing"):
        if not (incident.get("loss_description") or "").strip():
            return "High", _get_fraud_rule_description("Data missing")

    # 3) Vehicle Year Invalid - vehicle_year > current year
    if _is_fraud_rule_active("Vehicle Year Invalid"):
        vehicle_year = vehicle.get("year")
        if vehicle_year is not None:
            try:
                year_val = int(vehicle_year)
                if year_val > date.today().year:
                    return "High", _get_fraud_rule_description("Vehicle Year Invalid")
            except (TypeError, ValueError):
                pass

    return "Low", ""


def _has_damage_photos(complaint_id: Optional[str] = None, documents: Optional[dict] = None) -> bool:
    """
    Check if damage photos exist with valid photo_path. Uses fnol_damage_photos.photo_path
    when complaint_id given - requires non-null, non-empty photo_path.
    """
    if complaint_id:
        return FnolDamagePhoto.objects.filter(
            complaint_id=complaint_id
        ).exclude(Q(photo_path__isnull=True) | Q(photo_path="")).exists()
    docs = documents or {}
    if docs.get("photos_uploaded"):
        return True
    photos = docs.get("photos")
    if isinstance(photos, list) and len(photos) > 0:
        return True
    return False


def _get_fraud_evaluation_rules(
    incident: dict, policy: dict, vehicle: dict, documents: dict,
    complaint_id: Optional[str] = None,
) -> list[dict]:
    """
    Evaluate each active Fraud Check rule and return pass/fail.
    Returns list of {rule_type, rule_description, passed}.
    """
    vehicle = vehicle or {}
    documents = documents or {}
    results = []

    # Early Claim
    if _is_fraud_rule_active("Early Claim"):
        desc = _get_fraud_rule_description("Early Claim")
        early_window_days = _get_early_claim_window_days()
        start_date = parse_date(policy.get("policy_start_date"))
        loss_dt = parse_datetime(incident.get("date_time_of_loss"))
        passed = True
        if start_date and loss_dt:
            days_diff = (loss_dt.date() - start_date).days
            if days_diff < 0 or days_diff < early_window_days:
                passed = False
        results.append({"rule_type": "Early Claim", "rule_description": desc, "passed": passed})

    # Data missing
    if _is_fraud_rule_active("Data missing"):
        desc = _get_fraud_rule_description("Data missing")
        passed = bool((incident.get("loss_description") or "").strip())
        results.append({"rule_type": "Data missing", "rule_description": desc, "passed": passed})

    # Vehicle Year Invalid
    if _is_fraud_rule_active("Vehicle Year Invalid"):
        desc = _get_fraud_rule_description("Vehicle Year Invalid")
        vehicle_year = vehicle.get("year")
        passed = True
        if vehicle_year is not None:
            try:
                year_val = int(vehicle_year)
                if year_val > date.today().year:
                    passed = False
            except (TypeError, ValueError):
                pass
        results.append({"rule_type": "Vehicle Year Invalid", "rule_description": desc, "passed": passed})

    # Missing Damage Photos - check fnol_damage_photos when complaint_id given, else documents
    if _is_fraud_rule_active("Missing Damage Photos"):
        desc = _get_fraud_rule_description("Missing Damage Photos")
        passed = _has_damage_photos(complaint_id=complaint_id, documents=documents)
        results.append({"rule_type": "Missing Damage Photos", "rule_description": desc, "passed": passed})

    return results


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


def _fraud_band_to_numeric(band: str) -> float:
    """Convert fraud band (Low/Medium/High) to numeric score."""
    band_lower = (band or "").strip().lower()
    if band_lower == "low":
        return 10.0
    if band_lower == "medium":
        return 50.0
    if band_lower == "high":
        return 90.0
    return 0.0


def _get_claim_status_for_result(result: dict) -> ClaimStatus | None:
    """
    Map run_fraud_detection result to claim_status table.
    Fraud detection does NOT set closed statuses. Based on rule validation only:
    - Rules passed (all fraud rules pass) -> Pending Damage Detection
    - Rules failed (any fraud rule fails or Reject) -> Fraudulent
    claim_status: 3=Fraudulent, 4=Pending Damage Detection
    """
    decision = (result.get("decision") or "").strip()
    fraud_rule_results = result.get("fraud_rule_results") or []

    # Reject (policy inactive, high fraud) -> Fraudulent
    if decision == "Reject":
        return ClaimStatus.objects.filter(status_name__iexact="Fraudulent").first()

    # Any fraud rule failed -> Fraudulent
    for rule in fraud_rule_results:
        if rule.get("passed") is False:
            return ClaimStatus.objects.filter(status_name__iexact="Fraudulent").first()

    # All rules passed -> Pending Damage Detection (never closed)
    return ClaimStatus.objects.filter(
        status_name__iexact="Pending Damage Detection"
    ).first()


def _run_process_claim_logic(data: dict) -> dict:
    """
    Run the process_claim validation logic. Returns a dict with evaluation results.
    May return early with decision/reason on failure paths.
    """
    policy = data.get("policy") or {}
    incident = data.get("incident") or {}
    history = data.get("history") or {}
    documents = data.get("documents") or {}
    vehicle = data.get("vehicle") or {}
    complaint_id = data.get("claim_id", "")

    estimated_amount = incident.get("estimated_amount") or 0
    fraud_rule_results = _get_fraud_evaluation_rules(
        incident, policy, vehicle, documents, complaint_id=complaint_id or None
    )

    if not product_rule(policy):
        return {
            "claim_id": complaint_id,
            "decision": "Reject",
            "claim_status": "Rejected",
            "reason": "Policy inactive",
            "fraud_rule_results": fraud_rule_results,
            "damage_confidence": 0,
            "fraud_score": "Low",
            "evaluation_score": 0,
            "threshold": 0.75,
            "claim_type": None,
            "estimated_amount": estimated_amount,
        }

    fraud_score, fraud_reason = fraud_check(history, incident, policy, vehicle)
    if fraud_score == "High":
        return {
            "claim_id": complaint_id,
            "decision": "Reject",
            "claim_status": "Rejected",
            "reason": fraud_reason or "High fraud risk",
            "fraud_rule_results": fraud_rule_results,
            "damage_confidence": 0,
            "fraud_score": fraud_score,
            "evaluation_score": 0,
            "threshold": 0.75,
            "claim_type": None,
            "estimated_amount": estimated_amount,
        }

    if _is_fraud_rule_active("Missing Damage Photos") and not _has_damage_photos(
        complaint_id=complaint_id or None, documents=documents
    ):
        return {
            "claim_id": complaint_id,
            "decision": "Manual Review",
            "claim_status": "Open",
            "reason": _get_fraud_rule_description("Missing Damage Photos"),
            "fraud_rule_results": fraud_rule_results,
            "damage_confidence": damage_detection(incident),
            "fraud_score": fraud_score,
            "evaluation_score": 0,
            "threshold": 0.75,
            "claim_type": None,
            "estimated_amount": estimated_amount,
        }

    confidence = damage_detection(incident)
    score = evaluate_score(confidence, incident.get("estimated_amount") or 0)
    threshold, claim_type_name = _get_claim_type_threshold(incident)

    if score >= threshold:
        decision = "Auto Approve"
        status = "Closed"
    else:
        decision = "Manual Review"
        status = "Open"

    return {
        "claim_id": complaint_id,
        "damage_confidence": confidence,
        "fraud_score": fraud_score,
        "evaluation_score": score,
        "threshold": threshold,
        "claim_type": claim_type_name,
        "decision": decision,
        "claim_status": status,
        "estimated_amount": estimated_amount,
        "fraud_rule_results": fraud_rule_results,
    }


def _fnol_claim_to_raw_response(claim: FnolClaim) -> dict:
    """Build FnolPayload-like dict from FnolClaim for process_claim compatibility."""
    photos = [p.photo_path for p in claim.damage_photos.all() if p.photo_path]
    incident_dt = claim.incident_date_time.isoformat() if claim.incident_date_time else None
    return {
        "claim_id": claim.complaint_id,
        "policy": {
            "policy_number": claim.policy_number or "",
            "policy_status": claim.policy_status or "",
            "coverage_type": claim.coverage_type or "",
            "policy_start_date": claim.policy_start_date.isoformat() if claim.policy_start_date else "",
            "policy_end_date": claim.policy_end_date.isoformat() if claim.policy_end_date else "",
        },
        "vehicle": {
            "registration_number": claim.vehicle_registration_number or "",
            "make": claim.vehicle_make or "",
            "model": claim.vehicle_model or "",
            "year": claim.vehicle_year or 0,
        },
        "incident": {
            "date_time_of_loss": incident_dt or "",
            "loss_description": claim.incident_description or "",
            "claim_type": claim.incident_type or "",
            "estimated_amount": 0,  # fnol_claims schema doesn't include this; can be extended
        },
        "claimant": {"driver_name": claim.policy_holder_name or ""},
        "documents": {
            "rc_copy_uploaded": False,
            "dl_copy_uploaded": False,
            "photos_uploaded": len(photos) > 0,
            "fir_uploaded": bool(claim.fir_document_copy),
            "photos": photos,
        },
        "history": {"previous_claims_last_12_months": 0},
    }


def _fnol_claim_to_response(claim: FnolClaim) -> dict:
    """Convert FnolClaim to API response format. Includes latest evaluation amounts when available."""
    latest_eval = (
        ClaimEvaluationResponse.objects.filter(complaint_id=claim.complaint_id)
        .order_by("-created_date")
        .first()
    )
    estimated_amount = None
    claim_amount = None
    llm_damages = None
    llm_severity = None
    if latest_eval:
        estimated_amount = float(latest_eval.estimated_amount or 0)
        claim_amount = float(latest_eval.claim_amount or 0)
        llm_damages = latest_eval.llm_damages  # JSON string
        llm_severity = latest_eval.llm_severity

    BASE_URL = "media/vehicle_damage/"

    photo_urls = [
        f"{BASE_URL}{path}"
        for path in claim.damage_photos.values_list("photo_path", flat=True)
    ]

    return {
        "id": claim.complaint_id,
        "complaint_id": claim.complaint_id,
        "coverage_type": claim.coverage_type,
        "policy_number": claim.policy_number,
        "policy_status": claim.policy_status,
        "policy_start_date": claim.policy_start_date.isoformat() if claim.policy_start_date else None,
        "policy_end_date": claim.policy_end_date.isoformat() if claim.policy_end_date else None,
        "policy_holder_name": claim.policy_holder_name,
        "vehicle_make": claim.vehicle_make,
        "vehicle_year": claim.vehicle_year,
        "vehicle_model": claim.vehicle_model,
        "vehicle_registration_number": claim.vehicle_registration_number,
        "incident_type": claim.incident_type,
        "incident_description": claim.incident_description,
        "incident_date_time": claim.incident_date_time.isoformat() if claim.incident_date_time else None,
        "fir_document_copy": claim.fir_document_copy,
        "insurance_document_copy": claim.insurance_document_copy,
        "damage_photos": photo_urls,
        "raw_response": _fnol_claim_to_raw_response(claim),
        "status": claim.claim_status.status_name if claim.claim_status else "Open",
        "estimated_amount": estimated_amount,
        "claim_amount": claim_amount,
        "llm_damages": llm_damages,
        "llm_severity": llm_severity,
        "created_date": claim.created_date.isoformat() if getattr(claim, "created_date", None) else None,
        "created_by": getattr(claim, "created_by", None),
        "updated_date": claim.updated_date.isoformat() if getattr(claim, "updated_date", None) else None,
        "updated_by": getattr(claim, "updated_by", None),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_fraud_claims(request):
    """
    Return claims that have been through fraud detection (exist in claim_evaluation_response).
    Used by Fraud Detection page - shows Fraudulent, Under Review, and Cleared claims dynamically.
    """
    # Claims that have been through fraud detection (exist in claim_evaluation_response)
    fnol_claims = (
        FnolClaim.objects.filter(
            complaint_id__in=ClaimEvaluationResponse.objects.values_list(
                "complaint_id", flat=True
            ).distinct()
        )
        .select_related("claim_status")
        .order_by("-incident_date_time", "-complaint_id")
    )
    results = []
    for claim in fnol_claims:
        eval_row = (
            ClaimEvaluationResponse.objects.filter(complaint_id=claim.complaint_id)
            .order_by("-created_date")
            .first()
        )
        if not eval_row:
            continue
        status_name = (claim.claim_status.status_name if claim.claim_status else "") or ""
        status_lower = status_name.lower()
        if "fraud" in status_lower or status_lower == "fraudulent":
            ui_status = "confirmed"
        elif status_lower in ("auto approved", "closed"):
            ui_status = "cleared"
        else:
            ui_status = "under_review"

        decision = (eval_row.decision or "").lower()
        if decision == "reject":
            risk_score = 90
        elif decision == "manual review":
            risk_score = 65
        else:
            risk_score = 25

        reason = eval_row.reason or eval_row.decision or "—"

        results.append({
            "complaint_id": claim.complaint_id,
            "claimNumber": claim.complaint_id,
            "customer": claim.policy_holder_name or "—",
            "riskScore": risk_score,
            "reason": reason,
            "amount": float(eval_row.estimated_amount or eval_row.claim_amount or 0),
            "status": ui_status,
            "detectedAt": eval_row.created_date.isoformat() if eval_row.created_date else None,
            "indicators": [reason] if reason and reason != "—" else [],
        })
    return Response(results)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_fnol(request):
    """
    Return a list of FNOL claims.
    """
    qs = FnolClaim.objects.all().order_by("-incident_date_time", "-complaint_id")
    data = [_fnol_claim_to_response(obj) for obj in qs]
    return Response(data)


@api_view(['GET'])
def get_fnol(request, pk: str):
    """
    Return a single FNOL claim by complaint_id.
    """
    obj = get_object_or_404(FnolClaim, complaint_id=pk)
    data = _fnol_claim_to_response(obj)
    return Response(data)


@api_view(['GET'])
def get_claim_evaluation(request, complaint_id: str):
    """
    Return the latest claim evaluation response for a complaint_id.
    Includes damage_confidence, estimated_amount, claim_amount, decision, claim_status,
    reason, llm_damages, llm_severity (from damage assessment).
    """
    latest = (
        ClaimEvaluationResponse.objects.filter(complaint_id=complaint_id)
        .order_by("-created_date")
        .first()
    )
    if not latest:
        return Response(
            {"error": f"No evaluation found for complaint_id: {complaint_id}"},
            status=status.HTTP_404_NOT_FOUND,
        )
    damages = None
    if latest.llm_damages:
        try:
            damages = json.loads(latest.llm_damages)
        except (json.JSONDecodeError, TypeError):
            damages = None
    return Response({
        "complaint_id": latest.complaint_id,
        "damage_confidence": float(latest.damage_confidence or 0),
        "estimated_amount": float(latest.estimated_amount or 0),
        "claim_amount": float(latest.claim_amount or 0),
        "threshold_value": latest.threshold_value,
        "claim_type": latest.claim_type,
        "decision": latest.decision,
        "claim_status": latest.claim_status,
        "reason": latest.reason,
        "llm_damages": damages,
        "llm_severity": latest.llm_severity,
        "created_date": latest.created_date.isoformat() if latest.created_date else None,
        "updated_date": latest.updated_date.isoformat() if latest.updated_date else None,
    })


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def claim_type_master_collection(request):
    if request.method == "GET":
        if not (has_permission(request.user, "claim_config.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - claim_config.view required"}, status=status.HTTP_403_FORBIDDEN)
        qs = ClaimTypeMaster.objects.all().order_by("claim_type_id")
        return Response(ClaimTypeMasterSerializer(qs, many=True).data)

    if not (has_permission(request.user, "claim_config.update") or is_admin(request.user)):
        return Response({"error": "Forbidden - claim_config.update required"}, status=status.HTTP_403_FORBIDDEN)
    serializer = ClaimTypeMasterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    created_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
    obj = serializer.save(created_by=created_by)
    return Response(ClaimTypeMasterSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def claim_type_master_detail(request, pk: int):
    obj = get_object_or_404(ClaimTypeMaster, pk=pk)

    if request.method == "GET":
        if not (has_permission(request.user, "claim_config.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - claim_config.view required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(ClaimTypeMasterSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        if not (has_permission(request.user, "claim_config.update") or is_admin(request.user)):
            return Response({"error": "Forbidden - claim_config.update required"}, status=status.HTTP_403_FORBIDDEN)
        serializer = ClaimTypeMasterSerializer(
            obj, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        updated_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
        obj = serializer.save(created_by=obj.created_by or updated_by)
        # Note: model doesn't have updated_by; keeping created_by stable
        return Response(ClaimTypeMasterSerializer(obj).data)

    if not (has_permission(request.user, "claim_config.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - claim_config.delete required"}, status=status.HTTP_403_FORBIDDEN)
    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def claim_rule_master_collection(request):
    if request.method == "GET":
        if not (has_permission(request.user, "fraud_rules.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - fraud_rules.view required"}, status=status.HTTP_403_FORBIDDEN)
        qs = ClaimRuleMaster.objects.all().order_by("rule_id")
        return Response(ClaimRuleMasterSerializer(qs, many=True).data)

    if not (has_permission(request.user, "fraud_rules.update") or is_admin(request.user)):
        return Response({"error": "Forbidden - fraud_rules.update required"}, status=status.HTTP_403_FORBIDDEN)
    serializer = ClaimRuleMasterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    created_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
    obj = serializer.save(created_by=created_by)
    return Response(ClaimRuleMasterSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def claim_rule_master_detail(request, pk: int):
    obj = get_object_or_404(ClaimRuleMaster, pk=pk)

    if request.method == "GET":
        if not (has_permission(request.user, "fraud_rules.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - fraud_rules.view required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(ClaimRuleMasterSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        if not (has_permission(request.user, "fraud_rules.update") or is_admin(request.user)):
            return Response({"error": "Forbidden - fraud_rules.update required"}, status=status.HTTP_403_FORBIDDEN)
        serializer = ClaimRuleMasterSerializer(
            obj, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        updated_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
        obj = serializer.save(created_by=obj.created_by or updated_by)
        return Response(ClaimRuleMasterSerializer(obj).data)

    if not (has_permission(request.user, "fraud_rules.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - fraud_rules.delete required"}, status=status.HTTP_403_FORBIDDEN)
    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def damage_code_master_collection(request):
    if request.method == "GET":
        if not (has_permission(request.user, "damage_config.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - damage_config.view required"}, status=status.HTTP_403_FORBIDDEN)
        qs = DamageCodeMaster.objects.all().order_by("damage_id")
        return Response(DamageCodeMasterSerializer(qs, many=True).data)

    if not (has_permission(request.user, "damage_config.update") or is_admin(request.user)):
        return Response({"error": "Forbidden - damage_config.update required"}, status=status.HTTP_403_FORBIDDEN)
    serializer = DamageCodeMasterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    created_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
    obj = serializer.save(created_by=created_by)
    return Response(DamageCodeMasterSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def damage_code_master_detail(request, pk: int):
    obj = get_object_or_404(DamageCodeMaster, pk=pk)

    if request.method == "GET":
        if not (has_permission(request.user, "damage_config.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - damage_config.view required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(DamageCodeMasterSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        if not (has_permission(request.user, "damage_config.update") or is_admin(request.user)):
            return Response({"error": "Forbidden - damage_config.update required"}, status=status.HTTP_403_FORBIDDEN)
        serializer = DamageCodeMasterSerializer(
            obj, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        updated_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
        obj = serializer.save(created_by=obj.created_by or updated_by)
        return Response(DamageCodeMasterSerializer(obj).data)

    if not (has_permission(request.user, "damage_config.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - damage_config.delete required"}, status=status.HTTP_403_FORBIDDEN)
    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def pricing_config_collection(request):
    if request.method == "GET":
        if not (has_permission(request.user, "price_config.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - price_config.view required"}, status=status.HTTP_403_FORBIDDEN)
        qs = PricingConfig.objects.all().order_by("config_key")
        return Response(PricingConfigSerializer(qs, many=True).data)

    if not (has_permission(request.user, "price_config.update") or is_admin(request.user)):
        return Response({"error": "Forbidden - price_config.update required"}, status=status.HTTP_403_FORBIDDEN)
    serializer = PricingConfigSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    created_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
    obj = serializer.save(created_by=created_by, updated_by=created_by)
    return Response(PricingConfigSerializer(obj).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def pricing_config_detail(request, pk: int):
    obj = get_object_or_404(PricingConfig, pk=pk)

    if request.method == "GET":
        if not (has_permission(request.user, "price_config.view") or is_admin(request.user)):
            return Response({"error": "Forbidden - price_config.view required"}, status=status.HTTP_403_FORBIDDEN)
        return Response(PricingConfigSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        if not (has_permission(request.user, "price_config.update") or is_admin(request.user)):
            return Response({"error": "Forbidden - price_config.update required"}, status=status.HTTP_403_FORBIDDEN)
        serializer = PricingConfigSerializer(
            obj, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        updated_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
        obj = serializer.save(updated_by=updated_by)
        return Response(PricingConfigSerializer(obj).data)

    if not (has_permission(request.user, "price_config.delete") or is_admin(request.user)):
        return Response({"error": "Forbidden - price_config.delete required"}, status=status.HTTP_403_FORBIDDEN)
    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


def _fnol_payload_to_claim_data(data: dict) -> dict:
    """Map FnolPayload (raw_response format) to FnolClaim fields."""
    policy = data.get("policy") or {}
    vehicle = data.get("vehicle") or {}
    incident = data.get("incident") or {}
    history = data.get("history") or {}
    claimant = data.get("claimant") or {}
    documents = data.get("documents") or {}
    complaint_id = data.get("claim_id") or ""
    incident_dt = incident.get("date_time_of_loss")
    if incident_dt:
        try:
            incident_dt = parse_datetime(str(incident_dt))
        except (TypeError, ValueError):
            incident_dt = None
    policy_start = parse_date(policy.get("policy_start_date")) if policy.get("policy_start_date") else None
    policy_end = parse_date(policy.get("policy_end_date")) if policy.get("policy_end_date") else None
    return {
        "complaint_id": complaint_id,
        "coverage_type": policy.get("coverage_type"),
        "policy_number": policy.get("policy_number"),
        "policy_status": policy.get("policy_status"),
        "policy_start_date": policy_start,
        "policy_end_date": policy_end,
        "policy_holder_name": claimant.get("driver_name"),
        "vehicle_make": vehicle.get("make"),
        "vehicle_year": vehicle.get("year"),
        "vehicle_model": vehicle.get("model"),
        "vehicle_registration_number": vehicle.get("registration_number"),
        "incident_type": incident.get("claim_type"),
        "incident_description": incident.get("loss_description"),
        "incident_date_time": incident_dt,
        "fir_document_copy": documents.get("fir_path") if isinstance(documents.get("fir_path"), str) else None,
        "insurance_document_copy": documents.get("insurance_path") if isinstance(documents.get("insurance_path"), str) else None,
    }


@api_view(['POST'])
def save_fnol(request):
    """
    Save FNOL to fnol_claims and fnol_damage_photos.
    Accepts FnolPayload format and maps to fnol_claims schema.
    """
    data = request.data.get("fnol")

    if data is None:
        return Response(
            {"detail": "Field 'fnol' is required in request body."},
            status=400,
        )

    complaint_id = data.get("claim_id", "").strip()
    if not complaint_id:
        return Response(
            {"detail": "claim_id is required."},
            status=400,
        )

    claim_data = _fnol_payload_to_claim_data(data)
    record, _ = FnolClaim.objects.update_or_create(
        complaint_id=complaint_id,
        defaults=claim_data,
    )

    # Handle damage photos
    documents = data.get("documents") or {}
    photo_paths = documents.get("photos")
    if isinstance(photo_paths, list):
        record.damage_photos.all().delete()
        for path in photo_paths:
            if isinstance(path, str) and path.strip():
                FnolDamagePhoto.objects.create(complaint=record, photo_path=path.strip())

    return Response(
        {
            "message": "FNOL saved successfully",
            "id": record.complaint_id,
        },
        status=201,
    )


@api_view(['POST'])
def process_claim(request):
    """
    Run claim validation (product rule, fraud check, damage detection, etc.).
    Does not persist to claim_evaluation_response.
    """
    data = request.data.get("fnol")
    if not data:
        return Response(
            {"detail": "Field 'fnol' is required in request body."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    result = _run_process_claim_logic(data)
    return Response(result)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def run_fraud_detection(request, complaint_id: str):
    """
    Run process_claim validation for the given complaint_id and save the
    response to claim_evaluation_response. Triggered by Fraud Detection button.
    """
    fnol_claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    raw_response = _fnol_claim_to_raw_response(fnol_claim)

    result = _run_process_claim_logic(raw_response)

    user_id = None
    if request.user and request.user.pk:
        user_id = request.user.pk

    threshold_val = result.get("threshold")
    threshold_int = int(round((threshold_val or 0) * 100)) if threshold_val is not None else 0

    ClaimEvaluationResponse.objects.create(
        complaint_id=complaint_id,
        damage_confidence=result.get("damage_confidence") or 0,
        estimated_amount=result.get("estimated_amount") or 0,
        claim_amount=result.get("claim_amount") or result.get("estimated_amount") or 0,
        threshold_value=threshold_int,
        claim_type=(result.get("claim_type") or "")[:20],
        decision=(result.get("decision") or "")[:20],
        claim_status=(result.get("claim_status") or "")[:20],
        reason=result.get("reason"),
        created_by=user_id,
        updated_by=user_id,
    )

    # Update fnol_claims.claim_status based on evaluation result
    new_status = _get_claim_status_for_result(result)
    if new_status:
        fnol_claim.claim_status = new_status
        fnol_claim.save(update_fields=["claim_status"])

    return Response(result, status=status.HTTP_200_OK)

