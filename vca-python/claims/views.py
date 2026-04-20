import io
import json
import logging
import os
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from functools import partial
from html import escape as html_escape
from typing import Optional, Tuple

from claim_automation.vca_config import cfg as _vca_cfg

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User, Group
from django.db import DatabaseError, connection, transaction
from django.db.models import Count, Max, Prefetch, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date, parse_datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import (
    ClaimRuleMaster,
    ClaimCardInsight,
    ClaimTypeMaster,
    ClaimStatus,
    DamageCodeMaster,
    ClaimEvaluationResponse,
    ClaimDuplicateCandidate,
    ClaimPhase1Valuation,
    ClaimValuationExplanation,
    FnolClaim,
    FnolDamagePhoto,
    Claim,
    DamagePartAssessment,
    DigitizationDocument,
    ImageFraudResult,
    InvoiceCoreDetails,
    PricingConfig,
)
from .workflow_display import claim_status_implies_recommendation_terminal
from .workflow_state import (
    build_claim_workflow_snapshot,
    build_claim_workflow_snapshot_for_list,
    bulk_damage_assessment_persistence_state,
    compute_claim_workflow_state,
    current_lifecycle_started_at,
    derive_workflow_state_from_context,
    effective_claim_status,
    valuation_row_has_meaningful_output,
)
from .decisioning import sync_claim_evaluation_decision_state
from .reviewer_safe import sanitize_reviewer_llm_notes

from .phase1_runtime import (
    get_claim_amount_settings,
    get_claim_market_context,
    get_claim_type_settings,
    get_major_claim_threshold,
    get_pricing_config_decimal,
)
from .video_claim_flow import build_claim_video_overview
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

logger = logging.getLogger(__name__)


def _run_parallel(callables: list, *, max_workers: int = 4) -> list:
    """
    Execute a list of zero-argument callables concurrently in separate threads.
    Each thread gets its own Django DB connection (thread-local).  Connections are
    closed on the worker thread after each task so the pool does not leak them.

    Returns results in the same order as *callables*.  Re-raises the first
    exception encountered.
    """
    from django.db import close_old_connections

    if len(callables) < 2 or connection.in_atomic_block or not connection.get_autocommit():
        return [fn() for fn in callables]

    def _wrap(fn):
        close_old_connections()
        try:
            return fn()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=min(max_workers, len(callables))) as pool:
        futures = [pool.submit(_wrap, fn) for fn in callables]
        return [f.result() for f in futures]


def _api_error_response(
    request,
    *,
    message: str,
    developer_message: str,
    error_code: str,
    status_code: int,
) -> Response:
    payload = {
        "error": error_code,
        "message": message,
        "developer_message": developer_message,
    }
    request_id = getattr(request, "request_id", None)
    if request_id:
        payload["request_id"] = request_id
    return Response(payload, status=status_code)


def _safe_counted_delete(queryset, label: str) -> int:
    """
    Best-effort delete helper for optional/legacy tables.
    Returns number of deleted rows, or 0 if the table is unavailable.
    """
    try:
        table_name = queryset.model._meta.db_table
        if table_name not in connection.introspection.table_names():
            return 0
        with transaction.atomic():
            deleted, _ = queryset.delete()
        return int(deleted)
    except DatabaseError as exc:
        logger.warning("%s delete skipped due to database error: %s", label, exc)
        return 0


def _delete_fnol_claim_record(claim: FnolClaim) -> dict[str, int]:
    """
    Remove one FNOL claim and all persisted rows that should disappear with it.
    This explicitly cleans complaint-id keyed tables and reverse duplicate links
    that do not cascade automatically from FnolClaim.
    """
    complaint_id = claim.complaint_id
    deleted_counts = {
        # Defensive deletes for optional/legacy tables (safe when missing).
        "legacy_claim_rows": _safe_counted_delete(Claim.objects.filter(fnol=claim), "legacy Claim rows"),
        # Explicit deletes for common persisted tables that should not survive FNOL deletion.
        "damage_photo_rows": _safe_counted_delete(
            FnolDamagePhoto.objects.filter(complaint_id=complaint_id),
            "fnol damage photo rows",
        ),
        "image_fraud_rows": _safe_counted_delete(
            ImageFraudResult.objects.filter(complaint=claim),
            "image fraud result rows",
        ),
        "duplicate_candidate_rows": _safe_counted_delete(
            ClaimDuplicateCandidate.objects.filter(complaint=claim),
            "duplicate candidate rows",
        ),
        "damage_part_rows": _safe_counted_delete(
            DamagePartAssessment.objects.filter(complaint=claim),
            "damage part assessment rows",
        ),
        "phase1_valuation_rows": _safe_counted_delete(
            ClaimPhase1Valuation.objects.filter(complaint=claim),
            "phase1 valuation rows",
        ),
        "valuation_explanation_rows": _safe_counted_delete(
            ClaimValuationExplanation.objects.filter(complaint=claim),
            "valuation explanation rows",
        ),
        "card_insight_rows": _safe_counted_delete(
            ClaimCardInsight.objects.filter(claim=claim),
            "claim card insight rows",
        ),
        "evaluation_rows": _safe_counted_delete(
            ClaimEvaluationResponse.objects.filter(complaint_id=complaint_id),
            "claim evaluation rows",
        ),
        "reverse_duplicate_rows": _safe_counted_delete(
            ClaimDuplicateCandidate.objects.filter(other_complaint_id=complaint_id).exclude(
                complaint__complaint_id=complaint_id
            ),
            "reverse duplicate rows",
        ),
        "digitization_document_rows": _safe_counted_delete(
            DigitizationDocument.objects.filter(complaint_id=complaint_id),
            "digitization document rows",
        ),
        "invoice_rows": _safe_counted_delete(
            InvoiceCoreDetails.objects.filter(claim_number=complaint_id),
            "invoice rows",
        ),
    }

    # Delete the primary fnol_claims row using SQL to avoid Django ORM cascade collection.
    # Some deployments do not have the legacy `claim` table, but the Django model still exists;
    # `FnolClaim.delete()` would attempt to query it during cascade and crash (e.g., MySQL 1146).
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM fnol_claims WHERE complaint_id = %s",
                [complaint_id],
            )
            deleted_counts["cascade_rows"] = int(getattr(cursor, "rowcount", 0) or 0)

    # Verify the primary row is gone; if not, surface an error (better than a silent "success").
    if FnolClaim.objects.filter(complaint_id=complaint_id).exists():
        raise DatabaseError(f"fnol_claims row {complaint_id} still exists after delete()")
    return deleted_counts


def _clear_claim_processing_artifacts(claim: FnolClaim) -> dict[str, int]:
    """
    Reset claim-scoped processing artifacts back to a fresh FNOL state.

    This is intentionally narrower than deleting the FNOL row itself: it clears
    persisted Phase 1/decisioning outputs and reverse duplicate links that would
    otherwise leak stale results after a claim is re-fetched as fresh data.
    """
    complaint_id = claim.complaint_id
    return {
        "image_fraud_rows": _safe_counted_delete(
            ImageFraudResult.objects.filter(complaint=claim),
            "image fraud result rows",
        ),
        "duplicate_candidate_rows": _safe_counted_delete(
            ClaimDuplicateCandidate.objects.filter(complaint=claim),
            "duplicate candidate rows",
        ),
        "reverse_duplicate_rows": _safe_counted_delete(
            ClaimDuplicateCandidate.objects.filter(other_complaint_id=complaint_id).exclude(
                complaint__complaint_id=complaint_id
            ),
            "reverse duplicate rows",
        ),
        "damage_part_rows": _safe_counted_delete(
            DamagePartAssessment.objects.filter(complaint=claim),
            "damage part assessment rows",
        ),
        "phase1_valuation_rows": _safe_counted_delete(
            ClaimPhase1Valuation.objects.filter(complaint=claim),
            "phase1 valuation rows",
        ),
        "valuation_explanation_rows": _safe_counted_delete(
            ClaimValuationExplanation.objects.filter(complaint=claim),
            "valuation explanation rows",
        ),
        "card_insight_rows": _safe_counted_delete(
            ClaimCardInsight.objects.filter(claim=claim),
            "claim card insight rows",
        ),
        "evaluation_rows": _safe_counted_delete(
            ClaimEvaluationResponse.objects.filter(complaint_id=complaint_id),
            "claim evaluation rows",
        ),
    }


def _invalidate_phase1_damage_assessment_state(claim: FnolClaim) -> dict[str, int]:
    """
    Clear persisted downstream DA artifacts when BRV is re-run.

    Business-rule validation must not inherit or surface damage-assessment
    output from an older run as if the user had just completed DA again.
    """
    return {
        "damage_rows": _safe_counted_delete(
            DamagePartAssessment.objects.filter(complaint=claim),
            "damage assessment rows",
        ),
        "valuation_rows": _safe_counted_delete(
            ClaimPhase1Valuation.objects.filter(complaint=claim),
            "phase1 valuation rows",
        ),
        "valuation_explanation_rows": _safe_counted_delete(
            ClaimValuationExplanation.objects.filter(complaint=claim),
            "valuation explanation rows",
        ),
        "card_insight_rows": _safe_counted_delete(
            ClaimCardInsight.objects.filter(claim=claim),
            "damage assessment card insight rows",
        ),
    }


def _is_admin_user(user) -> bool:
    """True if user can perform admin actions: Django staff or in 'Admin' group."""
    if user.is_staff:
        return True
    return user.groups.filter(name__iexact="admin").exists()


def estimate_claim_amount_from_config(
    damages: list, severity: str, base_estimated_amount: float = 0
) -> float:
    """
    Estimate claim amount from PricingConfig based on LLM damages and severity.
    Formula: (base_amount + damage_count * rate_per_damage) * severity_multiplier
    Config keys: claim_base_amount, claim_rate_per_damage,
                 severity_multiplier_minor, severity_multiplier_moderate, severity_multiplier_severe
    """
    settings = get_claim_amount_settings()
    base = settings["base_amount"]
    rate_per_damage = settings["rate_per_damage"]
    mult_minor = settings["multiplier_minor"]
    mult_moderate = settings["multiplier_moderate"]
    mult_severe = settings["multiplier_severe"]

    severity_lower = (severity or "").strip().lower()
    if severity_lower == "minor":
        mult = mult_minor
    elif severity_lower == "moderate":
        mult = mult_moderate
    elif severity_lower == "severe":
        mult = mult_severe
    else:
        mult = mult_moderate  # default

    def _is_valid_damage(d):
        if not d:
            return False
        if isinstance(d, dict):
            return (d.get("damage_type") or "").strip().lower() not in ("", "none")
        return str(d).strip().lower() not in ("", "none")

    damage_count = len([d for d in damages if _is_valid_damage(d)])
    if damage_count == 0:
        damage_count = 1  # at least 1 for "no damage" case
    amount = (base + damage_count * rate_per_damage) * mult
    if base_estimated_amount and base_estimated_amount > 0:
        amount = max(amount, float(base_estimated_amount))
    return round(amount, 2)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_user(request):
    if not _is_admin_user(request.user):
        return Response(
            {"error": "Forbidden - Admin role or staff required to create users"},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = UserCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

    user = serializer.save()
    return Response({"user": UserSerializer(user).data, "message": "User created."}, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_users(request):
    # Any authenticated user can view all users
    users = User.objects.all()
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
            'role': role,
            'status': status_text,
            'claims_handled': claims_handled,
            'last_login': u.last_login,
        })

    return Response(payload, status=status.HTTP_200_OK)


