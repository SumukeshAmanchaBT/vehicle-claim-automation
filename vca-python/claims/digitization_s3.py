"""
S3 helpers for digitization uploads (optional — enabled when AWS_S3_BUCKET_NAME + secret are set).
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings


def s3_enabled() -> bool:
    return bool(
        getattr(settings, "USE_S3_FOR_MEDIA", False)
        and getattr(settings, "AWS_STORAGE_BUCKET_NAME", None)
    )


def _s3_client():
    import boto3

    kwargs = {"region_name": getattr(settings, "AWS_S3_REGION_NAME", None) or "ap-south-1"}
    key = getattr(settings, "AWS_ACCESS_KEY_ID", None) or os.getenv("AWS_ACCESS_KEY_ID")
    secret = getattr(settings, "AWS_SECRET_ACCESS_KEY", None) or os.getenv("AWS_SECRET_ACCESS_KEY")
    if key and secret:
        kwargs["aws_access_key_id"] = key
        kwargs["aws_secret_access_key"] = secret
    return boto3.client("s3", **kwargs)


def presigned_get_url(object_key: str) -> str | None:
    if not s3_enabled() or not object_key:
        return None
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    expires = int(getattr(settings, "AWS_S3_PRESIGNED_EXPIRES", 3600))
    try:
        return _s3_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": object_key},
            ExpiresIn=expires,
        )
    except Exception:
        return None


def s3_object_exists(object_key: str) -> bool:
    if not s3_enabled() or not object_key:
        return False
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    client = _s3_client()
    try:
        client.head_object(Bucket=bucket, Key=object_key)
        return True
    except Exception:
        return False


def list_s3_objects(prefix: str = "digitization/", limit: int = 200) -> list[dict]:
    """
    List objects from S3 (most recent first). Returns dicts with Key/LastModified/Size.
    """
    if not s3_enabled():
        return []
    limit = max(1, min(int(limit or 200), 500))
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    client = _s3_client()

    # S3 list_objects_v2 returns keys in UTF-8 binary order (not strictly by last modified).
    # We'll fetch a page and then sort by LastModified desc in-memory.
    resp = client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=min(1000, limit))
    contents = resp.get("Contents") or []
    items = [
        {"key": c.get("Key"), "last_modified": c.get("LastModified"), "size": c.get("Size")}
        for c in contents
        if c.get("Key") and not str(c.get("Key")).endswith("/")
    ]
    items.sort(key=lambda x: x.get("last_modified") or 0, reverse=True)
    return items[:limit]


def upload_bytes_to_s3(
    object_key: str,
    data: bytes,
    content_type: str | None = None,
) -> None:
    from botocore.exceptions import ClientError

    bucket = settings.AWS_STORAGE_BUCKET_NAME
    extra: dict = {}
    if content_type:
        extra["ContentType"] = content_type
    client = _s3_client()
    try:
        client.put_object(Bucket=bucket, Key=object_key, Body=data, **extra)
    except ClientError as e:
        raise RuntimeError(f"S3 upload failed: {e}") from e


def move_s3_object(src_key: str, dst_key: str) -> None:
    """
    Move an object within the same bucket (copy + delete).
    No-op when keys are identical.
    """
    if not s3_enabled():
        return
    if not src_key or not dst_key or src_key == dst_key:
        return
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    client = _s3_client()
    # Copy preserves metadata by default (MetadataDirective=COPY).
    client.copy_object(Bucket=bucket, CopySource={"Bucket": bucket, "Key": src_key}, Key=dst_key)
    client.delete_object(Bucket=bucket, Key=src_key)


def move_s3_prefix(src_prefix: str, dst_prefix: str) -> int:
    """
    Move all objects under src_prefix to dst_prefix (copy + delete).
    Returns number of objects moved.
    """
    if not s3_enabled():
        return 0
    src_prefix = (src_prefix or "").lstrip("/")
    dst_prefix = (dst_prefix or "").lstrip("/")
    if not src_prefix or not dst_prefix or src_prefix == dst_prefix:
        return 0

    bucket = settings.AWS_STORAGE_BUCKET_NAME
    client = _s3_client()
    moved = 0

    token: str | None = None
    while True:
        kwargs: dict = {"Bucket": bucket, "Prefix": src_prefix, "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        contents = resp.get("Contents") or []
        for c in contents:
            key = c.get("Key")
            if not key or str(key).endswith("/"):
                continue
            key = str(key)
            if not key.startswith(src_prefix):
                continue
            suffix = key[len(src_prefix) :]
            new_key = f"{dst_prefix}{suffix}"
            if new_key == key:
                continue
            client.copy_object(Bucket=bucket, CopySource={"Bucket": bucket, "Key": key}, Key=new_key)
            client.delete_object(Bucket=bucket, Key=key)
            moved += 1

        if resp.get("IsTruncated"):
            token = resp.get("NextContinuationToken")
            if not token:
                break
        else:
            break

    return moved


def build_digitization_file_url(request, document) -> str:
    """
    Public URL for API consumers (iframe/img). Uses presigned URL when media is on S3.
    """
    if s3_enabled():
        # Prefer the storage backend's URL. With django-storages this is already a
        # correctly encoded, region-aware signed URL for private buckets.
        try:
            url = document.file.url
            if url:
                return url
        except Exception:
            pass
        # Fallback: manual presign from stored key
        try:
            key = document.file.name
        except Exception:
            key = ""
        url = presigned_get_url(key)
        if url:
            return url
    try:
        return request.build_absolute_uri(document.file.url)
    except Exception:
        return document.file.url or ""


def digitization_doc_local_path(document) -> tuple[Path, bool]:
    """
    Return (path, needs_cleanup). If file is on remote storage, downloads to a temp file.
    Caller must unlink temp path when needs_cleanup is True.
    """
    def _download_url_to_temp(url: str, suffix: str) -> Path:
        import requests

        fd, tmp = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        tmp_path = Path(tmp)
        try:
            with requests.get(url, stream=True, timeout=30) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as out:
                    for chunk in resp.iter_content(chunk_size=65536):
                        if chunk:
                            out.write(chunk)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise
        return tmp_path

    name = ""
    try:
        name = document.file.name
    except Exception:
        pass
    if not name:
        raise ValueError("Document has no file")

    # Local filesystem storage exposes .path
    try:
        fs_path = Path(document.file.path)
        if fs_path.is_file():
            return fs_path, False
    except Exception:
        pass

    # If the DB references a local path but the file is missing (common when sharing DB across machines),
    # try to download from an absolute URL (S3/public) when available.
    try:
        url = getattr(document.file, "url", "") or ""
    except Exception:
        url = ""
    if url:
        parsed = urlparse(str(url))
        if parsed.scheme in ("http", "https"):
            suffix = Path(document.original_filename or name).suffix or ".bin"
            tmp_path = _download_url_to_temp(str(url), suffix=suffix)
            return tmp_path, True

    suffix = Path(document.original_filename or name).suffix or ".bin"
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    tmp_path = Path(tmp)
    try:
        with document.file.open("rb") as src:
            with open(tmp_path, "wb") as out:
                for chunk in iter(lambda: src.read(65536), b""):
                    out.write(chunk)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise FileNotFoundError(
            "Digitization document file is not available on this server. "
            "If you're using a shared DB across machines, re-upload the document on this environment "
            "or enable S3 media (USE_S3_FOR_MEDIA=1) so files are retrievable everywhere."
        )
    return tmp_path, True


def cleanup_temp_path(path: Path | None, needs_cleanup: bool) -> None:
    if needs_cleanup and path is not None:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
