"""
Normalize FNOL damage photo paths for storage, API responses, and on-disk analysis.

Stored paths may be basenames, media-relative segments, or absolute temp paths (tests).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.conf import settings


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
    if isinstance(item, str):
        norm = normalize_stored_photo_path(item)
        return norm or None
    if isinstance(item, dict):
        img = item.get("image")
        url = None
        if isinstance(img, dict):
            url = img.get("url")
        if not url:
            url = item.get("url") or item.get("path") or item.get("photo_path")
        if isinstance(url, str):
            norm = normalize_stored_photo_path(url)
            return norm or None
    return None


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
    name = normalize_stored_photo_path(photo_path) or Path((photo_path or "").replace("\\", "/")).name
    if not name:
        return ""
    return f"media/vehicle_damage/{name}"
