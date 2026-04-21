from __future__ import annotations

import ipaddress
import os
import socket
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.core.files import File
from django.utils import timezone

from claim_automation.vca_config import cfg
from claims.digitization_s3 import cleanup_temp_path, s3_enabled

_REMOTE_FETCH_CHUNK_SIZE = 65536
_REMOTE_FETCH_USER_AGENT = "VehicleClaimAutomation/1.0"


def _is_remote_source(source_path: str) -> bool:
    value = str(source_path or "").strip().lower()
    return value.startswith(("http://", "https://"))


def _video_fetch_hostname_allowed(source_url: str) -> bool:
    allow = getattr(settings, "VIDEO_SOURCE_FETCH_ALLOWED_HOSTS", None) or []
    if not allow:
        return True
    parsed = urlparse(source_url)
    host = (parsed.hostname or "").lower()
    for allowed_host in allow:
        allowed_host = (allowed_host or "").strip().lower()
        if not allowed_host:
            continue
        if host == allowed_host or host.endswith(f".{allowed_host}"):
            return True
    return False


def _allow_private_video_fetch_hosts() -> bool:
    return bool(getattr(settings, "VIDEO_SOURCE_FETCH_ALLOW_PRIVATE_HOSTS", False))


def _resolve_hostname_ips(hostname: str) -> list[str]:
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


