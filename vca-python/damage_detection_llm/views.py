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


def _fetch_image_from_url(image_url, dest_path=None):
    """
    Fetch image from URL and write to dest_path or WORK_DIR/damage_input.jpg.
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
    input_path = dest_path or os.path.join(WORK_DIR, "damage_input.jpg")
    out_dir = os.path.dirname(input_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(input_path, "wb") as f:
        f.write(data)
    return input_path


def _resolve_image_url_from_item(item):
    """Extract a URL string from an images[] entry (str or { url } / { image: { url } })."""
    if isinstance(item, str):
        s = item.strip()
        return s if s else None
    if isinstance(item, dict):
        u = item.get("url") or item.get("image", {}).get("url")
        if isinstance(u, str) and u.strip():
            return u.strip()
    return None


_SEVERITY_RANK = {"unknown": 0, "minor": 1, "moderate": 2, "severe": 3}


def _merge_severities(severities):
    """Pick the worst severity across images (severe > moderate > minor > unknown)."""
    best_key = "unknown"
    best_r = 0
    for s in severities:
        key = (s or "unknown").strip().lower()
        if key not in _SEVERITY_RANK:
            key = "unknown"
        r = _SEVERITY_RANK[key]
        if r > best_r:
            best_r = r
            best_key = key
    return best_key


def _merge_damage_lists(damage_lists):
    """Union of damage labels, preserving first-seen order (by image order)."""
    out = []
    seen = set()
    for lst in damage_lists:
        for d in lst or []:
            if d not in seen:
                seen.add(d)
                out.append(d)
    return out


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
      All images are assessed; damages are merged (unique, order preserved), severity is worst-of.
    - JSON: {"image_url": "http://example.com/image.jpg"}
    - Form: image_url=http://example.com/image.jpg
    Returns damages (list), severity (str), claim_amount, images_assessed.
    """
    assessment_jobs = []  # list of (local_path, url_hint)

    claim_id, images = _get_claim_id_and_images(request)
    if images:
        urls = []
        for item in images:
            u = _resolve_image_url_from_item(item)
            if u:
                urls.append(u)
        if not urls:
            return Response(
                {"error": "No valid image URLs in images array."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        os.makedirs(WORK_DIR, exist_ok=True)
        fetch_errors = []
        for idx, image_url in enumerate(urls):
            dest = os.path.join(WORK_DIR, f"damage_input_{idx}.jpg")
            try:
                _fetch_image_from_url(image_url, dest_path=dest)
                assessment_jobs.append((dest, image_url))
            except ValueError as e:
                fetch_errors.append(str(e))
            except Exception as e:
                fetch_errors.append(f"Failed to fetch image from URL: {str(e)}")
        if not assessment_jobs:
            return Response(
                {
                    "error": "Could not fetch any images from the provided URLs.",
                    "details": fetch_errors,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

    image_url = None
    if not assessment_jobs:
        image_url = _get_image_url_from_request(request)
    if not assessment_jobs and image_url:
        if not isinstance(image_url, str) or not image_url.strip():
            return Response(
                {"error": "image_url must be a non-empty string."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            os.makedirs(WORK_DIR, exist_ok=True)
            path = _fetch_image_from_url(image_url.strip())
            assessment_jobs = [(path, image_url.strip())]
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

    if not assessment_jobs and "image" in request.FILES:
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
            assessment_jobs = [(input_path, None)]
        except Exception as e:
            return Response(
                {"error": f"Failed to save image: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    if not assessment_jobs:
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
        incident_description = None
        flood_coverage = False
        if claim_id and isinstance(claim_id, str) and claim_id.strip():
            from claims.models import FnolClaim
            fnol = FnolClaim.objects.filter(complaint_id=claim_id.strip()).first()
            if fnol:
                incident_description = fnol.incident_description
                flood_coverage = bool(getattr(fnol, "flood_coverage", False))
        if not incident_description and isinstance(request.data, dict):
            incident_description = request.data.get("incident_description") or request.data.get("incidentDescription")
        damage_lists = []
        severities = []
        for input_path, image_url_for_hint in assessment_jobs:
            d, s = run_damage_assessment(
                input_path,
                incident_description=incident_description,
                flood_coverage=flood_coverage,
                image_url=image_url_for_hint,
            )
            damage_lists.append(d if d is not None else [])
            severities.append(s if s is not None else "unknown")

        damages = _merge_damage_lists(damage_lists)
        severity = _merge_severities(severities)
        images_assessed = len(assessment_jobs)

        severity_str = (severity or "").strip()[:20] if severity else ""

        # Always include claim_amount: compute from PricingConfig (base + damages * rate) * severity multiplier
        try:
            from claims.views import estimate_claim_amount_from_config

            base_amount = 0.0
            if claim_id and isinstance(claim_id, str) and claim_id.strip():
                from claims.models import ClaimEvaluationResponse

                latest = ClaimEvaluationResponse.objects.filter(
                    complaint_id=claim_id.strip(), is_latest=True
                ).first()
                if latest:
                    base_amount = float(latest.estimated_amount or 0)
            claim_amount = estimate_claim_amount_from_config(
                damages or [], severity_str, base_amount
            )
        except Exception:
            claim_amount = 0.0

        response_data = {
            "damages": damages if damages is not None else [],
            "severity": severity or "unknown",
            "claim_amount": float(claim_amount),
            "images_assessed": images_assessed,
        }

        # Persist LLM response and update claim status when claim_id provided
        if claim_id and isinstance(claim_id, str) and claim_id.strip():
            complaint_id = claim_id.strip()
            try:
                from claims.models import ClaimEvaluationResponse, FnolClaim

                latest = ClaimEvaluationResponse.objects.filter(
                    complaint_id=complaint_id, is_latest=True
                ).first()
                if latest:
                    damages_json = json.dumps(damages) if damages else None
                    latest.llm_damages = damages_json
                    latest.llm_severity = severity_str
                    latest.claim_amount = claim_amount

                    # Set claim_type from LLM severity: Minor→Simple, Moderate→Medium, Severe→Complex
                    severity_lower = (severity_str or "").strip().lower()
                    if severity_lower == "minor":
                        claim_type_name = "SIMPLE"
                    elif severity_lower == "moderate":
                        claim_type_name = "MEDIUM"
                    elif severity_lower == "severe":
                        claim_type_name = "COMPLEX"
                    else:
                        claim_type_name = None
                    if claim_type_name:
                        latest.claim_type = claim_type_name[:20]
                        try:
                            from claims.models import ClaimTypeMaster
                            row = ClaimTypeMaster.objects.filter(
                                claim_type_name__iexact=claim_type_name, is_active=True
                            ).first()
                            if row and row.risk_percentage is not None:
                                latest.threshold_value = int(round(float(row.risk_percentage)))
                        except Exception:
                            pass
                    else:
                        # Fallback: derive from claim_amount if severity not minor/moderate/severe
                        try:
                            from claims.views import _get_claim_type_threshold
                            thr, claim_type_name = _get_claim_type_threshold(
                                {"estimated_amount": claim_amount}
                            )
                            latest.threshold_value = int(round((thr or 0) * 100))
                            if claim_type_name:
                                latest.claim_type = claim_type_name[:20]
                        except Exception:
                            pass

                    # Determine decision and claim_status from LLM; both map to Recommendation shared (id 4)
                    severity_lower = (severity_str or "").strip().lower()
                    def _has_valid_damage(ds):
                        if not ds:
                            return False
                        d0 = ds[0]
                        if isinstance(d0, dict):
                            return (d0.get("damage_type") or "").strip().lower() not in ("", "none")
                        return str(d0).strip().lower() not in ("", "none")

                    if severity_lower in ("minor", "moderate") and _has_valid_damage(damages):
                        decision = "Auto Approve"
                    else:
                        decision = "Manual Review"

                    latest.decision = decision[:20]
                    latest.claim_status = "Recommendation shared"
                    latest.save(
                        update_fields=[
                            "llm_damages",
                            "llm_severity",
                            "claim_amount",
                            "threshold_value",
                            "claim_type",
                            "decision",
                            "claim_status",
                            "updated_date",
                        ]
                    )

                    # Update fnol_claims.claim_status to Recommendation shared and set excess_amount (10% of claim_amount)
                    fnol_claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
                    if fnol_claim:
                        from claims.models import ClaimStatus

                        new_status = ClaimStatus.objects.filter(
                            status_name__iexact="Recommendation shared"
                        ).first()
                        if new_status:
                            fnol_claim.claim_status = new_status
                        # Set/refresh excess_amount as 10% of claim_amount so Claim Evaluation shows correct value
                        try:
                            if claim_amount and float(claim_amount) > 0:
                                fnol_claim.excess_amount = float(claim_amount) * 0.10
                        except Exception:
                            # If anything goes wrong, don't block the main flow; excess_amount can remain unchanged
                            pass
                        update_fields = ["claim_status"]
                        if getattr(fnol_claim, "excess_amount", None) is not None:
                            update_fields.append("excess_amount")
                        fnol_claim.save(update_fields=update_fields)
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
