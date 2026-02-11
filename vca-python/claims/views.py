import random
import re
from typing import Optional, Tuple

from django.contrib.auth import authenticate
from django.contrib.auth.models import User, Group
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import (
    ClaimRuleMaster,
    ClaimTypeMaster,
    DamageCodeMaster,
    FnolResponse,
    Claim,
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
)


def _is_admin_user(user) -> bool:
    """True if user can perform admin actions: Django staff or in 'Admin' group."""
    if user.is_staff:
        return True
    return user.groups.filter(name__iexact="admin").exists()


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
@permission_classes([IsAuthenticated])
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