def _validate_remote_video_url(source_url: str) -> tuple[str, str]:
    parsed = urlparse(source_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Only http and https video URLs are allowed.")
    if parsed.username or parsed.password:
        raise ValueError("Video URLs with embedded credentials are not allowed.")

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise ValueError("Video URL must include a hostname.")

    if not _video_fetch_hostname_allowed(source_url):
        raise ValueError(
            "Video URL host is not allowed. Set VIDEO_SOURCE_FETCH_ALLOWED_HOSTS "
            "to a comma-separated list of permitted hostnames."
        )

    try:
        resolved_ips = _resolve_hostname_ips(hostname)
    except socket.gaierror as exc:
        raise ValueError("Video URL hostname could not be resolved.") from exc

    if not resolved_ips:
        raise ValueError("Video URL hostname did not resolve to an address.")

    if not _allow_private_video_fetch_hosts():
        blocked_ips = [ip for ip in resolved_ips if _ip_is_private_or_restricted(ip)]
        if blocked_ips:
            raise ValueError(
                "Video URL resolved to a private or restricted network address. "
                "Set VIDEO_SOURCE_FETCH_ALLOW_PRIVATE_HOSTS=True only for trusted local media hosts."
            )

    return source_url, hostname


def _stored_remote_video_filename(asset, source_url: str) -> str:
    parsed = urlparse(source_url)
    original_name = (
        str(getattr(asset, "original_filename", "") or "").strip()
        or Path(parsed.path or "").name
        or "remote-video"
    )
    suffix = Path(original_name).suffix or Path(parsed.path or "").suffix or ".bin"
    stem = Path(original_name).stem or "remote-video"
    return f"{stem}{suffix}"


def materialize_remote_video_asset(asset):
    """
    Persist a remote source_path into the asset file storage when needed.
    """
    file_field = getattr(asset, "file", None)
    if file_field and getattr(file_field, "name", ""):
        try:
            if file_field.storage.exists(file_field.name):
                return asset
        except Exception:
            pass

    source_url = str(getattr(asset, "source_path", "") or "").strip()
    if not _is_remote_source(source_url):
        return asset

    source_url, _hostname = _validate_remote_video_url(source_url)
    response = requests.get(
        source_url,
        headers={"User-Agent": _REMOTE_FETCH_USER_AGENT},
        timeout=cfg.video_fetch_timeout_s,
        stream=True,
        allow_redirects=False,
    )
    temp_path: Path | None = None
    try:
        if response.is_redirect or response.is_permanent_redirect:
            raise ValueError("Redirecting video URLs are not allowed.")
        response.raise_for_status()

        content_length = response.headers.get("Content-Length")
        if content_length and str(content_length).strip().isdigit():
            if int(content_length) > int(cfg.video_fetch_max_bytes):
                raise ValueError("Video reference exceeds configured fetch size limit.")

        suffix = (
            Path(str(getattr(asset, "original_filename", "") or "")).suffix
            or Path(urlparse(source_url).path or "").suffix
            or ".bin"
        )
        fd, tmp_name = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        temp_path = Path(tmp_name)

        total = 0
        with open(temp_path, "wb") as dst:
            for chunk in response.iter_content(chunk_size=_REMOTE_FETCH_CHUNK_SIZE):
                if not chunk:
                    continue
                total += len(chunk)
                if total > int(cfg.video_fetch_max_bytes):
                    raise ValueError("Video reference exceeds configured fetch size limit.")
                dst.write(chunk)

        if total <= 0:
            raise ValueError("Remote video response was empty.")

        with open(temp_path, "rb") as src:
            asset.file.save(_stored_remote_video_filename(asset, source_url), File(src), save=False)

        materialization = dict(getattr(asset, "metadata_json", {}) or {})
        materialization["source_materialization"] = {
            "source_url": source_url,
            "downloaded_at": timezone.now().isoformat(),
            "content_type": (response.headers.get("Content-Type") or "").strip(),
            "download_size_bytes": total,
        }
        asset.metadata_json = materialization
        asset.file_size_bytes = total
        if not getattr(asset, "original_filename", ""):
            asset.original_filename = _stored_remote_video_filename(asset, source_url)
        if not getattr(asset, "mime_type", ""):
            asset.mime_type = (response.headers.get("Content-Type") or "").strip()
        asset.save(
            update_fields=[
                "file",
                "metadata_json",
                "file_size_bytes",
                "original_filename",
                "mime_type",
                "updated_at",
            ]
        )
        return asset
    finally:
        response.close()
        cleanup_temp_path(temp_path, bool(temp_path))


def build_file_field_url(request, file_field) -> str:
    """
    Public URL for any stored media file handled by Django storage.
    """
    if not file_field:
        return ""
    try:
        if file_field.url:
            if s3_enabled():
                return file_field.url
            return request.build_absolute_uri(file_field.url)
    except Exception:
        return ""
    return ""


def build_claim_video_file_url(request, asset) -> str:
    """
    Public URL for a stored video asset.
    """
    if getattr(asset, "file", None):
        try:
            if asset.file and asset.file.url:
                return build_file_field_url(request, asset.file)
        except Exception:
            pass
    source_path = str(getattr(asset, "source_path", "") or "").strip()
    if not source_path:
        return ""
    if source_path.startswith(("http://", "https://")):
        return source_path

    normalized_path = source_path.replace("\\", "/").strip()
    if os.path.isabs(source_path):
        try:
            media_root = Path(settings.MEDIA_ROOT).resolve()
            normalized_path = Path(source_path).resolve().relative_to(media_root).as_posix()
        except Exception:
            return ""

    if normalized_path.startswith("/"):
        normalized_path = normalized_path.lstrip("/")
    if normalized_path.startswith("media/"):
        normalized_path = normalized_path[6:].lstrip("/")
    if not normalized_path:
        return ""

    media_url = str(getattr(settings, "MEDIA_URL", "/media/") or "/media/")
    if not media_url.endswith("/"):
        media_url = f"{media_url}/"
    return request.build_absolute_uri(f"{media_url}{normalized_path}")


def resolve_video_source_disk_path(source_path: str) -> str:
    """
    Resolve a source_path string to a predictable on-disk location when possible.
    """
    value = str(source_path or "").strip()
    if not value:
        return ""
    if _is_remote_source(value):
        return ""
    normalized = value.replace("\\", "/")
    if os.path.isabs(value):
        return value

    media_root = Path(settings.MEDIA_ROOT)
    candidates = [
        media_root / normalized,
        media_root / "claim_videos" / normalized,
        media_root / "claim_videos" / Path(normalized).name,
    ]
    for candidate in candidates:
        try:
            if candidate.is_file():
                return str(candidate)
        except OSError:
            continue
    return str(candidates[0])


def claim_video_asset_local_path(asset) -> tuple[Path, bool]:
    """
    Return a local file path for an asset, downloading remote storage to temp when needed.
    """
    if _is_remote_source(getattr(asset, "source_path", "")):
        asset = materialize_remote_video_asset(asset)

    file_field = getattr(asset, "file", None)
    if file_field:
        try:
            fs_path = Path(file_field.path)
            if fs_path.is_file():
                return fs_path, False
        except Exception:
            pass

        suffix = Path(getattr(asset, "original_filename", "") or file_field.name).suffix or ".bin"
        fd, tmp_name = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        tmp_path = Path(tmp_name)
        try:
            with file_field.open("rb") as src:
                with open(tmp_path, "wb") as dst:
                    for chunk in iter(lambda: src.read(65536), b""):
                        dst.write(chunk)
            return tmp_path, True
        except Exception:
            cleanup_temp_path(tmp_path, True)
            raise

    source_path = resolve_video_source_disk_path(getattr(asset, "source_path", ""))
    if not source_path:
        raise ValueError("Video asset has no file or source_path")
    return Path(source_path), False
