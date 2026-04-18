"""
Django REST Framework views for Vehicle Damage Assessment API.
"""
import ipaddress
import json
import logging
import os
import socket
import uuid
from urllib.parse import urlparse

import requests

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from claim_automation.vca_config import cfg as _vca_cfg
from claims.decisioning import sync_claim_evaluation_decision_state

logger = logging.getLogger(__name__)

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

# Small upper bound to avoid long redirect chains / SSRF tricks.
MAX_REDIRECTS = 0


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


def _image_fetch_hostname_allowed(image_url: str) -> bool:
    allow = getattr(settings, "DAMAGE_ASSESSMENT_IMAGE_FETCH_ALLOWED_HOSTS", None) or []
    if not allow:
        return True
    parsed = urlparse(image_url)
    host = (parsed.hostname or "").lower()
    for allowed_host in allow:
        allowed_host = (allowed_host or "").strip().lower()
        if not allowed_host:
            continue
        if host == allowed_host or host.endswith(f".{allowed_host}"):
            return True
    return False


def _allow_private_image_fetch_hosts() -> bool:
    return bool(
        getattr(settings, "DAMAGE_ASSESSMENT_IMAGE_FETCH_ALLOW_PRIVATE_HOSTS", False)
    )


def _resolve_hostname_ips(hostname: str) -> list[str]:
    """Resolve a hostname to unique IP strings for SSRF validation."""
    ips: list[str] = []
    seen: set[str] = set()
    for family, _socktype, _proto, _canonname, sockaddr in socket.getaddrinfo(
        hostname, None, type=socket.SOCK_STREAM
    ):
        if family == socket.AF_INET:
            ip = sockaddr[0]
        elif family == socket.AF_INET6:
            ip = sockaddr[0]
        else:
            continue
        if ip not in seen:
            seen.add(ip)
            ips.append(ip)
    return ips


def _ip_is_private_or_restricted(ip_str: str) -> bool:
    ip = ipaddress.ip_address(ip_str)
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    )


def _validate_remote_image_url(image_url: str) -> tuple[str, str]:
    """
    Validate a remote image URL before any outbound fetch.

    Returns `(validated_url, hostname)` if allowed, otherwise raises ValueError.
    """
    parsed = urlparse(image_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http and https URLs are allowed.")
    if parsed.username or parsed.password:
        raise ValueError("Image URLs with embedded credentials are not allowed.")

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise ValueError("Image URL must include a hostname.")

    if not _image_fetch_hostname_allowed(image_url):
        raise ValueError(
            "Image URL host is not allowed. Set DAMAGE_ASSESSMENT_IMAGE_FETCH_ALLOWED_HOSTS "
            "to a comma-separated list of permitted hostnames."
        )

    try:
        resolved_ips = _resolve_hostname_ips(hostname)
    except socket.gaierror as exc:
        raise ValueError("Image URL hostname could not be resolved.") from exc

    if not resolved_ips:
        raise ValueError("Image URL hostname did not resolve to an address.")

    if not _allow_private_image_fetch_hosts():
        blocked_ips = [ip for ip in resolved_ips if _ip_is_private_or_restricted(ip)]
        if blocked_ips:
            raise ValueError(
                "Image URL resolved to a private or restricted network address. "
                "Set DAMAGE_ASSESSMENT_IMAGE_FETCH_ALLOW_PRIVATE_HOSTS=True only for trusted local media hosts."
            )

    return image_url, hostname


def _new_damage_input_path(suffix: str = ".jpg") -> str:
    """Generate a unique work-file path for fetched or uploaded images."""
    os.makedirs(WORK_DIR, exist_ok=True)
    return os.path.join(WORK_DIR, f"damage_input_{uuid.uuid4().hex}{suffix}")


def _fetch_image_from_url(image_url, dest_path=None):
    """
    Fetch image from URL and write to dest_path or a secure temp file in WORK_DIR.
    Raises ValueError on invalid URL or fetch failure.
    """
    image_url, _hostname = _validate_remote_image_url(image_url)

    response = requests.get(
        image_url,
        headers={"User-Agent": "VehicleClaimAutomation/1.0"},
        timeout=_vca_cfg.image_fetch_timeout_s,
        stream=True,
        allow_redirects=MAX_REDIRECTS > 0,
    )
    try:
        if response.is_redirect or response.is_permanent_redirect:
            raise ValueError("Redirecting image URLs are not allowed.")
        response.raise_for_status()

        content_type = (response.headers.get("Content-Type") or "").lower()
        if "image" not in content_type and "octet-stream" not in content_type:
            raise ValueError(
                f"URL did not return an image (Content-Type: {content_type or 'unknown'})"
            )

        content_length = response.headers.get("Content-Length")
        if content_length:
            try:
                if int(content_length) > MAX_IMAGE_SIZE:
                    raise ValueError("Image too large.")
            except ValueError:
                if content_length.isdigit():
                    raise

        input_path = dest_path or _new_damage_input_path()
        out_dir = os.path.dirname(input_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

        total = 0
        with open(input_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_IMAGE_SIZE:
                    raise ValueError("Image too large.")
                f.write(chunk)

        if total == 0:
            raise ValueError("Empty response from URL.")
    finally:
        response.close()
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
@permission_classes([IsAuthenticated])
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
            try:
                dest = _new_damage_input_path()
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
        input_path = _new_damage_input_path()
        try:
            with open(input_path, "wb") as f:
                for chunk in image_file.chunks():
                    f.write(chunk)
            assessment_jobs = [(input_path, None)]
        except Exception as e:
            return Response(
                {"error": "Failed to save image."},
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

                    # Persist LLM/valuation fields only — do not advance FNOL or evaluation
                    # workflow to "Recommendation shared" from this endpoint; that must follow
                    # Business Rule Validation and the Phase 1 pipeline.
                    latest.save(
                        update_fields=[
                            "llm_damages",
                            "llm_severity",
                            "claim_amount",
                            "threshold_value",
                            "claim_type",
                            "updated_date",
                        ]
                    )
                    sync_claim_evaluation_decision_state(
                        complaint_id=complaint_id,
                        latest_eval=latest,
                    )

                    # Policy excess on FnolClaim is source FNOL data, not derived DA output.
                    # Phase-1 financials are persisted separately on ClaimPhase1Valuation.
            except Exception:
                logger.exception("damage_assessment persist failed")

        return Response(response_data)
    except Exception:
        logger.exception("damage_assessment failed")
        # Never expose traceback or internal details to client
        return Response(
            {"error": "Damage detection failed."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
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