@api_view(['PATCH', 'PUT'])
@permission_classes([IsAuthenticated])
def edit_user(request, pk):
    # Users can edit their own profile, staff can edit anyone
    user = get_object_or_404(User, pk=pk)
    
    if user.id != request.user.id and not _is_admin_user(request.user):
        return Response({"error": "Forbidden - can only edit your own profile"}, status=status.HTTP_403_FORBIDDEN)
    
    serializer = UserUpdateSerializer(user, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response({"error": serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    return Response({"user": UserSerializer(user).data, "message": "User updated."}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_role(request, pk):
    if not _is_admin_user(request.user):
        return Response({"error": "Forbidden - Admin role required"}, status=status.HTTP_403_FORBIDDEN)

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
    if not _is_admin_user(request.user):
        return Response({"error": "Forbidden - Admin role required"}, status=status.HTTP_403_FORBIDDEN)

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
    if not _is_admin_user(request.user):
        return Response({"error": "Forbidden - Admin role required"}, status=status.HTTP_403_FORBIDDEN)

    user = get_object_or_404(User, pk=pk)
    user.is_active = False
    user.save()
    return Response({"message": "User deactivated."}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def activate_user(request, pk):
    if not _is_admin_user(request.user):
        return Response({"error": "Forbidden - Admin role required"}, status=status.HTTP_403_FORBIDDEN)

    user = get_object_or_404(User, pk=pk)
    user.is_active = True
    user.save()
    return Response({"message": "User activated."}, status=status.HTTP_200_OK)


# soft_delete_user is identical to deactivate_user (both set is_active=False).
# The URL /users/<pk>/soft-delete/ is kept for backwards-compatibility and
# now delegates to the canonical deactivate_user implementation.
soft_delete_user = deactivate_user


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
        return _api_error_response(
            request,
            message="Invalid credentials provided.",
            developer_message=json.dumps(serializer.errors, default=str),
            error_code="bad_request",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    
    username = serializer.validated_data.get('username')
    password = serializer.validated_data.get('password')
    
    # Authenticate user
    user = authenticate(username=username, password=password)
    
    if user is None:
        return _api_error_response(
            request,
            message="Authentication failed.",
            developer_message="Invalid username or password.",
            error_code="unauthorized",
            status_code=status.HTTP_401_UNAUTHORIZED,
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
    active_rule = ClaimRuleMaster.objects.filter(
        rule_type__iexact="Policy Status", is_active=True
    ).first()
    if not active_rule:
        return True
    return (policy.get("policy_status") or "").strip().lower() == "active"


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


# Rule groups that participate in Business Rule Validation (e.g. Fraud Check + Business Rule)
_BUSINESS_RULE_VALIDATION_GROUPS = Q(rule_group__iexact="Fraud Check") | Q(rule_group__iexact="Business Rule")


def _is_fraud_rule_active(rule_type: str) -> bool:
    """Check if a Business Rule Validation rule is active in claim_rule_master (Fraud Check or Business Rule group)."""
    return ClaimRuleMaster.objects.filter(
        _BUSINESS_RULE_VALIDATION_GROUPS,
        rule_type__iexact=rule_type,
        is_active=True,
    ).exists()


def _get_fraud_rule_description(rule_type: str) -> str:
    """Return rule_description from claim_rule_master for Business Rule Validation rules, else rule_type."""
    rule = ClaimRuleMaster.objects.filter(
        _BUSINESS_RULE_VALIDATION_GROUPS,
        rule_type__iexact=rule_type,
        is_active=True,
    ).first()
    return (rule.rule_description or rule_type).strip() if rule else rule_type


def fraud_check(
    history: dict,
    incident: dict,
    policy: dict,
    vehicle: Optional[dict] = None,
    complaint_id: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Business rule validation using claim_rule_master (Fraud Check and Business Rule groups).
    Returns (fraud_band, reason).
    """
    vehicle = vehicle or {}

    # Policy Date Mismatch - use fnol_claims when complaint_id present
    if _is_fraud_rule_active("Policy Date Mismatch"):
        policy_start = None
        policy_end = None
        incident_dt = None
        created_dt = None
        if complaint_id:
            fnol = FnolClaim.objects.filter(complaint_id=complaint_id).first()
            if fnol:
                policy_start = fnol.policy_start_date
                policy_end = fnol.policy_end_date
                incident_dt = fnol.incident_date_time
                created_dt = getattr(fnol, "created_date", None)
        if policy_start is None:
            policy_start = policy.get("policy_start_date") or None
        if policy_end is None:
            policy_end = policy.get("policy_end_date") or None
        if incident_dt is None:
            incident_dt = incident.get("date_time_of_loss") or None
        if not _policy_data_mismatch_passed(
            policy_start, policy_end, incident_dt, created_dt
        ):
            return "High", _get_fraud_rule_description("Policy Date Mismatch")

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

    # 4) Liability Admission, Dashcam CCTV Evidence, Injury Indicator, No Third-Party Escalation (risk when TRUE)
    if _is_fraud_rule_active("Liability Admission") and incident.get("liability_admission"):
        return "High", _get_fraud_rule_description("Liability Admission")
    if _is_fraud_rule_active("Dashcam CCTV Evidence") and incident.get("dashcam_cctv_evidence"):
        return "High", _get_fraud_rule_description("Dashcam CCTV Evidence")
    if _is_fraud_rule_active("Injury Indicator") and incident.get("injury_indicator"):
        return "High", _get_fraud_rule_description("Injury Indicator")
    if _is_fraud_rule_active("No Third-Party Escalation") and incident.get("commercial_vehicle"):
        return "High", _get_fraud_rule_description("No Third-Party Escalation")

    return "Low", ""


def _to_date(value):
    """Normalize value to date for comparison. Returns None if missing or unparseable."""
    if value is None:
        return None
    if hasattr(value, "date"):
        return value.date() if getattr(value, "time", None) else value
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        return None
    d = parse_date(s)
    if d is not None:
        return d
    dt = parse_datetime(s)
    return dt.date() if dt else None


def _policy_data_mismatch_passed(
    policy_start_date,
    policy_end_date,
    incident_dt,
    created_dt,
) -> bool:
    """
    Policy Date Mismatch rule (fnol_claims):
    1. incident_date_time and created_date must be within [policy_start_date, policy_end_date]
    2. created_date must not be before incident_date_time (by date)
    Returns True if all conditions pass (no mismatch). Missing dates skip that check (no fail).
    """
    start = _to_date(policy_start_date)
    end = _to_date(policy_end_date)
    if start is None or end is None:
        return True  # cannot validate without policy period
    if start > end:
        return True  # invalid period, skip validation

    inc_date = _to_date(incident_dt)
    cre_date = _to_date(created_dt)

    if inc_date is not None and (inc_date < start or inc_date > end):
        return False
    if cre_date is not None:
        if cre_date < start or cre_date > end:
            return False
        if inc_date is not None and cre_date < inc_date:
            return False
    return True


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


def _evaluate_single_fraud_rule(
    rule_type: str,
    incident: dict,
    policy: dict,
    vehicle: dict,
    documents: dict,
    complaint_id: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Evaluate one Fraud Check rule by rule_type. Returns (passed, description).
    """
    desc = _get_fraud_rule_description(rule_type)
    vehicle = vehicle or {}
    documents = documents or {}

    if rule_type == "Early Claim":
        early_window_days = _get_early_claim_window_days()
        start_date = parse_date(policy.get("policy_start_date"))
        loss_dt = parse_datetime(incident.get("date_time_of_loss"))
        passed = True
        if start_date and loss_dt:
            days_diff = (loss_dt.date() - start_date).days
            if days_diff < 0 or days_diff < early_window_days:
                passed = False
        return passed, desc

    if rule_type == "Data missing":
        passed = bool((incident.get("loss_description") or "").strip())
        return passed, desc

    if rule_type == "Policy Status":
        passed = (policy.get("policy_status") or "").strip().lower() == "active"
        return passed, desc

    if rule_type == "Vehicle Year Invalid":
        vehicle_year = vehicle.get("year")
        passed = True
        if vehicle_year is not None:
            try:
                year_val = int(vehicle_year)
                if year_val > date.today().year:
                    passed = False
            except (TypeError, ValueError):
                pass
        return passed, desc

    if rule_type == "Missing Damage Photos":
        passed = _has_damage_photos(complaint_id=complaint_id, documents=documents)
        return passed, desc

    # Risk when TRUE → passed when FALSE
    if rule_type == "Liability Admission":
        return not bool(incident.get("liability_admission")), desc
    if rule_type == "Dashcam CCTV Evidence":
        return not bool(incident.get("dashcam_cctv_evidence")), desc
    if rule_type == "Injury Indicator":
        return not bool(incident.get("injury_indicator")), desc
    if rule_type == "No Third-Party Escalation":
        return not bool(incident.get("commercial_vehicle")), desc

    if rule_type == "Policy Date Mismatch":
        policy_start = None
        policy_end = None
        incident_dt = None
        created_dt = None
        if complaint_id:
            fnol = FnolClaim.objects.filter(complaint_id=complaint_id).first()
            if fnol:
                policy_start = fnol.policy_start_date
                policy_end = fnol.policy_end_date
                incident_dt = fnol.incident_date_time
                created_dt = getattr(fnol, "created_date", None)
        if policy_start is None:
            policy_start = policy.get("policy_start_date") or None
        if policy_end is None:
            policy_end = policy.get("policy_end_date") or None
        if incident_dt is None:
            incident_dt = incident.get("date_time_of_loss") or None
        passed = _policy_data_mismatch_passed(
            policy_start, policy_end, incident_dt, created_dt
        )
        return passed, desc

    # Unknown rule_type: show in UI with passed=True and DB description
    return True, desc


def _get_fraud_evaluation_rules(
    incident: dict, policy: dict, vehicle: dict, documents: dict,
    complaint_id: Optional[str] = None,
) -> list[dict]:
    """
    Evaluate each active Business Rule Validation rule from claim_rule_master (Fraud Check + Business Rule groups).
    Returns list of {rule_type, rule_description, passed} for all active rules.
    """
    vehicle = vehicle or {}
    documents = documents or {}
    results = []

    rules = ClaimRuleMaster.objects.filter(
        _BUSINESS_RULE_VALIDATION_GROUPS,
        is_active=True,
    ).order_by("rule_id")

    for rule in rules:
        rule_type = (rule.rule_type or "").strip()
        if not rule_type:
            continue
        passed, desc = _evaluate_single_fraud_rule(
            rule_type, incident, policy, vehicle, documents, complaint_id=complaint_id
        )
        results.append({
            "rule_type": rule_type,
            "rule_description": rule.rule_description or desc,
            "rule_group": rule.rule_group or "",
            "passed": passed,
        })

    return results


def damage_detection(incident: dict) -> int:
    """
    Damage confidence based on damage_code_master.
    Starts with a base confidence and adds severity percentages for each
    matching damage_type found in the loss description.
    """
    description = (incident.get("loss_description") or "").lower()
    base_confidence = 50.0

    try:
        damage_rows = list(DamageCodeMaster.objects.filter(is_active=True))
    except DatabaseError as exc:
        # Legacy DBs may still use PK column damage_code while the model expects damage_id;
        # migration 0008 fixes SQLite; this keeps process_claim from returning 500.
        logger.warning("damage_detection: DamageCodeMaster query failed (%s); using base confidence", exc)
        return 50

    for damage in damage_rows:
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
    settings = get_claim_type_settings()
    simple_max_amount = settings["simple_max_amount"]
    medium_max_amount = settings["medium_max_amount"]
    fallback_threshold = settings["fallback_threshold_percent"] / 100.0

    if amount <= simple_max_amount:
        claim_type_name = "SIMPLE"
    elif amount <= medium_max_amount:
        claim_type_name = "MEDIUM"
    else:
        claim_type_name = "COMPLEX"

    row = ClaimTypeMaster.objects.filter(
        claim_type_name__iexact=claim_type_name, is_active=True
    ).first()

    if not row:
        return fallback_threshold, None

    try:
        threshold = float(row.risk_percentage) / 100.0
    except (TypeError, ValueError):
        threshold = fallback_threshold

    return threshold, claim_type_name


def evaluate_score(confidence: int, amount: float) -> float:
    base = confidence / 100
    settings = get_claim_type_settings()
    if amount > settings["medium_max_amount"]:
        base *= settings["high_amount_score_factor"]
    return round(base, 2)


def _get_claim_status_label_for_evaluation(result: dict) -> str:
    """
    Map process_claim result to the status string stored in claim_evaluation_response.claim_status.
    - Rejected → Business Rule Validation-fail
    - Closed (or Open / passed) → Business Rule Validation-pass
    """
    decision = (result.get("decision") or "").strip()
    status = (result.get("claim_status") or "").strip()
    if decision == "Reject" or status == "Rejected":
        return "Business Rule Validation-fail"
    fraud_rule_results = result.get("fraud_rule_results") or []
    if fraud_rule_results and not all(
        bool(rule.get("passed")) for rule in fraud_rule_results if isinstance(rule, dict)
    ):
        return "Business Rule Validation-fail"
    return "Business Rule Validation-pass"


def _get_claim_status_for_result(result: dict) -> ClaimStatus | None:
    """
    Map run_fraud_detection result to fnol_claims.claim_status (claim_status table).
    Business Rule Validation (match your claim_status table):
      - decision Reject → Business Rule Validation-fail (fallback: Rejected)
      - All fraud rules passed → Business Rule Validation-pass (fallback: Open)
      - Any fraud rule failed → Business Rule Validation-fail (fallback: Rejected)
    Uses fraud_rule_results so stored status matches what the user sees in the UI.
    """
    def _resolve_status(*preferred_names: str) -> ClaimStatus | None:
        for name in preferred_names:
            status = ClaimStatus.objects.filter(status_name__iexact=name).first()
            if status:
                return status
        return None

    decision = (result.get("decision") or "").strip()
    if decision == "Reject":
        return _resolve_status("Business Rule Validation-fail", "Rejected")

    # When not Reject, derive from fraud_rule_results so DB matches UI rule list
    fraud_rule_results = result.get("fraud_rule_results") or []
    if fraud_rule_results:
        all_passed = all(r.get("passed", False) for r in fraud_rule_results)
        if not all_passed:
            return _resolve_status("Business Rule Validation-fail", "Rejected")

    # All rules passed (or no rules) → pass
    return _resolve_status("Business Rule Validation-pass", "Open")


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
    fallback_threshold = (
        get_claim_type_settings()["fallback_threshold_percent"] / 100.0
    )
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
            "threshold": fallback_threshold,
            "claim_type": None,
            "estimated_amount": estimated_amount,
        }

    fraud_score, fraud_reason = fraud_check(
        history, incident, policy, vehicle, complaint_id=complaint_id
    )
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
            "threshold": fallback_threshold,
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
            "threshold": fallback_threshold,
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


def _build_fnol_photo_maps(
    complaint_ids: list[str],
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """
    Build both public photo URLs and normalized stored paths in one query so MySQL-backed
    list views do not re-fetch photos per claim.
    """
    from claims.media_paths import (
        damage_photo_public_relative_url,
        normalize_stored_photo_path,
    )

    public_urls: dict[str, list[str]] = defaultdict(list)
    normalized_paths: dict[str, list[str]] = defaultdict(list)

    if not complaint_ids:
        return public_urls, normalized_paths

    photo_rows = (
        FnolDamagePhoto.objects.filter(complaint_id__in=complaint_ids)
        .order_by("id")
        .values_list("complaint_id", "photo_path")
    )
    for complaint_id, path in photo_rows:
        if not path:
            continue
        public_url = damage_photo_public_relative_url(path)
        if public_url:
            public_urls[complaint_id].append(public_url)
        normalized = normalize_stored_photo_path(path)
        if normalized:
            normalized_paths[complaint_id].append(normalized)

    return public_urls, normalized_paths


# Cap evaluation history rows per claim for /fraud-claims.
# Sourced from cfg so it scales with MYSQL_READ_TIMEOUT — see vca_config.py.
_EVAL_RECORDS_PER_CLAIM_CAP = _vca_cfg.eval_records_per_claim_cap


def _photo_maps_from_prefetched_fnol_claims(
    claims: list,
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """
    Build photo URL maps from Prefetch(to_attr="_ordered_damage_photos") so list_fnol
    does not run a second query against fnol_damage_photos.
    """
    from claims.media_paths import (
        damage_photo_public_relative_url,
        normalize_stored_photo_path,
    )

    public_urls: dict[str, list[str]] = defaultdict(list)
    normalized_paths: dict[str, list[str]] = defaultdict(list)
    for claim in claims:
        cid = claim.complaint_id
        rows = getattr(claim, "_ordered_damage_photos", None) or []
        for row in rows:
            path = getattr(row, "photo_path", None) or ""
            if not path:
                continue
            public_url = damage_photo_public_relative_url(path)
            if public_url:
                public_urls[cid].append(public_url)
            normalized = normalize_stored_photo_path(path)
            if normalized:
                normalized_paths[cid].append(normalized)
    return public_urls, normalized_paths


def _evaluation_counts_by_complaint(complaint_ids: list[str]) -> dict[str, int]:
    if not complaint_ids:
        return {}
    rows = (
        ClaimEvaluationResponse.objects.filter(complaint_id__in=complaint_ids)
        .values("complaint_id")
        .annotate(c=Count("id"))
        .values_list("complaint_id", "c")
    )
    return {str(cid): int(c) for cid, c in rows}


def _evaluation_records_by_complaint_capped(
    complaint_ids: list[str],
    *,
    per_claim_limit: int = _EVAL_RECORDS_PER_CLAIM_CAP,
) -> dict[str, list[dict[str, object]]]:
    """
    Latest N evaluation versions per complaint (by version DESC), using a window query
    when supported (MySQL 8+, PostgreSQL, SQLite 3.25+). Falls back to a full scan +
    Python truncation on older MySQL or if the query fails.
    """
    records_by_complaint: dict[str, list[dict[str, object]]] = defaultdict(list)
    if not complaint_ids or per_claim_limit < 1:
        return records_by_complaint

    try:
        placeholders = ", ".join(["%s"] * len(complaint_ids))
        sql = f"""
            SELECT complaint_id, version, threshold_value, claim_status, reason
            FROM (
                SELECT complaint_id, version, threshold_value, claim_status, reason,
                       ROW_NUMBER() OVER (
                           PARTITION BY complaint_id ORDER BY version DESC
                       ) AS rn
                FROM claim_evaluation_response
                WHERE complaint_id IN ({placeholders})
            ) ranked
            WHERE ranked.rn <= %s
            ORDER BY complaint_id ASC, version ASC
        """
        params = list(complaint_ids) + [per_claim_limit]
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            desc = [c[0] for c in (cursor.description or [])]
            for row in cursor.fetchall():
                rec = dict(zip(desc, row))
                cid = str(rec["complaint_id"])
                reason_raw = rec.get("reason")
                claim_st = rec.get("claim_status")
                records_by_complaint[cid].append(
                    {
                        "complaint_id": cid,
                        "version": rec["version"],
                        "threshold_value": rec["threshold_value"],
                        "claim_status": (claim_st or "—") or "—",
                        "reason": ((reason_raw or "").strip() or "—"),
                    }
                )
        return records_by_complaint
    except Exception as exc:
        logger.warning(
            "evaluation history window query failed (%s); using full scan + truncate",
            exc,
        )

    full = _evaluation_records_by_complaint(complaint_ids)
    out: dict[str, list[dict[str, object]]] = {}
    for cid in complaint_ids:
        rows = full.get(cid, [])
        if len(rows) > per_claim_limit:
            out[cid] = rows[-per_claim_limit:]
        else:
            out[cid] = rows
    return out


def _latest_evaluations_by_complaint(
    complaint_ids: list[str],
    *,
    for_list: bool = False,
) -> dict[str, ClaimEvaluationResponse]:
    """
    Batch-load latest evaluation rows. When for_list=True, omit large TextField columns
    (llm_damages) so MySQL list endpoints stay fast for many claims.
    """
    if not complaint_ids:
        return {}
    qs = ClaimEvaluationResponse.objects.filter(
        complaint_id__in=complaint_ids,
        is_latest=True,
    )
    if for_list:
        qs = qs.only(
            "complaint_id",
            "claim_status",
            "estimated_amount",
            "claim_amount",
            "decision",
            "reason",
            "created_date",
        )
    else:
        qs = qs.only(
            "complaint_id",
            "claim_status",
            "estimated_amount",
            "claim_amount",
            "llm_damages",
            "llm_severity",
            "decision",
            "reason",
            "created_date",
        )
    return {row.complaint_id: row for row in qs}


def _evaluation_records_by_complaint(
    complaint_ids: list[str],
) -> dict[str, list[dict[str, object]]]:
    records_by_complaint: dict[str, list[dict[str, object]]] = defaultdict(list)
    if not complaint_ids:
        return records_by_complaint

    eval_rows = (
        ClaimEvaluationResponse.objects.filter(complaint_id__in=complaint_ids)
        .order_by("complaint_id", "version")
        .values("complaint_id", "version", "threshold_value", "claim_status", "reason")
    )
    for row in eval_rows:
        complaint_id = row["complaint_id"]
        records_by_complaint[complaint_id].append(
            {
                "complaint_id": complaint_id,
                "version": row["version"],
                "threshold_value": row["threshold_value"],
                "claim_status": row["claim_status"] or "—",
                "reason": (row["reason"] or "").strip() or "—",
            }
        )
    return records_by_complaint


def _fnol_claim_to_raw_response(
    claim: FnolClaim, normalized_photo_paths: Optional[list[str]] = None
) -> dict:
    """Build FnolPayload-like dict from FnolClaim for process_claim compatibility."""

    photos = normalized_photo_paths
    if photos is None:
        _, normalized_photo_map = _build_fnol_photo_maps([claim.complaint_id])
        photos = normalized_photo_map.get(claim.complaint_id, [])

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
            "accident_location": getattr(claim, "accident_location", "") or "",
            "liability_admission": getattr(claim, "liability_admission", None),
            "dashcam_cctv_evidence": getattr(claim, "dashcam_cctv_evidence", None),
            "injury_indicator": getattr(claim, "injury_indicator", None),
            "commercial_vehicle": getattr(claim, "commercial_vehicle", None),
            "flood_coverage": getattr(claim, "flood_coverage", None),
        },
        "accident_location": getattr(claim, "accident_location", "") or "",
        "liability_admission": getattr(claim, "liability_admission", None),
        "dashcam_cctv_evidence": getattr(claim, "dashcam_cctv_evidence", None),
        "injury_indicator": getattr(claim, "injury_indicator", None),
        "commercial_vehicle": getattr(claim, "commercial_vehicle", None),
        "flood_coverage": getattr(claim, "flood_coverage", None),
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


def _fnol_claim_to_response(
    claim: FnolClaim,
    latest_eval: ClaimEvaluationResponse | None = None,
    photo_urls: Optional[list[str]] = None,
    normalized_photo_paths: Optional[list[str]] = None,
    *,
    list_mode: bool = False,
    workflow_state: Optional[str] = None,
    damage_state: Optional[dict[str, int | bool]] = None,
) -> dict:
    """Convert FnolClaim to API response format. Includes latest evaluation amounts when available."""
    if latest_eval is None and not list_mode:
        latest_eval = ClaimEvaluationResponse.objects.filter(
            complaint_id=claim.complaint_id, is_latest=True
        ).only(
            "complaint_id",
            "claim_status",
            "estimated_amount",
            "claim_amount",
            "llm_damages",
            "llm_severity",
            "decision",
            "reason",
            "created_date",
        ).first()

    estimated_amount = None
    claim_amount = None
    llm_damages = None
    llm_severity = None
    if latest_eval:
        estimated_amount = float(latest_eval.estimated_amount or 0)
        claim_amount = float(latest_eval.claim_amount or 0)
        if not list_mode:
            llm_damages = latest_eval.llm_damages
            llm_severity = latest_eval.llm_severity

    if photo_urls is None or normalized_photo_paths is None:
        photo_url_map, normalized_photo_map = _build_fnol_photo_maps([claim.complaint_id])
        if photo_urls is None:
            photo_urls = photo_url_map.get(claim.complaint_id, [])
        if normalized_photo_paths is None:
            normalized_photo_paths = normalized_photo_map.get(claim.complaint_id, [])

    response = {
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
        "accident_location": getattr(claim, "accident_location", None),
        "liability_admission": getattr(claim, "liability_admission", None),
        "dashcam_cctv_evidence": getattr(claim, "dashcam_cctv_evidence", None),
        "injury_indicator": getattr(claim, "injury_indicator", None),
        "commercial_vehicle": getattr(claim, "commercial_vehicle", None),
        "flood_coverage": getattr(claim, "flood_coverage", None),
        "previous_claims_last_12_months": 0,
        "fir_document_copy": claim.fir_document_copy,
        "insurance_document_copy": claim.insurance_document_copy,
        "damage_photos": photo_urls,
        "raw_response": _fnol_claim_to_raw_response(
            claim, normalized_photo_paths=normalized_photo_paths
        ),
            "status": effective_claim_status(claim, latest_eval),
        "estimated_amount": estimated_amount,
        "claim_amount": claim_amount,
        "excess_amount": float(claim.excess_amount) if claim.excess_amount is not None else None,
        "llm_damages": llm_damages,
        "llm_severity": llm_severity,
        "created_date": claim.created_date.isoformat() if getattr(claim, "created_date", None) else None,
        "created_by": getattr(claim, "created_by", None),
        "updated_date": claim.updated_date.isoformat() if getattr(claim, "updated_date", None) else None,
        "updated_by": getattr(claim, "updated_by", None),
        "re_open": 1 if getattr(claim, "re_open", 0) == 1 else 0,
        "workflow_state": workflow_state
        if workflow_state is not None
        else compute_claim_workflow_state(claim.complaint_id),
    }

    if list_mode and damage_state is not None:
        ws = (
            workflow_state
            if workflow_state is not None
            else compute_claim_workflow_state(claim.complaint_id)
        )
        response["workflow_snapshot"] = build_claim_workflow_snapshot_for_list(
            claim.complaint_id,
            claim,
            latest_eval,
            damage_state,
            ws,
        )
    elif not list_mode:
        response["workflow_snapshot"] = build_claim_workflow_snapshot(
            claim.complaint_id,
            fnol=claim,
            latest_eval=latest_eval,
        )
        response.update(build_claim_video_overview(claim))

    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_fraud_claims(request):
    """
    Return re-open claims only (fnol_claims.re_open = 1) that have been through fraud detection.
    Used by Re-Open Claims page - shows only claims marked for re-open.
    The three dependent queries run in parallel to reduce wall-clock time on a remote DB.
    """
    results = []
    try:
        fnol_claims = list(
            FnolClaim.objects.filter(re_open=1)
            .select_related("claim_status")
            .order_by("-incident_date_time", "-complaint_id")
        )
        complaint_ids = [claim.complaint_id for claim in fnol_claims]

        if not complaint_ids:
            return Response([])

        # Run the three independent follow-up queries in parallel
        latest_eval_map, evaluation_records_map, evaluation_counts_map = _run_parallel(
            [
                partial(_latest_evaluations_by_complaint, complaint_ids, for_list=True),
                partial(_evaluation_records_by_complaint_capped, complaint_ids),
                partial(_evaluation_counts_by_complaint, complaint_ids),
            ]
        )

        for claim in fnol_claims:
            eval_row = latest_eval_map.get(claim.complaint_id)
            if not eval_row:
                continue
            status_name = effective_claim_status(claim, eval_row)
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

            re_open = getattr(claim, "re_open", None)
            if re_open is None:
                re_open = 0
            try:
                re_open = int(re_open)
            except (TypeError, ValueError):
                re_open = 0

            evaluation_records = evaluation_records_map.get(
                str(claim.complaint_id), []
            )
            times_processed = evaluation_counts_map.get(str(claim.complaint_id), 0)

            latest_claim_status = status_name or "—"

            results.append({
                "complaint_id": claim.complaint_id,
                "claimNumber": claim.complaint_id,
                "customer": claim.policy_holder_name or "—",
                "riskScore": risk_score,
                "reason": reason,
                "amount": float(eval_row.estimated_amount or eval_row.claim_amount or 0),
                "status": ui_status,
                "latest_claim_status": latest_claim_status,
                "detectedAt": eval_row.created_date.isoformat() if eval_row.created_date else None,
                "indicators": [reason] if reason and reason != "—" else [],
                "re_open": re_open,
                "times_processed": times_processed,
                "evaluation_records": evaluation_records,
            })
    except DatabaseError as exc:
        logger.exception(
            "list_fraud_claims: database error while building re-open claim queue: %s",
            exc,
        )
        return _api_error_response(
            request,
            message="Unable to load the re-open claim queue right now.",
            developer_message=str(exc),
            error_code="fraud_claims_unavailable",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return Response(results)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_fnol(request):
    """
    Return a list of FNOL claims.
    Photo maps are derived from the in-memory prefetch result; the evaluation query
    runs as a second, independent DB call.
    """
    try:
        prefetch_photos = Prefetch(
            "damage_photos",
            queryset=FnolDamagePhoto.objects.order_by("id"),
            to_attr="_ordered_damage_photos",
        )
        qs = list(
            FnolClaim.objects.all()
            .select_related("claim_status")
            .prefetch_related(prefetch_photos)
            .order_by("-incident_date_time", "-complaint_id")
        )
        complaint_ids = [obj.complaint_id for obj in qs]

        if not complaint_ids:
            return Response([])

        # Evaluations query and photo-map building can run concurrently:
        # photo maps use already-prefetched in-memory data (no DB call), so
        # we let it run on the same thread while the eval query goes async.
        latest_eval_map = _latest_evaluations_by_complaint(
            complaint_ids, for_list=True
        )
        damage_state_by_claim = bulk_damage_assessment_persistence_state(
            qs, latest_eval_map
        )
        photo_urls_by_claim, normalized_photos_by_claim = (
            _photo_maps_from_prefetched_fnol_claims(qs)
        )
        data = [
            _fnol_claim_to_response(
                obj,
                latest_eval=latest_eval_map.get(obj.complaint_id),
                photo_urls=photo_urls_by_claim.get(obj.complaint_id, []),
                normalized_photo_paths=normalized_photos_by_claim.get(
                    obj.complaint_id, []
                ),
                list_mode=True,
                workflow_state=derive_workflow_state_from_context(
                    obj,
                    latest_eval_map.get(obj.complaint_id),
                    damage_state_by_claim[obj.complaint_id],
                ),
                damage_state=damage_state_by_claim[obj.complaint_id],
            )
            for obj in qs
        ]
        return Response(data)
    except DatabaseError as exc:
        logger.exception("list_fnol: database error while loading claim list: %s", exc)
        return _api_error_response(
            request,
            message="Unable to load claims right now.",
            developer_message=str(exc),
            error_code="fnol_list_unavailable",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


@api_view(['GET', 'DELETE'])
@permission_classes([IsAuthenticated])
def get_fnol(request, pk: str):
    """
    Return or delete a single FNOL claim by complaint_id.
    """
    obj = get_object_or_404(
        FnolClaim.objects.select_related("claim_status"), complaint_id=pk
    )
    if request.method == "DELETE":
        deleted_counts = _delete_fnol_claim_record(obj)
        return Response(
            {
                "message": "Claim deleted.",
                "complaint_id": pk,
                "deleted_counts": deleted_counts,
            },
            status=status.HTTP_200_OK,
        )
    latest_eval_map = _latest_evaluations_by_complaint([pk], for_list=False)
    photo_urls_by_claim, normalized_photos_by_claim = _build_fnol_photo_maps([pk])
    data = _fnol_claim_to_response(
        obj,
        latest_eval=latest_eval_map.get(pk),
        photo_urls=photo_urls_by_claim.get(pk, []),
        normalized_photo_paths=normalized_photos_by_claim.get(pk, []),
        list_mode=False,
    )
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def bulk_delete_fnol(request):
    """
    Delete multiple FNOL claims by complaint_id in one request.
    """
    complaint_ids_raw = request.data.get("complaint_ids")
    if not isinstance(complaint_ids_raw, list):
        return Response(
            {"error": "complaint_ids must be a non-empty list."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    complaint_ids: list[str] = []
    seen: set[str] = set()
    for raw_id in complaint_ids_raw:
        complaint_id = str(raw_id or "").strip()
        if complaint_id and complaint_id not in seen:
            complaint_ids.append(complaint_id)
            seen.add(complaint_id)

    if not complaint_ids:
        return Response(
            {"error": "complaint_ids must contain at least one claim id."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    claims_by_id = {
        claim.complaint_id: claim
        for claim in FnolClaim.objects.filter(complaint_id__in=complaint_ids)
    }
    deleted_ids: list[str] = []
    not_found_ids: list[str] = []
    deleted_rows = 0
    deleted_counts_by_claim: dict[str, dict[str, int]] = {}

    for complaint_id in complaint_ids:
        claim = claims_by_id.get(complaint_id)
        if claim is None:
            not_found_ids.append(complaint_id)
            continue

        deleted_counts = _delete_fnol_claim_record(claim)
        deleted_counts_by_claim[complaint_id] = deleted_counts
        deleted_ids.append(complaint_id)
        deleted_rows += sum(int(value) for value in deleted_counts.values())

    return Response(
        {
            "message": "Claims deleted." if deleted_ids else "No matching claims found.",
            "requested_count": len(complaint_ids),
            "deleted_count": len(deleted_ids),
            "deleted_ids": deleted_ids,
            "not_found_ids": not_found_ids,
            "deleted_rows": deleted_rows,
            "deleted_counts_by_claim": deleted_counts_by_claim,
        },
        status=status.HTTP_200_OK,
    )


def _current_phase1_valuation_for_claim(
    fnol: FnolClaim | None,
    latest_eval: ClaimEvaluationResponse | None,
) -> ClaimPhase1Valuation | None:
    if not fnol:
        return None
    valuation = ClaimPhase1Valuation.objects.filter(complaint=fnol).first()
    if not valuation or not valuation_row_has_meaningful_output(valuation):
        return None
    started_at = current_lifecycle_started_at(latest_eval)
    if started_at and (valuation.updated_at is None or valuation.updated_at < started_at):
        return None
    return valuation


def _current_phase1_valuation_artifact_for_claim(
    fnol: FnolClaim | None,
    latest_eval: ClaimEvaluationResponse | None,
) -> ClaimPhase1Valuation | None:
    """
    Return the valuation artifact for the current BRV lifecycle even when it has
    zero output (gross_estimate == 0 and empty breakdown).

    This is used for reviewer-facing claim evaluation so "no structural damage"
    cases still render 0-values instead of hiding financials.
    """
    if not fnol:
        return None
    valuation = ClaimPhase1Valuation.objects.filter(complaint=fnol).first()
    if not valuation:
        return None
    started_at = current_lifecycle_started_at(latest_eval)
    if started_at and (valuation.updated_at is None or valuation.updated_at < started_at):
        return None
    # updated_at must exist to count as a DA artifact for this lifecycle
    if valuation.updated_at is None:
        return None
    return valuation


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_claim_evaluation(request, complaint_id: str):
    """
    Return the latest claim evaluation response for a complaint_id.
    Includes damage_confidence, estimated_amount, claim_amount, excess_amount (from fnol_claims),
    estimated_repair (claim_amount - excess_amount), decision, claim_status,
    reason, llm_damages, llm_severity (from damage assessment).
    """
    fnol = FnolClaim.objects.filter(complaint_id=complaint_id).first()
    latest = ClaimEvaluationResponse.objects.filter(
        complaint_id=complaint_id, is_latest=True
    ).first()
    if not latest:
        # Fresh claim: no evaluation row yet — expected empty state (not an HTTP error).
        workflow_snapshot = build_claim_workflow_snapshot(
            complaint_id,
            fnol=fnol,
            latest_eval=None,
            decision_summary=None,
        )
        return Response(
            {
                "complaint_id": complaint_id,
                "not_started": True,
                "workflow_state": workflow_snapshot["workflow_state"],
                "workflow_snapshot": workflow_snapshot,
                "version": None,
                "is_latest": None,
                "damage_confidence": None,
                "estimated_amount": None,
                "claim_amount": None,
                "excess_amount": None,
                "estimated_repair": None,
                "threshold_value": None,
                "claim_type": None,
                "claim_complexity": None,
                "claim_complexity_threshold": None,
                "claim_complexity_amount": None,
                "severity": None,
                "decision": None,
                "claim_status": None,
                "reason": None,
                "fraud_score": None,
                "fraud_rule_results": [],
                "decision_summary": None,
                "llm_damages": None,
                "llm_severity": None,
                "created_date": None,
                "updated_date": None,
            },
            status=status.HTTP_200_OK,
        )
    decision_summary = sync_claim_evaluation_decision_state(
        complaint_id=complaint_id,
        latest_eval=latest,
    )
    latest.refresh_from_db()
    workflow_snapshot = build_claim_workflow_snapshot(
        complaint_id,
        fnol=fnol,
        latest_eval=latest,
        decision_summary=decision_summary,
    )

    damages = None
    if latest.llm_damages:
        try:
            damages = json.loads(latest.llm_damages)
        except (json.JSONDecodeError, TypeError):
            damages = None

    # Financials are reviewer-facing once the current lifecycle has a DA artifact.
    # For "no structural damage" cases the valuation can be zero-only; we still
    # return 0-values so Claim Evaluation renders consistently across claim types.
    financials_ready = bool(
        workflow_snapshot.get("claim_evaluation", {}).get("financials_ready")
    )
    current_valuation = (
        _current_phase1_valuation_artifact_for_claim(fnol, latest)
        if financials_ready
        else None
    )
    estimated_amount = (
        float(current_valuation.gross_estimate or 0)
        if current_valuation
        else float(latest.estimated_amount or 0)
    )
    excess_amount = (
        float(current_valuation.excess_amount or 0)
        if current_valuation and current_valuation.excess_amount is not None
        else None
    )
    claim_amount = (
        float(current_valuation.net_payable or 0)
        if current_valuation and current_valuation.net_payable is not None
        else None
    )
    estimated_repair = (
        float(current_valuation.gross_estimate or 0)
        if current_valuation and current_valuation.gross_estimate is not None
        else None
    )

    # Severity from claim type: SIMPLE=minor, MEDIUM=moderate, COMPLEX=severe
    claim_type_upper = (latest.claim_type or "").strip().upper()
    severity = _CLAIM_TYPE_SEVERITY.get(claim_type_upper) or latest.llm_severity or None

    rules_snapshot = latest.fraud_rule_results
    if not isinstance(rules_snapshot, list):
        rules_snapshot = []

    # ── Claim complexity (Simple Claim / Major Claim) ──────────────────────────
    # Prefer the persisted DA gross estimate (ClaimPhase1Valuation) so the
    # classification reflects actual assessed repair cost, not the FNOL estimate.
    # Falls back to claim_amount → estimated_amount → 0 when DA has not run yet.
    major_threshold = get_major_claim_threshold()
    da_gross = (
        float(current_valuation.gross_estimate or 0)
        if current_valuation
        else 0
    )
    complexity_amount = (
        da_gross
        if da_gross > 0
        else claim_amount
        if claim_amount is not None
        else float(latest.estimated_amount or 0)
    )
    claim_complexity = (
        "Major Claim" if complexity_amount >= major_threshold else "Simple Claim"
    )

    return Response({
        "complaint_id": latest.complaint_id,
        "not_started": False,
        "workflow_state": workflow_snapshot["workflow_state"],
        "workflow_snapshot": workflow_snapshot,
        "version": latest.version,
        "is_latest": latest.is_latest,
        "damage_confidence": float(latest.damage_confidence or 0),
        "estimated_amount": estimated_amount,
        "claim_amount": claim_amount,
        "excess_amount": excess_amount,
        "estimated_repair": estimated_repair,
        "threshold_value": latest.threshold_value,
        "claim_type": latest.claim_type,
        # Binary claim complexity classification (driven by MAJOR_CLAIM_THRESHOLD PricingConfig)
        "claim_complexity": claim_complexity,
        "claim_complexity_threshold": major_threshold,
        "claim_complexity_amount": complexity_amount,
        "severity": severity,
        "decision": latest.decision,
        "claim_status": latest.claim_status,
        "reason": latest.reason,
        "decision_summary": decision_summary,
        "llm_damages": damages,
        "llm_severity": latest.llm_severity,
        "fraud_score": latest.fraud_band or None,
        "fraud_rule_results": rules_snapshot,
        "created_date": latest.created_date.isoformat() if latest.created_date else None,
        "updated_date": latest.updated_date.isoformat() if latest.updated_date else None,
    })


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def claim_type_master_collection(request):
    if request.method == "GET":
        qs = ClaimTypeMaster.objects.all().order_by("claim_type_id")
        return Response(ClaimTypeMasterSerializer(qs, many=True).data)

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
        return Response(ClaimTypeMasterSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        serializer = ClaimTypeMasterSerializer(
            obj, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        updated_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
        obj = serializer.save(created_by=obj.created_by or updated_by)
        # Note: model doesn't have updated_by; keeping created_by stable
        return Response(ClaimTypeMasterSerializer(obj).data)

    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def claim_rule_master_collection(request):
    if request.method == "GET":
        qs = ClaimRuleMaster.objects.all().order_by("rule_id")
        return Response(ClaimRuleMasterSerializer(qs, many=True).data)

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
        return Response(ClaimRuleMasterSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        serializer = ClaimRuleMasterSerializer(
            obj, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        updated_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
        obj = serializer.save(created_by=obj.created_by or updated_by)
        return Response(ClaimRuleMasterSerializer(obj).data)

    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def damage_code_master_collection(request):
    if request.method == "GET":
        qs = DamageCodeMaster.objects.all().order_by("damage_id")
        return Response(DamageCodeMasterSerializer(qs, many=True).data)

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
        return Response(DamageCodeMasterSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        serializer = DamageCodeMasterSerializer(
            obj, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        updated_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
        obj = serializer.save(created_by=obj.created_by or updated_by)
        return Response(DamageCodeMasterSerializer(obj).data)

    obj.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def pricing_config_collection(request):
    if request.method == "GET":
        qs = PricingConfig.objects.all().order_by("config_key")
        return Response(PricingConfigSerializer(qs, many=True).data)

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
        return Response(PricingConfigSerializer(obj).data)

    if request.method in ("PUT", "PATCH"):
        serializer = PricingConfigSerializer(
            obj, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        updated_by = getattr(getattr(request, "user", None), "username", None) or "api_user"
        obj = serializer.save(updated_by=updated_by)
        return Response(PricingConfigSerializer(obj).data)

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
    accident_location = (
        incident.get("accident_location")
        or data.get("accident_location")
        or ""
    )

    def _incident_bool(field_name: str):
        if incident.get(field_name) is not None:
            return incident.get(field_name)
        return data.get(field_name)

    excess_amount = incident.get("excess_amount")
    if excess_amount in ("", None):
        excess_amount = data.get("excess_amount")
    incident_dt = incident.get("date_time_of_loss")
    if incident_dt:
        try:
            incident_dt = parse_datetime(str(incident_dt))
        except (TypeError, ValueError):
            incident_dt = None
    policy_start = parse_date(policy.get("policy_start_date")) if policy.get("policy_start_date") else None
    policy_end = parse_date(policy.get("policy_end_date")) if policy.get("policy_end_date") else None
    coverage_raw = policy.get("coverage_type")
    coverage_stripped = (
        str(coverage_raw).strip() if coverage_raw not in (None, "") else ""
    )
    incident_type_raw = incident.get("claim_type")
    incident_type = (
        str(incident_type_raw).strip()
        if incident_type_raw not in (None, "")
        else ""
    )
    if not incident_type:
        # Default for newly created claims when upstream FNOL does not provide a claim_type.
        incident_type = "Hit-and-Run Accident by Unknown Third Party"
    return {
        "complaint_id": complaint_id,
        "coverage_type": coverage_stripped or None,
        "policy_number": policy.get("policy_number"),
        "policy_status": policy.get("policy_status"),
        "policy_start_date": policy_start,
        "policy_end_date": policy_end,
        "policy_holder_name": claimant.get("driver_name"),
        "vehicle_make": vehicle.get("make"),
        "vehicle_year": vehicle.get("year"),
        "vehicle_model": vehicle.get("model"),
        "vehicle_registration_number": vehicle.get("registration_number"),
        "incident_type": incident_type or None,
        "incident_description": incident.get("loss_description"),
        "incident_date_time": incident_dt,
        "accident_location": str(accident_location).strip() or None,
        "liability_admission": _incident_bool("liability_admission"),
        "dashcam_cctv_evidence": _incident_bool("dashcam_cctv_evidence"),
        "injury_indicator": _incident_bool("injury_indicator"),
        "commercial_vehicle": _incident_bool("commercial_vehicle"),
        "flood_coverage": _incident_bool("flood_coverage"),
        "fir_document_copy": documents.get("fir_path") if isinstance(documents.get("fir_path"), str) else None,
        "insurance_document_copy": documents.get("insurance_path") if isinstance(documents.get("insurance_path"), str) else None,
        "excess_amount": excess_amount if excess_amount not in ("", None) else 0,
        "re_open": 0,  # New/fetched claim: set to 0 when saving via Fetch FNOL Data
    }


@api_view(['POST'])
@permission_classes([IsAuthenticated])
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
    record, created = FnolClaim.objects.update_or_create(
        complaint_id=complaint_id,
        defaults=claim_data,
    )
    reset_artifact_counts = {}
    if not created and claim_data.get("re_open", 0) == 0:
        reset_artifact_counts = _clear_claim_processing_artifacts(record)
        if any(reset_artifact_counts.values()):
            logger.info(
                "save_fnol reset persisted processing artifacts for %s: %s",
                complaint_id,
                reset_artifact_counts,
            )

    # Handle damage photos (strings or { image: { url } } objects — normalized to basename)
    documents = data.get("documents") or {}
    photo_paths = documents.get("photos")
    from claims.media_paths import coerce_fnol_photo_entry

    record.damage_photos.all().delete()
    if isinstance(photo_paths, list):
        for item in photo_paths:
            normalized = coerce_fnol_photo_entry(item)
            if normalized:
                FnolDamagePhoto.objects.create(complaint=record, photo_path=normalized)

    payload = {
        "message": "FNOL saved successfully",
        "id": record.complaint_id,
    }
    if reset_artifact_counts:
        payload["reset_processing_artifacts"] = reset_artifact_counts
    return Response(payload, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
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
    invalidated_damage_state = _invalidate_phase1_damage_assessment_state(fnol_claim)
    if any(invalidated_damage_state.values()):
        logger.info(
            "BRV rerun invalidated downstream DA artifacts for %s: %s",
            complaint_id,
            invalidated_damage_state,
        )

    # Use existing evaluation's claim_amount for threshold so threshold_value is not always 25
    existing = ClaimEvaluationResponse.objects.filter(
        complaint_id=complaint_id, is_latest=True
    ).first()
    if existing and (existing.claim_amount or existing.estimated_amount):
        amount = float(existing.claim_amount or existing.estimated_amount or 0)
        if amount > 0:
            raw_response.setdefault("incident", {})["estimated_amount"] = amount

    result = _run_process_claim_logic(raw_response)

    user_id = None
    if request.user and request.user.pk:
        user_id = request.user.pk

    threshold_val = result.get("threshold")
    threshold_int = int(round((threshold_val or 0) * 100)) if threshold_val is not None else 0

    # Versioning: next version per complaint_id, and clear is_latest on previous rows
    next_version = (
        ClaimEvaluationResponse.objects.filter(complaint_id=complaint_id).aggregate(
            v=Max("version")
        )["v"]
        or 0
    ) + 1
    ClaimEvaluationResponse.objects.filter(complaint_id=complaint_id).update(
        is_latest=False
    )
    evaluation_claim_status = _get_claim_status_label_for_evaluation(result)
    _fs = result.get("fraud_score")
    fraud_band = None
    if _fs is not None and str(_fs).strip():
        fraud_band = str(_fs).strip()[:20]
    fraud_rules_snapshot = result.get("fraud_rule_results")
    if fraud_rules_snapshot is not None and not isinstance(fraud_rules_snapshot, list):
        fraud_rules_snapshot = None
    latest_eval = ClaimEvaluationResponse.objects.create(
        complaint_id=complaint_id,
        version=next_version,
        is_latest=True,
        damage_confidence=result.get("damage_confidence") or 0,
        estimated_amount=result.get("estimated_amount") or 0,
        claim_amount=result.get("claim_amount") or result.get("estimated_amount") or 0,
        threshold_value=threshold_int,
        claim_type=(result.get("claim_type") or "")[:20],
        decision=(result.get("decision") or "")[:20],
        claim_status=(evaluation_claim_status or "")[:50],
        reason=result.get("reason"),
        fraud_band=fraud_band,
        fraud_rule_results=fraud_rules_snapshot,
        created_by=user_id,
        updated_by=user_id,
    )

    # Update fnol_claims.claim_status based on evaluation result
    new_status = _get_claim_status_for_result(result)
    if new_status:
        fnol_claim.claim_status = new_status
        fnol_claim.save(update_fields=["claim_status"])

    sync_claim_evaluation_decision_state(
        complaint_id=complaint_id,
        latest_eval=latest_eval,
    )

    return Response(result, status=status.HTTP_200_OK)


# Severity label keyed by claim_type (upper-case). Used in get_claim_evaluation.
_CLAIM_TYPE_SEVERITY: dict[str, str] = {
    "SIMPLE": "minor",
    "MEDIUM": "moderate",
    "COMPLEX": "severe",
}


def _pdf_llm_damage_tag_list(evaluation) -> list[str]:
    """Parse persisted `llm_damages` as a list of display strings (strings or dicts with damage_type)."""
    if not evaluation:
        return []
    raw = evaluation.llm_damages
    if raw in (None, "", []):
        return []
    if isinstance(raw, str) and not str(raw).strip():
        return []
    damages = None
    if raw:
        try:
            damages = json.loads(raw) if isinstance(raw, str) else raw
        except (json.JSONDecodeError, TypeError):
            damages = None
    if not damages or not isinstance(damages, list):
        return []
    tags: list[str] = []
    for x in damages:
        if isinstance(x, str) and str(x).strip():
            tags.append(str(x).strip())
        elif isinstance(x, dict):
            dt = str(x.get("damage_type") or "").strip()
            if dt:
                tags.append(dt)
    return tags


def _pdf_part_row_damage_tag_list(part_rows) -> list[str]:
    """Unique damage_type labels from persisted part-level DA rows (order preserved)."""
    if not part_rows:
        return []
    seen_lower: set[str] = set()
    ordered: list[str] = []
    for row in part_rows:
        dt = (getattr(row, "damage_type", None) or "").strip()
        if not dt:
            continue
        low = dt.lower()
        if low in ("none", "—", "-", "n/a"):
            continue
        if low in seen_lower:
            continue
        seen_lower.add(low)
        ordered.append(dt)
    return ordered


def _pdf_damages_detected_str(evaluation, part_rows=None) -> str:
    """
    Match Claim Detail: prefer `llm_damages`; if empty, same labels as the UI fallback
    from persisted part rows (`DamagePartAssessment.damage_type`).
    """
    no_tags = "No structured damage tags were returned."
    llm_tags = _pdf_llm_damage_tag_list(evaluation)
    if llm_tags:
        return ", ".join(llm_tags)
    part_tags = _pdf_part_row_damage_tag_list(part_rows or [])
    if part_tags:
        return ", ".join(part_tags)
    return no_tags


def _pdf_damage_severity_str(evaluation) -> str:
    """
    Match `get_claim_evaluation` / Claim Detail: claim_type → minor|moderate|severe,
    then fall back to `llm_severity` (same order as UI `severity ?? llm_severity`).
    """
    if not evaluation:
        return "—"
    claim_type_upper = (evaluation.claim_type or "").strip().upper()
    raw = _CLAIM_TYPE_SEVERITY.get(claim_type_upper) or (evaluation.llm_severity or "").strip() or None
    if not raw:
        return "—"
    return str(raw).strip().capitalize()


# Report brand colors (blue and orange)
_REPORT_BLUE = colors.HexColor("#00205B")
_REPORT_ORANGE = colors.HexColor("#E87722")
_REPORT_LIGHT_BLUE = colors.HexColor("#D6E4F0")
_REPORT_LIGHT_ORANGE = colors.HexColor("#FCE8DC")

# Uniform table layout for recommendation report (same width and row height for all sections)
_REPORT_TABLE_FIRST_COL = 2.5 * inch
_REPORT_TABLE_SECOND_COL = 4.0 * inch
_REPORT_TABLE_ROW_HEIGHT = 32  # points; same for every row so wrapped text fits
# Business Rule Validation table: wider Validation Check column, narrower Status column
_REPORT_TABLE_VALIDATION_COL = 4.5 * inch
_REPORT_TABLE_STATUS_COL = 2.0 * inch

# Paragraph styles for table cells so text wraps to next line instead of overflowing
_REPORT_TABLE_CELL_STYLE = ParagraphStyle(
    name="ReportTableCell",
    fontName="Helvetica",
    fontSize=9,
    leading=11,
    wordWrap="Normal",
)
# Header cell style: white text so all table header names are uniformly white on dark blue
_REPORT_TABLE_HEADER_CELL_STYLE = ParagraphStyle(
    name="ReportTableHeaderCell",
    fontName="Helvetica-Bold",
    fontSize=9,
    leading=11,
    wordWrap="Normal",
    textColor=colors.white,
)


def _report_cell_content(cell, is_header=False):
    """Wrap cell content in Paragraph so it wraps; accept str or already flowable."""
    if hasattr(cell, "wrap") and hasattr(cell, "draw"):
        return cell  # already a flowable
    s = str(cell) if cell is not None else ""
    escaped = html_escape(s)
    style = _REPORT_TABLE_HEADER_CELL_STYLE if is_header else _REPORT_TABLE_CELL_STYLE
    return Paragraph(escaped, style)


def _table_style_header_blue(data, col_widths=None, row_height=None, wrap_cells=True):
    """Table style: blue header row, white text, grid, alternating light blue/white data rows.
    When wrap_cells=True, string cells are converted to Paragraphs so text wraps to next line.
    """
    col_count = len(data[0]) if data else 2
    if col_widths is None:
        col_widths = [_REPORT_TABLE_FIRST_COL, _REPORT_TABLE_SECOND_COL]
    nrows = len(data)
    if wrap_cells and data:
        data = [
            [_report_cell_content(cell, is_header=(r == 0)) for c, cell in enumerate(row)]
            for r, row in enumerate(data)
        ]
    h = row_height if row_height is not None else _REPORT_TABLE_ROW_HEIGHT
    row_heights = [h] * nrows
    t = Table(data, colWidths=col_widths, rowHeights=row_heights)
    styles = [
        ("BACKGROUND", (0, 0), (-1, 0), _REPORT_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]
    for r in range(1, nrows):
        bg = colors.white if r % 2 == 0 else _REPORT_LIGHT_BLUE
        styles.append(("BACKGROUND", (0, r), (-1, r), bg))
    t.setStyle(TableStyle(styles))
    return t


def _section_heading(text, use_orange=False):
    """Section title as paragraph in blue or orange; left-aligned. keepWithNext keeps heading with table below."""
    color = _REPORT_ORANGE if use_orange else _REPORT_BLUE
    style = ParagraphStyle(
        name="SectionHeading",
        fontName="Helvetica-Bold",
        fontSize=12,
        textColor=color,
        alignment=0,  # TA_LEFT
        spaceAfter=6,
        leftIndent=0,
        keepWithNext=True,  # avoid heading on one page and content on next
    )
    return Paragraph(text, style)


def _safe_report_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _truncate_report_text(value: str | None, limit: int = 140) -> str:
    text = (value or "").strip()
    if not text:
        return "—"
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def _build_recommendation_report_pdf(
    claim: FnolClaim,
    evaluation,
    fraud_result: dict,
    *,
    max_section: int = 8,
    dash_after_section: int | None = None,
) -> bytes:
    """Build MOTOR CLAIM RECOMMENDATION REPORT PDF with blue/orange styling and tabular sections.

    Set `max_section` to generate a partial report (e.g. 4 = include up to Business Rule Validation).
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )
    story = []
    styles = getSampleStyleSheet()
    fraud_rows = list(
        ImageFraudResult.objects.filter(complaint=claim).order_by("-fraud_score", "-created_at")
    )
    duplicate_rows = list(
        ClaimDuplicateCandidate.objects.filter(complaint=claim).order_by("-similarity_score", "-created_at")
    )
    part_rows = list(
        DamagePartAssessment.objects.filter(complaint=claim).order_by("sort_order", "id")
    )
    valuation = ClaimPhase1Valuation.objects.filter(complaint=claim).first()

    # ----- Title (left-aligned; no line under heading per request) -----
    title_style = ParagraphStyle(
        name="ReportTitle",
        fontName="Helvetica-Bold",
        fontSize=18,
        textColor=_REPORT_BLUE,
        alignment=0,
        spaceAfter=0.25 * inch,
    )
    story.append(Paragraph("MOTOR CLAIM RECOMMENDATION REPORT", title_style))

    _sp = lambda: Spacer(1, 0.2 * inch)

    # ----- 1. Claim Details -----
    incident_dt = claim.incident_date_time.strftime("%d/%m/%Y %H:%M") if claim.incident_date_time else "—"
    vehicle_str = f"{claim.vehicle_year or ''} {claim.vehicle_make or ''} {claim.vehicle_model or ''}".strip() or "—"
    claim_details = [
        ["Claim No.:", claim.complaint_id or "—"],
        ["Policy No.:", claim.policy_number or "—"],
        ["Insured Name:", claim.policy_holder_name or "—"],
        ["Vehicle Name:", f"{vehicle_str} / {claim.vehicle_registration_number or '—'}"],
        ["Policy Type:", claim.coverage_type or "—"],
        ["Date of Loss:", incident_dt],
        ["Cause of Loss:", claim.incident_type or "—"],
        ["Claimed Amount:", str(evaluation.estimated_amount or evaluation.claim_amount or "—") if evaluation else "—"],
        ["Recommendation:", (evaluation.decision or "—") if evaluation else "—"],
    ]
    if claim.incident_description:
        claim_details.insert(7, ["Description:", (claim.incident_description or "—")[:80]])
    t1 = _table_style_header_blue([["Field", "Value"]] + claim_details)
    story.append(KeepTogether([_section_heading("1. Claim Details"), t1, _sp()]))

    # ----- 2. Policy Coverage Review -----
    policy_start = claim.policy_start_date.strftime("%d/%m/%Y") if claim.policy_start_date else "—"
    policy_end = claim.policy_end_date.strftime("%d/%m/%Y") if claim.policy_end_date else "—"
    policy_coverage = [
        ["Policy Type:", claim.coverage_type or "—"],
        ["Policy period:", f"{policy_start} - {policy_end}"],
        ["Policy active at time of loss:", "Yes" if (claim.policy_status or "").lower() == "active" else "No"],
        ["Policy Status:", claim.policy_status or "—"],
    ]
    t2 = _table_style_header_blue([["Policy Status", "Value"]] + policy_coverage)
    story.append(KeepTogether([_section_heading("2. Policy Coverage Review", use_orange=True), t2, _sp()]))

    # ----- 3. Documents Submitted Review -----
    has_photos = claim.damage_photos.exists()
    documents_review = [
        ["Claim form / details completed", "Yes"],
        ["Copy of policy schedule", "Yes" if claim.policy_number else "—"],
        ["Photos of damage", "Yes" if has_photos else "No"],
        ["Vehicle / registration details", "Yes" if claim.vehicle_registration_number else "—"],
    ]
    t3 = _table_style_header_blue([["Document", "Yes/No"]] + documents_review)
    story.append(KeepTogether([_section_heading("3. Documents Submitted Review"), t3, _sp()]))

    # ----- 4. Business Rule Validation (Fraud Evaluation) -----
    # Wider Validation Check column, narrower Status column
    rules = fraud_result.get("fraud_rule_results") or []
    if rules:
        rule_rows = [["Validation Check", "Status"]]
        fail_row_indexes: list[int] = []
        fail_status_style = ParagraphStyle(
            name="BrvFailStatus",
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            textColor=colors.HexColor("#B91C1C"),  # red-700-ish
            wordWrap="Normal",
        )
        for r in rules:
            rule_type = r.get("rule_type") or "Rule"
            rule_desc = (r.get("rule_description") or "")
            passed = r.get("passed", False)
            status_cell = (
                "Pass" if passed else Paragraph("Fail", fail_status_style)
            )
            if not passed:
                # +1 because Table row 0 is the header.
                fail_row_indexes.append(len(rule_rows))
            rule_rows.append([f"{rule_type}: {rule_desc}", status_cell])
        t4 = _table_style_header_blue(
            rule_rows,
            col_widths=[_REPORT_TABLE_VALIDATION_COL, _REPORT_TABLE_STATUS_COL],
        )
        if fail_row_indexes:
            t4.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, idx), (-1, idx), colors.HexColor("#FCE8E6"))
                        for idx in fail_row_indexes
                    ]
                )
            )
    else:
        t4 = _table_style_header_blue(
            [["Validation Check", "Status"], ["No rules evaluated", "—"]],
            col_widths=[_REPORT_TABLE_VALIDATION_COL, _REPORT_TABLE_STATUS_COL],
        )
    story.append(KeepTogether([_section_heading("4. Business Rule Validation", use_orange=True), t4, _sp()]))

    if dash_after_section == 4:
        dash_style = ParagraphStyle(
            name="DashSeparator",
            fontName="Helvetica",
            fontSize=9,
            leading=11,
            textColor=colors.HexColor("#6B7280"),  # slate-ish
            alignment=0,
            spaceAfter=6,
        )
        story.append(Paragraph("—" * 110, dash_style))
        story.append(_sp())

    if max_section <= 4:
        doc.build(story)
        buffer.seek(0)
        return buffer.read()

    # ----- 5. Media Trust & Duplicate Review -----
    top_fraud_result = fraud_rows[0] if fraud_rows else None
    max_fraud_score = round(
        max((_safe_report_float(row.fraud_score) for row in fraud_rows), default=0.0),
        2,
    )
    avg_fraud_score = round(
        sum(_safe_report_float(row.fraud_score) for row in fraud_rows) / len(fraud_rows),
        2,
    ) if fraud_rows else 0.0
    high_risk_count = sum(
        1 for row in fraud_rows if _safe_report_float(row.fraud_score) >= 60
    )
    exif_warnings = sorted(
        {
            warning
            for row in fraud_rows
            for warning in ((row.exif_json or {}).get("warnings") or [])
            if warning
        }
    )
    top_duplicate = duplicate_rows[0] if duplicate_rows else None
    media_rows = [
        ["Photos Screened", str(len(fraud_rows))],
        ["Highest Fraud Score", str(int(round(max_fraud_score))) if fraud_rows else "0"],
        ["Average Fraud Score", str(int(round(avg_fraud_score))) if fraud_rows else "0"],
        ["High-risk Images", str(high_risk_count)],
    ]
    if exif_warnings:
        media_rows.append(["Metadata Warnings", _truncate_report_text(", ".join(exif_warnings))])
    if top_duplicate:
        media_rows.extend([
            ["Strongest Duplicate Match", top_duplicate.other_complaint_id],
            ["Duplicate Match Reason", _truncate_report_text(top_duplicate.match_reason.replace(",", ", "))],
            ["Duplicate Similarity", f"{_safe_report_float(top_duplicate.similarity_score):.0f}%"],
        ])
    if top_fraud_result and top_fraud_result.llm_authenticity_notes:
        reviewer_safe_note = sanitize_reviewer_llm_notes(
            top_fraud_result.llm_authenticity_notes,
            complaint_id=claim.complaint_id,
            photo_path=top_fraud_result.photo_path,
        )
        if reviewer_safe_note:
            media_rows.append(
                ["Authenticity Note", _truncate_report_text(reviewer_safe_note)]
            )
    t5 = _table_style_header_blue([["Item", "Value"]] + media_rows)
    story.append(KeepTogether([_section_heading("5. Media Trust & Duplicate Review", use_orange=True), t5, _sp()]))

    # ----- 6. Damage Assessment & Part-Level Breakdown -----
    damages_str = _pdf_damages_detected_str(evaluation, part_rows)
    severity_str = _pdf_damage_severity_str(evaluation)

    currency_code = (
        valuation.currency_code
        if valuation and valuation.currency_code
        else get_claim_market_context(claim=claim)["currency_code"]
    ) or "THB"
    part_total = round(sum(_safe_report_float(row.estimated_amount) for row in part_rows), 2)
    gross_estimate = _safe_report_float(
        valuation.gross_estimate if valuation and valuation.gross_estimate is not None else (
            part_total if part_rows else (evaluation.estimated_amount or evaluation.claim_amount if evaluation else 0)
        )
    )
    computed_excess = _safe_report_float(
        valuation.excess_amount if valuation and valuation.excess_amount is not None else 0
    )
    policy_excess = _safe_report_float(claim.excess_amount) if claim.excess_amount is not None else 0.0
    net_payable = _safe_report_float(
        valuation.net_payable if valuation and valuation.net_payable is not None else (
            evaluation.claim_amount if evaluation else max(0, gross_estimate - computed_excess)
        )
    )
    damage_summary_rows = [
        ["Damage Confidence (%)", str(evaluation.damage_confidence or 0) if evaluation else "—"],
        ["Damages Detected", damages_str],
        ["Damage Severity", severity_str],
        ["Part Rows", str(len(part_rows))],
        ["Line-item Total", f"{part_total:,.2f} {currency_code}" if part_rows else "—"],
    ]
    t6_summary = _table_style_header_blue([["Item", "Value"]] + damage_summary_rows)
    story.append(KeepTogether([_section_heading("6. Damage Assessment & Part-Level Breakdown"), t6_summary]))
    story.append(Spacer(1, 0.12 * inch))

    # Same total width as Item/Value tables (2.5" + 4.0") so section 6 blocks align visually.
    _part_table_total_w = _REPORT_TABLE_FIRST_COL + _REPORT_TABLE_SECOND_COL
    _part_col_fracs = [1.55, 1.2, 0.85, 1.45, 1.15]
    _part_col_sum = sum(_part_col_fracs)
    part_col_widths = [_part_table_total_w * (f / _part_col_sum) for f in _part_col_fracs]

    if part_rows:
        part_table_rows = [
            ["Part", "Damage", "Part damage score (0–100)", "Action", f"Amount ({currency_code})"]
        ]
        for row in part_rows[:12]:
            part_table_rows.append(
                [
                    row.part_name or "—",
                    row.damage_type or "—",
                    f"{_safe_report_float(row.severity_percent):.0f}%",
                    row.repair_action or "—",
                    f"{_safe_report_float(row.estimated_amount):,.2f}",
                ]
            )
        if len(part_rows) > 12:
            part_table_rows.append(
                [f"{len(part_rows) - 12} more row(s) omitted", "—", "—", "—", "—"]
            )
        t6_parts = _table_style_header_blue(
            part_table_rows,
            col_widths=part_col_widths,
            row_height=_REPORT_TABLE_ROW_HEIGHT,
        )
    else:
        t6_parts = _table_style_header_blue(
            [
                [
                    "Part",
                    "Damage",
                    "Part damage score (0–100)",
                    "Action",
                    f"Amount ({currency_code})",
                ],
                ["No part-level damage rows saved", "—", "—", "—", "—"],
            ],
            col_widths=part_col_widths,
            row_height=_REPORT_TABLE_ROW_HEIGHT,
        )
    story.append(t6_parts)
    story.append(_sp())

    # ----- 7. Valuation Summary -----
    minimum_no_damage_gross = get_pricing_config_decimal(
        "MINIMUM_NO_DAMAGE_GROSS_ESTIMATE"
    )
    minimum_applied = bool(
        not part_rows
        and minimum_no_damage_gross is not None
        and _safe_report_float(gross_estimate) > 0
        and abs(_safe_report_float(gross_estimate) - _safe_report_float(minimum_no_damage_gross)) < 0.01
    )
    valuation_rows = [
        ["Currency", currency_code],
        ["Gross Estimate", f"{gross_estimate:,.2f} {currency_code}"],
        ["Line-item Total", f"{part_total:,.2f} {currency_code}" if part_rows else "—"],
        [
            "Cross-check Status",
            "Aligned" if (part_rows and abs(part_total - gross_estimate) < 0.01) else (
                "No part rows" if not part_rows else "Review needed"
            ),
        ],
        [
            "Minimum base estimate applied",
            f"Yes ({_safe_report_float(minimum_no_damage_gross):,.2f} {currency_code})"
            if minimum_applied
            else "No",
        ],
        ["Computed Excess", f"{computed_excess:,.2f} {currency_code}"],
        ["Policy Excess (FNOL)", f"{policy_excess:,.2f} {currency_code}" if claim.excess_amount is not None else "—"],
        ["Net Payable", f"{net_payable:,.2f} {currency_code}"],
        ["Part Count", str(len(part_rows))],
    ]
    t7 = _table_style_header_blue([["Field", "Value"]] + valuation_rows)
    story.append(KeepTogether([_section_heading("7. Valuation Summary", use_orange=True), t7, _sp()]))

    # ----- 8. Claim Evaluation / Final Recommendation -----
    assessment_flags = []
    if max_fraud_score >= 60:
        assessment_flags.append(f"High fraud score {int(round(max_fraud_score))}")
    if top_duplicate:
        assessment_flags.append(f"Duplicate match {top_duplicate.other_complaint_id}")
    if not assessment_flags:
        assessment_flags.append("No material media alerts")

    if evaluation:
        eval_rows = [
            ["Decision", evaluation.decision or "—"],
            ["Claim Status", evaluation.claim_status or "—"],
            ["Claim Type", evaluation.claim_type or "—"],
            ["Recommended Net Payable", f"{net_payable:,.2f} {currency_code}"],
            ["Assessment Evidence Summary", _truncate_report_text("; ".join(assessment_flags))],
        ]
        if evaluation.reason:
            eval_rows.append(["Conclusion", _truncate_report_text(evaluation.reason, 180)])
        if evaluation.created_date:
            eval_rows.append(["Evaluated On", evaluation.created_date.strftime("%d/%m/%Y %H:%M")])
        t8 = _table_style_header_blue([["Field", "Value"]] + eval_rows)
    else:
        t8 = _table_style_header_blue([["Field", "Value"], ["—", "—"]])
    story.append(KeepTogether([_section_heading("8. Final Recommendation", use_orange=True), t8]))

    doc.build(story)
    buffer.seek(0)
    return buffer.read()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def recommendation_report_pdf(request, complaint_id: str):
    """
    Generate and return MOTOR CLAIM RECOMMENDATION REPORT as PDF.
    Available when the claim has completed persisted damage assessment (and/or) reached
    the recommendation phase — aligned with the React "Generate Recommendation Report" gate,
    not only the literal human-readable string "Recommendation shared".
    Contains: business-rule validation, media trust and duplicate evidence, part-level damage
    breakdown, valuation summary, and final recommendation.
    """
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    evaluation = ClaimEvaluationResponse.objects.filter(
        complaint_id=complaint_id,
        is_latest=True,
    ).first()
    if not evaluation:
        return Response(
            {"detail": "No evaluation found for this claim."},
            status=status.HTTP_404_NOT_FOUND,
        )
    status_name = effective_claim_status(claim, evaluation)
    status_norm = " ".join((status_name or "").strip().lower().split())
    workflow_state = compute_claim_workflow_state(complaint_id)
    pdf_allowed = (
        workflow_state in ("DAMAGE_ASSESSMENT_COMPLETED", "RECOMMENDATION_SHARED")
        or status_norm == "recommendation shared"
        or status_norm in ("closed damage detection", "closed_damage_detection")
        or claim_status_implies_recommendation_terminal(status_name)
        or claim_status_implies_recommendation_terminal(
            (evaluation.claim_status or "").strip()
        )
    )
    if not pdf_allowed:
        return Response(
            {
                "detail": (
                    "Recommendation report is only available after damage assessment "
                    "has produced persisted results and the claim has reached the recommendation "
                    "phase (or equivalent terminal status)."
                ),
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    raw_response = _fnol_claim_to_raw_response(claim)
    fraud_result = _run_process_claim_logic(raw_response)
    pdf_bytes = _build_recommendation_report_pdf(claim, evaluation, fraud_result)
    filename = f"Motor_Claim_Recommendation_Report_{complaint_id}.pdf"
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def business_rule_validation_report_pdf(request, complaint_id: str):
    """
    Generate and return a BRV-only PDF report (sections 1–4).
    Intended for reviewers to download the Business Rule Validation table without
    requiring persisted damage assessment / recommendation state.
    """
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    evaluation = ClaimEvaluationResponse.objects.filter(
        complaint_id=complaint_id,
        is_latest=True,
    ).first()
    if not evaluation:
        return Response(
            {"detail": "No evaluation found for this claim."},
            status=status.HTTP_404_NOT_FOUND,
        )

    workflow_state = compute_claim_workflow_state(complaint_id)
    if workflow_state not in (
        "BUSINESS_RULE_VALIDATION_COMPLETED",
        "DAMAGE_ASSESSMENT_IN_PROGRESS",
        "DAMAGE_ASSESSMENT_COMPLETED",
        "RECOMMENDATION_SHARED",
    ):
        return Response(
            {"detail": "BRV report is only available after Business Rule Validation has completed."},
            status=status.HTTP_403_FORBIDDEN,
        )

    raw_response = _fnol_claim_to_raw_response(claim)
    fraud_result = _run_process_claim_logic(raw_response)
    pdf_bytes = _build_recommendation_report_pdf(
        claim,
        evaluation,
        fraud_result,
        max_section=4,
    )
    filename = f"Motor_Claim_BRV_Report_{complaint_id}.pdf"
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def business_rule_validation_failed_report_pdf(request, complaint_id: str):
    """
    Generate and return a "failed BRV" PDF report.

    Includes the full report sections, but inserts a dash separator line directly
    below the "4. Business Rule Validation" table to make the failure boundary obvious.
    """
    claim = get_object_or_404(FnolClaim, complaint_id=complaint_id)
    evaluation = ClaimEvaluationResponse.objects.filter(
        complaint_id=complaint_id,
        is_latest=True,
    ).first()
    if not evaluation:
        return Response(
            {"detail": "No evaluation found for this claim."},
            status=status.HTTP_404_NOT_FOUND,
        )

    workflow_state = compute_claim_workflow_state(complaint_id)
    if workflow_state not in (
        "BUSINESS_RULE_VALIDATION_COMPLETED",
        "DAMAGE_ASSESSMENT_IN_PROGRESS",
        "DAMAGE_ASSESSMENT_COMPLETED",
        "RECOMMENDATION_SHARED",
    ):
        return Response(
            {"detail": "Failed report is only available after Business Rule Validation has completed."},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Only meaningful when BRV failed.
    if (evaluation.claim_status or "").strip().lower() in ("", "recommendation shared"):
        # claim_status is not a reliable BRV indicator; rely on persisted rule snapshot when available.
        pass
    # If the latest persisted BRV snapshot exists and any rule failed, allow; otherwise block to avoid confusion.
    rules_snapshot = evaluation.fraud_rule_results
    if isinstance(rules_snapshot, list) and rules_snapshot:
        any_failed = any(r and (r.get("passed") is False) for r in rules_snapshot if isinstance(r, dict))
        if not any_failed:
            return Response(
                {"detail": "Failed report is only available when Business Rule Validation has failed."},
                status=status.HTTP_403_FORBIDDEN,
            )

    raw_response = _fnol_claim_to_raw_response(claim)
    fraud_result = _run_process_claim_logic(raw_response)
    pdf_bytes = _build_recommendation_report_pdf(
        claim,
        evaluation,
        fraud_result,
        max_section=8,
    )
    filename = f"Motor_Claim_Failed_BRV_Report_{complaint_id}.pdf"
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    """
    Lightweight liveness + DB connectivity check.
    Returns { status: "ok"|"degraded", db: "ok"|"error", db_error: "..." }
    Always responds quickly; never waits more than MYSQL_CONNECT_TIMEOUT.
    """
    import time as _time
    db_status = "ok"
    db_error = None
    t0 = _time.perf_counter()
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
    except Exception as exc:
        db_status = "error"
        db_error = str(exc)
    db_ms = round((_time.perf_counter() - t0) * 1000)
    overall = "ok" if db_status == "ok" else "degraded"
    payload = {
        "status": overall,
        "db": db_status,
        "db_response_ms": db_ms,
    }
    if db_error:
        payload["db_error"] = db_error
    http_status = status.HTTP_200_OK if overall == "ok" else status.HTTP_503_SERVICE_UNAVAILABLE
    return Response(payload, status=http_status)
