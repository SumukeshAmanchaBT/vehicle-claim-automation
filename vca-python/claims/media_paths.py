"""
Normalize FNOL damage photo paths for storage, API responses, and on-disk analysis.

Stored paths may be basenames, media-relative segments, or absolute temp paths (tests).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.conf import settings


IMAGE_FILE_EXTENSIONS = frozenset(
    {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".bmp",
        ".gif",
        ".tif",
        ".tiff",
        ".heic",
        ".heif",
    }
)
VIDEO_FILE_EXTENSIONS = frozenset(
    {
        ".mp4",
        ".mov",
        ".avi",
        ".mkv",
        ".webm",
        ".m4v",
        ".mpg",
        ".mpeg",
        ".3gp",
        ".wmv",
    }
)


def _normalized_media_path_candidate(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        value = unquote(urlparse(value).path or "")
    return value.replace("\\", "/").strip()


def classify_claim_media_path(raw: str) -> str:
    """
    Best-effort media classification from a stored path/URL/filename.
    Returns "image", "video", or "unknown".
    """
    candidate = _normalized_media_path_candidate(raw)
    if not candidate:
        return "unknown"
    suffix = Path(candidate).suffix.lower()
    if suffix in VIDEO_FILE_EXTENSIONS:
        return "video"
    if suffix in IMAGE_FILE_EXTENSIONS:
        return "image"
    return "unknown"


def is_image_media_path(raw: str) -> bool:
    return classify_claim_media_path(raw) == "image"


def is_video_media_path(raw: str) -> bool:
    return classify_claim_media_path(raw) == "video"


def _extract_claim_media_reference(item) -> tuple[str, str, str]:
    """
    Read a media reference from string or nested dict payloads used by save_fnol.
    Returns (raw_path, original_filename, source_type).
    """
    if isinstance(item, str):
        return item, "", ""

    if not isinstance(item, dict):
        return "", "", ""

    nested_image = item.get("image")
    nested_video = item.get("video")
    nested_file = item.get("file")
    raw_path = ""
    for candidate in (
        nested_video.get("url") if isinstance(nested_video, dict) else None,
        nested_image.get("url") if isinstance(nested_image, dict) else None,
        nested_file.get("url") if isinstance(nested_file, dict) else None,
        item.get("file_url"),
        item.get("url"),
        item.get("path"),
        item.get("photo_path"),
        item.get("source_path"),
    ):
        if isinstance(candidate, str) and candidate.strip():
            raw_path = candidate
            break

    original_filename = ""
    for candidate in (
        item.get("original_filename"),
        item.get("filename"),
        item.get("name"),
    ):
        if isinstance(candidate, str) and candidate.strip():
            original_filename = candidate.strip()
            break

    source_type = ""
    candidate_source_type = item.get("source_type")
    if isinstance(candidate_source_type, str) and candidate_source_type.strip():
        source_type = candidate_source_type.strip()

    return raw_path, original_filename, source_type


def normalize_stored_photo_path(raw: str) -> str:
    """
    Return a stable relative key for fnol_damage_photos.photo_path (basename under vehicle_damage/).

    Accepts URLs, media/..., vehicle_damage/..., or plain filenames.
    """
    s = (raw or "").strip()
    if not s:
        return ""
    if s.startswith(("http://", "https://")):
        path = unquote(urlparse(s).path or "")
        s = path.lstrip("/")
    s = s.replace("\\", "/")
    if s.startswith("media/"):
        s = s[6:].lstrip("/")
    name = Path(s).name
    if not name or name in (".", ".."):
        return ""
    return name


def coerce_fnol_photo_entry(item) -> str | None:
    """Extract a string path from save-fnol documents.photos entries (str or nested dict)."""
    raw_path, _original_filename, _source_type = _extract_claim_media_reference(item)
    if not raw_path or is_video_media_path(raw_path):
        return None
    norm = normalize_stored_photo_path(raw_path)
    return norm or None


def normalize_stored_video_source_path(raw: str) -> str:
    """
    Return a stable source_path for claim_video_assets.

    Keeps remote URLs intact, strips leading MEDIA_URL segments, and rewrites
    absolute paths under MEDIA_ROOT to relative media paths when possible.
    """
    value = (raw or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value

    normalized = unquote(value).replace("\\", "/").strip()
    if normalized.startswith("/"):
        normalized = normalized.lstrip("/")
    if normalized.startswith("media/"):
        normalized = normalized[6:].lstrip("/")

    if os.path.isabs(value):
        media_root = Path(settings.MEDIA_ROOT).resolve()
        try:
            absolute_path = Path(value).resolve()
            normalized = absolute_path.relative_to(media_root).as_posix()
        except Exception:
            return value

    return normalized


def coerce_claim_video_entry(
    item,
    *,
    default_source_type: str = "upload",
) -> dict[str, str] | None:
    """Extract a claim-linked video asset registration payload from save-fnol media entries."""
    raw_path, original_filename, source_type = _extract_claim_media_reference(item)
    if not raw_path:
        return None

    media_reference = original_filename or raw_path
    if not is_video_media_path(media_reference):
        return None

    normalized_path = normalize_stored_video_source_path(raw_path)
    if not normalized_path:
        return None

    inferred_name = Path(_normalized_media_path_candidate(raw_path)).name
    label = original_filename or inferred_name or Path(normalized_path).name
    if not label:
        return None

    return {
        "source_path": normalized_path,
        "original_filename": label,
        "source_type": source_type or default_source_type,
    }


def resolve_media_disk_path(photo_path: str) -> str:
    """
    Resolve DB photo_path to an absolute path for PIL / hash / YOLO.

    Tries MEDIA_ROOT joins, then vehicle_damage basename. Falls back to original
    string (e.g. absolute /tmp/... used in tests) even if missing so callers can
    still fail predictably inside analysis code.
    """
    p = (photo_path or "").strip()
    if not p:
        return ""
    p_norm = p.replace("\\", "/")
    if os.path.isabs(p):
        return p

    root = Path(settings.MEDIA_ROOT)
    candidates = [
        root / p_norm,
        root / "vehicle_damage" / p_norm,
        root / "vehicle_damage" / Path(p_norm).name,
    ]
    for c in candidates:
        try:
            if c.is_file():
                return str(c)
        except OSError:
            continue

    # Prefer conventional layout even when file is missing (clear errors downstream)
    fallback = root / "vehicle_damage" / Path(p_norm).name
    return str(fallback)


def damage_photo_public_relative_url(photo_path: str) -> str:
    """
    Browser-relative URL segment: media/vehicle_damage/<file> (no leading slash).
    Avoids doubling when the client prefixes VITE_API_MEDIA_URL.
    """
    if is_video_media_path(photo_path):
        return ""
    name = normalize_stored_photo_path(photo_path) or Path((photo_path or "").replace("\\", "/")).name
    if not name:
        return ""
    return f"media/vehicle_damage/{name}"
