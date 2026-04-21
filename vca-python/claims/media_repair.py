from __future__ import annotations

import os
from pathlib import Path

from claims.media_paths import (
    is_video_media_path,
    normalize_stored_video_source_path,
)
from claims.models import ClaimVideoAsset, FnolClaim, FnolDamagePhoto


def _asset_filename_candidates(asset: ClaimVideoAsset) -> set[str]:
    candidates: set[str] = set()
    for value in (
        getattr(asset, "original_filename", "") or "",
        getattr(asset, "source_path", "") or "",
        getattr(getattr(asset, "file", None), "name", "") or "",
    ):
        text = str(value).strip()
        if not text:
            continue
        candidates.add(Path(text.replace("\\", "/")).name.lower())
    return candidates


def _asset_matches_filename(asset: ClaimVideoAsset, filename: str) -> bool:
    target = str(filename or "").strip().lower()
    if not target:
        return False
    return target in _asset_filename_candidates(asset)


def _can_create_video_asset_from_path(source_path: str) -> bool:
    value = str(source_path or "").strip()
    if not value:
        return False
    if value.startswith(("http://", "https://")):
        return True
    return not os.path.isabs(value)


def repair_claim_media_links(
    *,
    complaint_id: str | None = None,
    apply: bool = False,
) -> dict[str, object]:
    misfiled_qs = FnolDamagePhoto.objects.select_related("complaint").order_by("id")
    if complaint_id:
        misfiled_qs = misfiled_qs.filter(complaint_id=complaint_id)

    misfiled_rows = [
        row
        for row in misfiled_qs
        if str(row.photo_path or "").strip() and is_video_media_path(row.photo_path)
    ]

    orphan_assets = [
        asset
        for asset in ClaimVideoAsset.objects.order_by("id")
        if not FnolClaim.objects.filter(complaint_id=asset.complaint_id).exists()
    ]

    summary: dict[str, object] = {
        "complaint_id": complaint_id or "",
        "apply": apply,
        "misfiled_video_photo_rows": len(misfiled_rows),
        "orphan_video_assets": len(orphan_assets),
        "reassigned_orphan_assets": 0,
        "created_video_assets": 0,
        "deleted_legacy_photo_rows": 0,
        "manual_review_count": 0,
        "repairs": [],
        "manual_review": [],
    }

    for row in misfiled_rows:
        claim = row.complaint
        photo_value = str(row.photo_path or "").strip()
        filename = Path(photo_value.replace("\\", "/")).name
        normalized_source_path = normalize_stored_video_source_path(photo_value)
        existing_assets = list(claim.video_assets.order_by("id"))
        matching_claim_assets = [asset for asset in existing_assets if _asset_matches_filename(asset, filename)]
        matching_orphans = [asset for asset in orphan_assets if _asset_matches_filename(asset, filename)]

        repair_note: dict[str, object] = {
            "photo_row_id": row.id,
            "complaint_id": claim.complaint_id,
            "legacy_photo_path": photo_value,
            "filename": filename,
        }

        if matching_claim_assets:
            repair_note["action"] = "drop_legacy_video_photo_row"
            repair_note["asset_ids"] = [asset.id for asset in matching_claim_assets]
            if apply:
                row.delete()
                summary["deleted_legacy_photo_rows"] = int(summary["deleted_legacy_photo_rows"]) + 1
            cast_repairs = summary["repairs"]
            assert isinstance(cast_repairs, list)
            cast_repairs.append(repair_note)
            continue

        if len(matching_orphans) == 1:
            orphan_asset = matching_orphans[0]
            repair_note["action"] = "reassign_orphan_asset"
            repair_note["asset_id"] = orphan_asset.id
            repair_note["from_complaint_id"] = orphan_asset.complaint_id
            if apply:
                orphan_asset.complaint = claim
                orphan_asset.save(update_fields=["complaint"])
                orphan_assets = [asset for asset in orphan_assets if asset.id != orphan_asset.id]
                row.delete()
                summary["reassigned_orphan_assets"] = int(summary["reassigned_orphan_assets"]) + 1
                summary["deleted_legacy_photo_rows"] = int(summary["deleted_legacy_photo_rows"]) + 1
            cast_repairs = summary["repairs"]
            assert isinstance(cast_repairs, list)
            cast_repairs.append(repair_note)
            continue

        if len(matching_orphans) > 1:
            repair_note["action"] = "manual_review_multiple_orphan_matches"
            repair_note["candidate_asset_ids"] = [asset.id for asset in matching_orphans]
            summary["manual_review_count"] = int(summary["manual_review_count"]) + 1
            cast_manual = summary["manual_review"]
            assert isinstance(cast_manual, list)
            cast_manual.append(repair_note)
            continue

        if normalized_source_path and _can_create_video_asset_from_path(normalized_source_path):
            source_type = (
                ClaimVideoAsset.SourceType.DASHCAM
                if getattr(claim, "dashcam_cctv_evidence", None)
                else ClaimVideoAsset.SourceType.UPLOAD
            )
            repair_note["action"] = "create_claim_video_asset"
            repair_note["source_path"] = normalized_source_path
            if apply:
                ClaimVideoAsset.objects.create(
                    complaint=claim,
                    source_path=normalized_source_path,
                    original_filename=filename or Path(normalized_source_path).name,
                    source_type=source_type,
                )
                row.delete()
                summary["created_video_assets"] = int(summary["created_video_assets"]) + 1
                summary["deleted_legacy_photo_rows"] = int(summary["deleted_legacy_photo_rows"]) + 1
            cast_repairs = summary["repairs"]
            assert isinstance(cast_repairs, list)
            cast_repairs.append(repair_note)
            continue

        repair_note["action"] = "manual_review_unresolved_video_path"
        repair_note["normalized_source_path"] = normalized_source_path
        summary["manual_review_count"] = int(summary["manual_review_count"]) + 1
        cast_manual = summary["manual_review"]
        assert isinstance(cast_manual, list)
        cast_manual.append(repair_note)

    remaining_orphans = [
        asset
        for asset in ClaimVideoAsset.objects.order_by("id")
        if not FnolClaim.objects.filter(complaint_id=asset.complaint_id).exists()
    ]
    if complaint_id:
        remaining_orphans = [
            asset for asset in remaining_orphans if asset.complaint_id == complaint_id
        ]
    summary["remaining_orphan_video_assets"] = len(remaining_orphans)
    summary["remaining_orphan_asset_ids"] = [asset.id for asset in remaining_orphans[:25]]

    return summary
