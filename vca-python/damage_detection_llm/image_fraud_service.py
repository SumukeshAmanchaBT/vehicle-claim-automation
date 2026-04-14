"""
Image fraud detection service (hash, EXIF, ELA, optional LLM authenticity).

Provides EXIF analysis, ELA (Error Level Analysis), perceptual hashing,
and LLM-based authenticity assessment for claim photos.
"""

import hashlib
import io
import json
import logging
from decimal import Decimal
from typing import Optional

from PIL import Image, ExifTags
import numpy as np

from django.conf import settings

logger = logging.getLogger(__name__)
GPS_INFO_TAG = next((tag for tag, name in ExifTags.TAGS.items() if name == "GPSInfo"), 34853)

# Try to import imagehash for perceptual hashing
try:
    import imagehash

    IMAGEHASH_AVAILABLE = True
except ImportError:
    IMAGEHASH_AVAILABLE = False
    logger.warning("imagehash not installed; hash-based duplicate detection disabled.")

# Try to import OpenAI/Azure for LLM authenticity check
try:
    from claim_automation.llm_client import get_chat_completion_client_and_model

    LLM_CLIENT_AVAILABLE = True
except ImportError:
    LLM_CLIENT_AVAILABLE = False


def compute_file_sha256(file_path: str) -> str:
    """Compute SHA-256 hash of file contents."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def analyze_exif_metadata(image_path: str) -> dict:
    """
    Extract and analyze EXIF metadata from image.

    Returns dict with:
    - camera_make, camera_model
    - datetime_original, datetime_digitized
    - gps_latitude, gps_longitude
    - software (editor detection)
    - warnings: list of suspicious indicators
    """
    result = {
        "camera_make": None,
        "camera_model": None,
        "datetime_original": None,
        "datetime_digitized": None,
        "gps_latitude": None,
        "gps_longitude": None,
        "software": None,
        "exif_present": False,
        "warnings": [],
    }

    try:
        with Image.open(image_path) as img:
            exif = img._getexif()
            if not exif:
                result["warnings"].append("No EXIF data found - may be stripped or screenshot")
                return result

            result["exif_present"] = True

            # Map EXIF tags
            for tag_id, value in exif.items():
                tag = ExifTags.TAGS.get(tag_id, tag_id)

                if tag == "Make":
                    result["camera_make"] = str(value).strip()
                elif tag == "Model":
                    result["camera_model"] = str(value).strip()
                elif tag == "DateTimeOriginal":
                    result["datetime_original"] = str(value).strip()
                elif tag == "DateTimeDigitized":
                    result["datetime_digitized"] = str(value).strip()
                elif tag == "Software":
                    result["software"] = str(value).strip()

            # GPS info
            gps_info = exif.get(GPS_INFO_TAG)
            if gps_info:
                def _convert_to_degrees(value):
                    """Convert GPS coordinates to degrees."""
                    d = float(value[0])
                    m = float(value[1])
                    s = float(value[2])
                    return d + (m / 60.0) + (s / 3600.0)

                try:
                    lat_data = gps_info.get(2)  # GPSLatitude
                    lat_ref = gps_info.get(1)   # GPSLatitudeRef
                    lon_data = gps_info.get(4)  # GPSLongitude
                    lon_ref = gps_info.get(3)   # GPSLongitudeRef

                    if lat_data and lat_ref:
                        lat = _convert_to_degrees(lat_data)
                        if lat_ref == "S":
                            lat = -lat
                        result["gps_latitude"] = lat

                    if lon_data and lon_ref:
                        lon = _convert_to_degrees(lon_data)
                        if lon_ref == "W":
                            lon = -lon
                        result["gps_longitude"] = lon
                except Exception:
                    pass

            # Check for warnings
            if result["datetime_original"] and result["datetime_digitized"]:
                if result["datetime_original"] != result["datetime_digitized"]:
                    result["warnings"].append("Original and digitized timestamps differ")

            if result["software"]:
                editors = ["photoshop", "gimp", "lightroom", "canva", "pixelmator"]
                if any(ed in result["software"].lower() for ed in editors):
                    result["warnings"].append(f"Image edited with: {result['software']}")

    except Exception as e:
        logger.exception("EXIF analysis failed")
        result["warnings"].append(f"EXIF read error: {str(e)}")

    return result


def compute_ela_score(image_path: str, quality: int = 90) -> Optional[float]:
    """
    Compute Error Level Analysis (ELA) score.

    Re-encodes image at specified quality and computes difference from original.
    Higher score indicates potential manipulation.

    Returns ELA score 0-100 (higher = more suspicious) or None if failed.
    """
    try:
        original = Image.open(image_path).convert("RGB")

        # Re-encode at specified quality
        buffer = io.BytesIO()
        original.save(buffer, format="JPEG", quality=quality)
        buffer.seek(0)
        recompressed = Image.open(buffer).convert("RGB")

        # Compute difference
        original_array = np.array(original, dtype=np.float32)
        recompressed_array = np.array(recompressed, dtype=np.float32)

        diff = np.abs(original_array - recompressed_array)

        # Normalize to 0-100 scale
        max_diff = np.max(diff)
        if max_diff == 0:
            return 0.0

        # Scale based on average difference across all pixels
        mean_diff = np.mean(diff)
        # Normalize: typical values range 0-50, scale to 0-100
        ela_score = min(100.0, (mean_diff / 255.0) * 100 * 2)

        return round(ela_score, 2)

    except Exception:
        logger.exception("ELA computation failed")
        return None


def compute_image_hashes(image_path: str) -> dict:
    """
    Compute perceptual hashes for image similarity matching.

    Returns dict with:
    - p_hash: Perceptual hash (phash)
    - d_hash: Difference hash (dhash)
    - a_hash: Average hash (ahash)
    """
    result = {
        "p_hash": "",
        "d_hash": "",
        "a_hash": "",
    }

    if not IMAGEHASH_AVAILABLE:
        return result

    try:
        with Image.open(image_path) as img:
            # Convert to RGB for consistent hashing
            img_rgb = img.convert("RGB")

            result["p_hash"] = str(imagehash.phash(img_rgb))
            result["d_hash"] = str(imagehash.dhash(img_rgb))
            result["a_hash"] = str(imagehash.average_hash(img_rgb))

    except Exception:
        logger.exception("Image hash computation failed")

    return result


def hamming_distance(hash1: str, hash2: str) -> int:
    """Compute Hamming distance between two hex hash strings."""
    if not hash1 or not hash2 or len(hash1) != len(hash2):
        return -1
    try:
        int1 = int(hash1, 16)
        int2 = int(hash2, 16)
        xor = int1 ^ int2
        return bin(xor).count("1")
    except ValueError:
        return -1


def hash_similarity(hash1: str, hash2: str) -> float:
    """
    Compute similarity score (0-1) between two hashes.
    1.0 = identical, 0.0 = completely different
    """
    if not hash1 or not hash2:
        return 0.0
    dist = hamming_distance(hash1, hash2)
    if dist < 0:
        return 0.0
    # pHash is 64 bits
    max_bits = len(hash1) * 4  # hex char = 4 bits
    return 1.0 - (dist / max_bits)


def llm_authenticity_analysis(image_path: str, exif_data: dict) -> dict:
    """
    Use LLM vision model to assess image authenticity.

    Returns dict with:
    - is_authentic: bool (assessment)
    - confidence: float (0-100)
    - reasoning: str (explanation)
    - red_flags: list of suspicious elements detected
    """
    result = {
        "is_authentic": None,
        "confidence": None,
        "reasoning": "",
        "red_flags": [],
    }

    if not LLM_CLIENT_AVAILABLE:
        result["reasoning"] = "LLM client not available"
        return result

    try:
        client, model = get_chat_completion_client_and_model()
        if not client:
            result["reasoning"] = "LLM client not configured"
            return result

        # Read and encode image
        with open(image_path, "rb") as f:
            import base64
            image_data = base64.b64encode(f.read()).decode("utf-8")

        # Build prompt
        exif_summary = json.dumps({
            "camera": f"{exif_data.get('camera_make', 'Unknown')} {exif_data.get('camera_model', '')}".strip(),
            "datetime": exif_data.get("datetime_original"),
            "software": exif_data.get("software"),
            "gps": f"{exif_data.get('gps_latitude')}, {exif_data.get('gps_longitude')}" if exif_data.get("gps_latitude") else None,
            "warnings": exif_data.get("warnings", []),
        }, indent=2)

        prompt = f"""Analyze this vehicle damage image for authenticity and signs of fraud.

