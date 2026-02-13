"""
Django REST Framework views for Vehicle Damage Assessment API.
"""
import json
import os
import traceback
from urllib.parse import urlparse
from urllib.request import urlopen, Request

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .services import (
    allowed_file,
    run_damage_assessment,
    DAMAGE_DETECTION_MODEL,
    API_SEVERITY,
    TRAINED_SEVERITY,
    WORK_DIR,
)

# Max size for fetched images (10 MB)
MAX_IMAGE_SIZE = 10 * 1024 * 1024


def _get_image_url_from_request(request):
    """Extract image_url from JSON body or form data."""
    image_url = None
    if request.content_type and "application/json" in request.content_type:
        try:
            data = request.data
            if isinstance(data, dict):
                image_url = data.get("image_url") or data.get("imageUrl")
        except Exception:
            pass
    if not image_url:
        image_url = request.data.get("image_url") or request.POST.get("image_url")
    return image_url


def _fetch_image_from_url(image_url):
    """
    Fetch image from URL and return local file path.
    Raises ValueError on invalid URL or fetch failure.
    """
    parsed = urlparse(image_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http and https URLs are allowed.")

    req = Request(image_url, headers={"User-Agent": "VehicleClaimAutomation/1.0"})
    with urlopen(req, timeout=30) as resp:
        content_type = resp.headers.get("Content-Type", "").lower()
        if "image" not in content_type and "octet-stream" not in content_type:
            raise ValueError(f"URL did not return an image (Content-Type: {content_type})")
        data = resp.read(MAX_IMAGE_SIZE + 1)
        if len(data) > MAX_IMAGE_SIZE:
            raise ValueError("Image too large.")
        if len(data) == 0:
            raise ValueError("Empty response from URL.")

    os.makedirs(WORK_DIR, exist_ok=True)
    input_path = os.path.join(WORK_DIR, "damage_input.jpg")
    with open(input_path, "wb") as f:
        f.write(data)
    return input_path


def _get_claim_id_and_images(request):
    """Extract claim_id and images array from JSON body."""
    if request.content_type and "application/json" in request.content_type:
        try:
            data = request.data
            if isinstance(data, dict):
                claim_id = data.get("claim_id")
                images = data.get("images")
                if isinstance(images, list) and len(images) > 0:
                    return claim_id, images
        except Exception:
            pass
    return None, None


@api_view(["POST"])
@permission_classes([AllowAny])  # Adjust to IsAuthenticated if needed
def damage_assessment(request):
    """
    Accept POST with claim_id and images, or image_url, or multipart form with 'image' file.
    - JSON: {"claim_id": "CLM-001", "images": ["http://...", "http://..."]}
    - JSON: {"image_url": "http://example.com/image.jpg"}
    - Form: image_url=http://example.com/image.jpg
    Returns damages (list) and severity (str).
    """
    input_path = None

    # 1. Try claim_id and images array (for Damage Detection from Claim Detail)
    claim_id, images = _get_claim_id_and_images(request)
    if images:
        # Use first image for damage assessment (or process all and aggregate)
        first = images[0]
        image_url = (
            first
            if isinstance(first, str)
            else (
                first.get("url") or first.get("image", {}).get("url")
                if isinstance(first, dict)
                else None
            )
        )
        if image_url:
            try:
                input_path = _fetch_image_from_url(image_url.strip())
            except ValueError as e:
                return Response(
                    {"error": str(e)},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Exception as e:
                return Response(
                    {"error": f"Failed to fetch image from URL: {str(e)}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    # 2. Fallback: Try image_url from metadata (JSON or form)
    if not input_path:
        image_url = _get_image_url_from_request(request)
    if not input_path and image_url:
        if not isinstance(image_url, str) or not image_url.strip():
            return Response(
                {"error": "image_url must be a non-empty string."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            input_path = _fetch_image_from_url(image_url.strip())
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            return Response(
                {"error": f"Failed to fetch image from URL: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # 2. Fallback: image file upload
    if not input_path and "image" in request.FILES:
        image_file = request.FILES["image"]
        if not allowed_file(image_file.name):
            return Response(
                {"error": "Invalid file type. Only png, jpg, jpeg, webp allowed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        os.makedirs(WORK_DIR, exist_ok=True)
        input_path = os.path.join(WORK_DIR, "damage_input.jpg")
        try:
            with open(input_path, "wb") as f:
                for chunk in image_file.chunks():
                    f.write(chunk)
        except Exception as e:
            return Response(
                {"error": f"Failed to save image: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    if not input_path:
        return Response(
            {
                "error": "Provide claim_id and images, image_url in metadata (JSON or form), or upload an image file."
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not os.path.exists(DAMAGE_DETECTION_MODEL):
        return Response(
            {"error": f"Damage model not found: {DAMAGE_DETECTION_MODEL}"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        damages, severity = run_damage_assessment(input_path)
        response_data = {"damages": damages, "severity": severity}

        # Persist LLM response, estimate price from PricingConfig, update claim status when claim_id provided
        if claim_id and isinstance(claim_id, str) and claim_id.strip():
            complaint_id = claim_id.strip()
            try:
                from claims.models import ClaimEvaluationResponse, FnolClaim
                from claims.views import estimate_claim_amount_from_config

                latest = (
                    ClaimEvaluationResponse.objects.filter(complaint_id=complaint_id)
                    .order_by("-created_date")
                    .first()
                )
                if latest:
                    damages_json = json.dumps(damages) if damages else None
                    severity_str = str(severity)[:20] if severity else None
                    latest.llm_damages = damages_json
                    latest.llm_severity = severity_str

                    # Estimate claim_amount from PricingConfig based on damages and severity
                    base_amount = float(latest.estimated_amount or 0)
                    claim_amount = estimate_claim_amount_from_config(
                        damages or [], severity_str or "", base_amount
                    )
                    latest.claim_amount = claim_amount
                    response_data["claim_amount"] = claim_amount

                    # Determine decision and claim_status from LLM: ID 5=Close+Auto, ID 6=Close+Manual
                    severity_lower = (severity_str or "").strip().lower()
                    if severity_lower in ("minor", "moderate") and damages and str(damages[0]).lower() != "none":
                        decision = "Auto Approve"
                        status_id = 5  # Close and Auto Review
                    else:
                        decision = "Manual Review"
                        status_id = 6  # Close and Manual Review

                    latest.decision = decision[:20]
                    latest.claim_status = "Closed"
                    latest.save(
                        update_fields=[
                            "llm_damages",
                            "llm_severity",
                            "claim_amount",
                            "decision",
                            "claim_status",
                            "updated_date",
                        ]
                    )

                    # Update fnol_claims.claim_status to ID 5 or 6
                    fnol_claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
                    if fnol_claim:
                        from claims.models import ClaimStatus

                        new_status = ClaimStatus.objects.filter(pk=status_id).first()
                        if new_status:
                            fnol_claim.claim_status = new_status
                            fnol_claim.save(update_fields=["claim_status"])
            except Exception as persist_err:
                # Log but don't fail the request; LLM result still returned
                traceback.print_exc()

        return Response(response_data)
    except Exception as e:
        return Response(
            {
                "error": f"Damage detection failed: {str(e)}",
                "traceback": traceback.format_exc(),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """
    Health check endpoint showing model availability.
    """
    return Response(
        {
            "status": "ok",
            "models": {
                "damage": os.path.exists(DAMAGE_DETECTION_MODEL),
                "severity_trained": os.path.exists(TRAINED_SEVERITY),
                "severity_api": os.path.exists(API_SEVERITY),
            },
        }
    )