EXIF Metadata:
{exif_summary}

Please assess:
1. Does this appear to be a genuine photo of vehicle damage?
2. Are there signs of manipulation, screenshots, or stock images?
3. Is the damage consistent with the claimed incident?

Respond in JSON format:
{{
    "is_authentic": true/false,
    "confidence": 0-100,
    "reasoning": "brief explanation",
    "red_flags": ["list", "of", "concerns"]
}}
"""

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{image_data}",
                        },
                    },
                ],
            }
        ]

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=500,
            temperature=0.1,
        )

        content = response.choices[0].message.content

        # Try to parse JSON response
        try:
            # Handle markdown code blocks
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            llm_result = json.loads(content)
            result["is_authentic"] = llm_result.get("is_authentic")
            result["confidence"] = float(llm_result.get("confidence", 0))
            result["reasoning"] = llm_result.get("reasoning", "")
            result["red_flags"] = llm_result.get("red_flags", [])

        except (json.JSONDecodeError, ValueError):
            # If JSON parsing fails, use raw content as reasoning
            result["reasoning"] = content[:500]
            result["red_flags"].append("Could not parse structured response")

    except Exception as e:
        logger.exception("LLM authenticity analysis failed")
        result["reasoning"] = f"Analysis error: {str(e)}"

    return result


def compute_composite_fraud_score(
    ela_score: Optional[float],
    exif_warnings: list,
    llm_confidence: Optional[float],
    llm_is_authentic: Optional[bool],
    llm_red_flags: list,
) -> Decimal:
    """
    Compute composite fraud score (0-100) from individual signals.

    - Higher score = more suspicious
    - 0 = likely genuine
    - 100 = highly suspicious
    """
    scores = []
    weights = []

    # ELA contribution (weight: 25%)
    if ela_score is not None:
        scores.append(min(100.0, ela_score * 2))  # Amplify ELA
        weights.append(0.25)

    # EXIF warnings contribution (weight: 20%)
    if exif_warnings:
        exif_score = min(100.0, len(exif_warnings) * 25)  # 4 warnings = max
        scores.append(exif_score)
        weights.append(0.20)

    # LLM assessment contribution (weight: 55%)
    if llm_confidence is not None:
        # If LLM says not authentic, score based on confidence
        if llm_is_authentic is False:
            llm_score = llm_confidence
        elif llm_is_authentic is True:
            llm_score = max(0, 100 - llm_confidence)  # Invert for authenticity
        else:
            llm_score = 50  # Uncertain

        # Add penalty for red flags
        if llm_red_flags:
            llm_score = min(100, llm_score + (len(llm_red_flags) * 10))

        scores.append(llm_score)
        weights.append(0.55)

    if not scores:
        return Decimal("0")

    # Weighted average
    total_weight = sum(weights)
    weighted_sum = sum(s * w for s, w in zip(scores, weights))
    composite = weighted_sum / total_weight if total_weight > 0 else 0

    return Decimal(str(round(composite, 2)))


def analyze_image_fraud(image_path: str) -> dict:
    """
    Complete fraud analysis pipeline for a single image.

    Returns comprehensive dict with all analysis results.
    """
    # SHA-256 hash
    sha256_hex = compute_file_sha256(image_path)

    # EXIF analysis
    exif_data = analyze_exif_metadata(image_path)

    # ELA score
    ela_score = compute_ela_score(image_path)

    # Perceptual hashes
    hashes = compute_image_hashes(image_path)

    # LLM authenticity analysis
    llm_result = llm_authenticity_analysis(image_path, exif_data)

    # Composite fraud score
    fraud_score = compute_composite_fraud_score(
        ela_score=ela_score,
        exif_warnings=exif_data.get("warnings", []),
        llm_confidence=llm_result.get("confidence"),
        llm_is_authentic=llm_result.get("is_authentic"),
        llm_red_flags=llm_result.get("red_flags", []),
    )

    return {
        "sha256_hex": sha256_hex,
        "p_hash": hashes["p_hash"],
        "d_hash": hashes["d_hash"],
        "a_hash": hashes["a_hash"],
        "exif_data": exif_data,
        "ela_score": ela_score,
        "llm_authenticity": llm_result,
        "fraud_score": fraud_score,
    }


# =============================================================================
# Cross-claim duplicate detection
# =============================================================================


def _pricing_duplicate_float(config_key: str) -> Optional[float]:
    """Read 0–1 threshold from PricingConfig; values > 1 treated as percent (e.g. 88 → 0.88)."""
    from claims.models import PricingConfig

    row = PricingConfig.objects.filter(config_key=config_key, is_active=True).first()
    if not row or not str(row.config_value).strip():
        return None
    try:
        v = Decimal(str(row.config_value).strip())
        if v > 1:
            v = v / Decimal("100")
        return float(min(Decimal("1"), max(Decimal("0"), v)))
    except Exception:
        return None


def _pricing_duplicate_bool(config_key: str) -> Optional[bool]:
    from claims.models import PricingConfig

    row = PricingConfig.objects.filter(config_key=config_key, is_active=True).first()
    if not row or not str(row.config_value).strip():
        return None
    return str(row.config_value).strip().lower() in ("1", "true", "yes", "on")


def _normalize_duplicate_threshold(value: Optional[float]) -> Optional[float]:
    """Normalize duplicate thresholds to 0.0-1.0, accepting 0-100 percentages for CLI ergonomics."""
    if value is None:
        return None
    try:
        threshold = Decimal(str(value))
    except Exception:
        return None
    if threshold > 1:
        threshold = threshold / Decimal("100")
    threshold = min(Decimal("1"), max(Decimal("0"), threshold))
    return float(threshold)


def _duplicate_threshold_percent(value: Optional[float]) -> Optional[int]:
    normalized = _normalize_duplicate_threshold(value)
    if normalized is None:
        return None
    return int(round(normalized * 100))


def _duplicate_sensitivity_label(
    phash_threshold: Optional[float], dhash_threshold: Optional[float]
) -> str:
    values = [
        value
        for value in (
            _normalize_duplicate_threshold(phash_threshold),
            _normalize_duplicate_threshold(dhash_threshold),
        )
        if value is not None
    ]
    if not values:
        return "Standard"
    average = sum(values) / len(values)
    if average >= 0.95:
        return "Strict"
    if average >= 0.88:
        return "Balanced"
    return "Broad"


def get_duplicate_detection_settings() -> dict:
    """
    Tunable duplicate matching. Precedence: PricingConfig > Django settings (env) > defaults.

    PricingConfig keys (optional):
      - DUPLICATE_PHASH_THRESHOLD — decimal 0–1 (or 0–100 percent)
      - DUPLICATE_DHASH_THRESHOLD — if omitted but DUPLICATE_PHASH_THRESHOLD is set, dHash tracks pHash
      - DUPLICATE_REQUIRE_BOTH_HASHES — true/false; if true, non-exact hits need both hashes above thresholds

    Env (see .env.example):
      - VCA_DUPLICATE_PHASH_THRESHOLD (default 0.88)
      - VCA_DUPLICATE_DHASH_THRESHOLD (default: same as phash)
      - VCA_DUPLICATE_REQUIRE_BOTH_HASHES
    """
    ph = float(getattr(settings, "VCA_DUPLICATE_PHASH_THRESHOLD", 0.88))
    dh = float(getattr(settings, "VCA_DUPLICATE_DHASH_THRESHOLD", ph))
    require_both = bool(getattr(settings, "VCA_DUPLICATE_REQUIRE_BOTH_HASHES", False))

    pc_ph = _pricing_duplicate_float("DUPLICATE_PHASH_THRESHOLD")
    pc_ph_set = pc_ph is not None
    if pc_ph_set:
        ph = pc_ph
    pc_dh = _pricing_duplicate_float("DUPLICATE_DHASH_THRESHOLD")
    if pc_dh is not None:
        dh = pc_dh
    elif pc_ph_set:
        dh = ph

    pc_both = _pricing_duplicate_bool("DUPLICATE_REQUIRE_BOTH_HASHES")
    if pc_both is not None:
        require_both = pc_both

    sensitivity_label = _duplicate_sensitivity_label(ph, dh)
    match_policy_label = (
        "Dual-signal confirmation"
        if require_both
        else "Single-signal alerting"
    )
    reviewer_summary = (
        f"{sensitivity_label} screening. Both visual similarity signals must align "
        "before a possible cross-claim near-match is flagged."
        if require_both
        else f"{sensitivity_label} screening. A strong match on either visual similarity "
        "signal can flag a possible cross-claim near-match."
    )

    return {
        "phash_threshold": ph,
        "dhash_threshold": dh,
        "require_both_non_exact": require_both,
        "phash_threshold_percent": _duplicate_threshold_percent(ph),
        "dhash_threshold_percent": _duplicate_threshold_percent(dh),
        "sensitivity_label": sensitivity_label,
        "match_policy_label": match_policy_label,
        "reviewer_summary": reviewer_summary,
        "exact_match_policy": "Exact file matches are always flagged.",
    }


def resolve_duplicate_detection_settings(
    similarity_threshold: Optional[float] = None,
    *,
    phash_threshold: Optional[float] = None,
    dhash_threshold: Optional[float] = None,
    require_both_non_exact: Optional[bool] = None,
) -> dict:
    """
    Return effective duplicate settings with optional per-run overrides.

    ``similarity_threshold`` is retained as a legacy alias for pHash override only.
    New callers should prefer explicit ``phash_threshold`` / ``dhash_threshold``.
    """
    cfg = get_duplicate_detection_settings()

    effective_phash = _normalize_duplicate_threshold(
        phash_threshold if phash_threshold is not None else similarity_threshold
    )
    effective_dhash = _normalize_duplicate_threshold(dhash_threshold)

    if effective_phash is not None:
        cfg["phash_threshold"] = effective_phash
    if effective_dhash is not None:
        cfg["dhash_threshold"] = effective_dhash
    if require_both_non_exact is not None:
        cfg["require_both_non_exact"] = bool(require_both_non_exact)

    return cfg


def find_duplicate_candidates(
    complaint_id: str,
    p_hash: str,
    d_hash: str,
    sha256_hex: str,
    similarity_threshold: Optional[float] = None,
    *,
    phash_threshold: Optional[float] = None,
    dhash_threshold: Optional[float] = None,
    require_both_non_exact: Optional[bool] = None,
) -> list:
    """
    Find potential duplicate/reused images across claims based on hash similarity.

    Args:
        complaint_id: The current claim being analyzed
        p_hash: Perceptual hash of the image
        d_hash: Difference hash of the image
        sha256_hex: SHA-256 hash for exact match detection
        similarity_threshold: Optional legacy single threshold (0-1). When None, uses
            get_duplicate_detection_settings() (phash / dhash / require-both).

    Returns:
        List of dicts with duplicate candidate info (similarity_score is 0.0–1.0).
    """
    from claims.models import ImageFraudResult

    candidates = []

    if not IMAGEHASH_AVAILABLE or not p_hash:
        return candidates

    cfg = resolve_duplicate_detection_settings(
        similarity_threshold=similarity_threshold,
        phash_threshold=phash_threshold,
        dhash_threshold=dhash_threshold,
        require_both_non_exact=require_both_non_exact,
    )
    t_p = cfg["phash_threshold"]
    t_d = cfg["dhash_threshold"]
    require_both = cfg["require_both_non_exact"]

    try:
        # Query all ImageFraudResult entries for other claims with hashes
        existing_results = ImageFraudResult.objects.exclude(
            complaint_id=complaint_id
        ).filter(
            p_hash__isnull=False,
            p_hash__gt="",
        ).select_related("complaint")

        for existing in existing_results:
            reasons: list[str] = []
            similarity = 0.0

            # Exact file match — always highest signal
            if sha256_hex and existing.sha256_hex == sha256_hex:
                reasons.append("EXACT_FILE_MATCH")
                similarity = 1.0
            elif require_both:
                if not (d_hash and existing.d_hash):
                    continue
                p_similarity = hash_similarity(p_hash, existing.p_hash)
                d_similarity = hash_similarity(d_hash, existing.d_hash)
                if p_similarity >= t_p and d_similarity >= t_d:
                    reasons.extend(["PHASH_SIMILAR", "DHASH_SIMILAR"])
                    similarity = round(min(p_similarity, d_similarity), 4)
                else:
                    continue
            else:
                p_similarity = (
                    hash_similarity(p_hash, existing.p_hash) if existing.p_hash else 0.0
                )
                d_similarity = (
                    hash_similarity(d_hash, existing.d_hash)
                    if (existing.d_hash and d_hash)
                    else 0.0
                )
                hit = False
                if p_similarity >= t_p:
                    reasons.append("PHASH_SIMILAR")
                    similarity = max(similarity, p_similarity)
                    hit = True
                if d_similarity >= t_d:
                    if "DHASH_SIMILAR" not in reasons:
                        reasons.append("DHASH_SIMILAR")
                    similarity = max(similarity, d_similarity)
                    hit = True
                if not hit:
                    continue

            candidates.append(
                {
                    "other_complaint_id": existing.complaint_id,
                    "other_photo_path": existing.photo_path,
                    "similarity_score": round(float(similarity), 4),
                    "match_reasons": reasons,
                    "existing_created_at": existing.created_at.isoformat()
                    if existing.created_at
                    else None,
                }
            )

        candidates.sort(key=lambda x: x["similarity_score"], reverse=True)

    except Exception:
        logger.exception("Duplicate candidate search failed")

    return candidates


def persist_duplicate_candidates(complaint_id: str, candidates: list) -> int:
    """
    Save duplicate candidates to the database.

    Args:
        complaint_id: The current claim ID
        candidates: List of candidate dicts from find_duplicate_candidates

    Returns:
        Number of candidates persisted
    """
    from claims.models import ClaimDuplicateCandidate, FnolClaim

    count = 0
    try:
        # Get or create the claim instance
        claim = FnolClaim.objects.filter(complaint_id=complaint_id).first()
        if not claim:
            logger.warning(f"Cannot persist duplicates: claim {complaint_id} not found")
            return 0

        # Clear old candidates for this claim
        ClaimDuplicateCandidate.objects.filter(complaint=claim).delete()

        for candidate in candidates:
            ClaimDuplicateCandidate.objects.create(
                complaint=claim,
                other_complaint_id=candidate["other_complaint_id"],
                match_reason=",".join(candidate["match_reasons"]),
                similarity_score=Decimal(str(candidate["similarity_score"] * 100)),  # Store as percentage
                evidence_json={
                    "photo_path": candidate["other_photo_path"],
                    "existing_created_at": candidate["existing_created_at"],
                },
            )
            count += 1

    except Exception:
        logger.exception("Failed to persist duplicate candidates")

    return count
def check_image_reuse(
    image_path: str,
    complaint_id: str,
    persist: bool = True,
    *,
    phash_threshold: Optional[float] = None,
    dhash_threshold: Optional[float] = None,
    require_both_non_exact: Optional[bool] = None,
) -> dict:
    """
    Complete image reuse/duplicate detection pipeline.

    Args:
        image_path: Path to image file
        complaint_id: Current claim ID
        persist: Whether to save results to database

    Returns:
        Dict with hashes and duplicate candidates
    """
    # Compute hashes
    sha256_hex = compute_file_sha256(image_path)
    hashes = compute_image_hashes(image_path)

    # Find candidates
    candidates = find_duplicate_candidates(
        complaint_id=complaint_id,
        p_hash=hashes["p_hash"],
        d_hash=hashes["d_hash"],
        sha256_hex=sha256_hex,
        phash_threshold=phash_threshold,
        dhash_threshold=dhash_threshold,
        require_both_non_exact=require_both_non_exact,
    )

    duplicate_detection = resolve_duplicate_detection_settings(
        phash_threshold=phash_threshold,
        dhash_threshold=dhash_threshold,
        require_both_non_exact=require_both_non_exact,
    )

    # Persist if requested
    if persist:
        persist_duplicate_candidates(complaint_id, candidates)

    return {
        "sha256_hex": sha256_hex,
        "p_hash": hashes["p_hash"],
        "d_hash": hashes["d_hash"],
        "a_hash": hashes["a_hash"],
        "duplicate_detection": duplicate_detection,
        "duplicate_candidates": candidates,
        "candidate_count": len(candidates),
    }
