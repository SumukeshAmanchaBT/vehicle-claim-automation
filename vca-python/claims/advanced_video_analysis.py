"""
Advanced video analysis path: PyAV/SSIM scene profiling, YOLO + ByteTrack,
optional SAM-style segmentation hooks, per-track VLM, temporal reuse of
existing aggregation + LLM fusion from ``video_analysis``.

Raises ``AdvancedVideoAnalysisError`` for recoverable failures so the router
can fall back to the legacy OpenCV pipeline without breaking callers.
"""
from __future__ import annotations

import importlib.util
import json
import logging
import math
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np
from django.conf import settings as django_settings

from claim_automation.vca_config import cfg
from claims.video_pipeline_config import VideoPipelineSettings, load_video_pipeline_settings

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, float, str, dict[str, Any] | None], None]
_DAMAGE_LABEL_TERMS = frozenset(
    {
        "dent",
        "scratch",
        "damage",
        "crack",
        "broken",
        "break",
        "intense",
        "flood",
        "flooded",
        "fire",
        "scuff",
        "tear",
    }
)


class AdvancedVideoAnalysisError(RuntimeError):
    """Advanced stack could not produce a result; legacy pipeline may run instead."""


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _label_terms(value: str) -> set[str]:
    return {
        token
        for token in re.sub(r"[^a-z0-9]+", " ", str(value or "").strip().lower()).split()
        if token
    }


def _is_damage_only_label(value: str) -> bool:
    terms = _label_terms(value)
    return bool(terms) and terms.issubset(_DAMAGE_LABEL_TERMS)


def _has_module(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


def _parse_part_class_map(raw: str) -> dict[str, str]:
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return {str(k).strip(): str(v).strip() for k, v in data.items() if str(k).strip()}
    except (json.JSONDecodeError, TypeError, ValueError):
        logger.warning("VIDEO_ADVANCED_PART_CLASS_MAP is not valid JSON; ignoring.")
    return {}


def _resolve_detector_weights_path(vp: VideoPipelineSettings) -> Path:
    raw = (vp.advanced_detector_model_path or "").strip()
    if raw:
        return Path(raw)
    return (
        Path(django_settings.BASE_DIR)
        / "damage_detection_llm"
        / "damage_detection_YOLO_model"
        / "best.pt"
    )


@lru_cache(maxsize=8)
def _inspect_detector_labels(weights_path_str: str) -> dict[int, str]:
    from ultralytics import YOLO  # type: ignore[import-untyped]

    model = YOLO(weights_path_str)
    raw_names = getattr(model, "names", {}) or {}
    return {int(key): str(value).strip() for key, value in raw_names.items()}


def _resolve_allowed_class_ids(
    names: dict[int, str],
    class_map: dict[str, str],
) -> set[int] | None:
    if not class_map:
        return None

    allowed: set[int] = set()
    lower_name_to_id = {str(value).strip().lower(): key for key, value in names.items()}
    for raw_key in class_map:
        key = str(raw_key).strip()
        if not key:
            continue
        try:
            allowed.add(int(key))
            continue
        except (TypeError, ValueError):
            pass
        match = lower_name_to_id.get(key.lower())
        if match is not None:
            allowed.add(match)
    return allowed or None


def get_advanced_pipeline_capabilities(
    pipeline_settings: VideoPipelineSettings | None = None,
) -> dict[str, Any]:
    vp = pipeline_settings or load_video_pipeline_settings()
    class_map = _parse_part_class_map(vp.advanced_part_class_map_json)
    weights = _resolve_detector_weights_path(vp)
    reasons: list[str] = []

    ultralytics_ready = _has_module("ultralytics")
    lap_ready = _has_module("lap")
    pyav_ready = _has_module("av")
    ssim_ready = _has_module("skimage")
    langgraph_ready = _has_module("langgraph")

    detector_names: dict[int, str] = {}
    if not ultralytics_ready:
        reasons.append("ultralytics is not installed.")
    if not lap_ready:
        reasons.append("lap is not installed for ByteTrack association.")
    if not weights.is_file():
        reasons.append(f"detector weights not found at {weights}.")
    elif ultralytics_ready:
        try:
            detector_names = _inspect_detector_labels(str(weights))
        except Exception as exc:
            reasons.append(f"detector weights could not be inspected: {exc}")

    detector_labels = [label for _, label in sorted(detector_names.items()) if str(label).strip()]
    configured_targets = sorted(
        {
            str(value).strip()
            for value in class_map.values()
            if str(value).strip()
        }
    )

    if detector_labels and all(_is_damage_only_label(label) for label in detector_labels):
        reasons.append(
            "configured detector/classes appear damage-only; advanced video requires part-level tracking classes."
        )
    if not detector_labels and weights.is_file() and ultralytics_ready:
        reasons.append("detector model exposes no class labels.")

    segmentation_backend = (vp.advanced_segmentation_backend or "auto").strip().lower() or "auto"
    segmentation_available = False
    segmentation_mode = "disabled"
    if (vp.advanced_segmentation_adapter or "").strip():
        segmentation_available = True
        segmentation_mode = "adapter"
    elif (vp.advanced_segmentation_model_path or "").strip():
        segmentation_available = ultralytics_ready
        segmentation_mode = "ultralytics_sam"
        if not segmentation_available and vp.advanced_require_segmentation:
            reasons.append("segmentation model configured but ultralytics SAM is unavailable.")
    elif vp.advanced_require_segmentation:
        reasons.append("segmentation is required but no segmentation backend is configured.")

    return {
        "available": not reasons and vp.advanced_enabled,
        "enabled": bool(vp.advanced_enabled),
        "reasons": reasons,
        "weights_path": str(weights),
        "detector_class_names": detector_labels,
        "configured_part_labels": configured_targets,
        "allowed_class_ids": sorted(_resolve_allowed_class_ids(detector_names, class_map) or []),
        "tracker": (vp.advanced_tracker_config or "bytetrack.yaml").strip() or "bytetrack.yaml",
        "scene_decoder": "pyav" if pyav_ready else "opencv",
        "scene_similarity": "ssim" if ssim_ready else "histogram",
        "segmentation_backend": segmentation_backend,
        "segmentation_mode": segmentation_mode,
        "segmentation_available": segmentation_available,
        "langgraph_available": langgraph_ready,
    }


def _scene_scores_pyav_ssim(video_path: str, *, max_frames: int) -> tuple[list[float], dict[str, Any]]:
    """Return per-frame scene-change scores (higher = more change). Prefer PyAV + SSIM."""
    scores: list[float] = []
    meta: dict[str, Any] = {"decoder": "opencv", "ssim": False}
    prev_gray: np.ndarray | None = None

    try:
        import av  # type: ignore[import-untyped]

        container = av.open(str(video_path))
        stream = container.streams.video[0]
        meta["decoder"] = "pyav"
        for i, frame in enumerate(container.decode(stream)):
            if i >= max_frames:
                break
            img = frame.to_ndarray(format="rgb24")
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
            scores.append(_ssim_change(prev_gray, gray))
            prev_gray = gray
        return scores, meta
    except Exception as exc:
        logger.debug("PyAV scene scoring unavailable (%s); using OpenCV fallback.", exc)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise AdvancedVideoAnalysisError("Unable to open video for scene scoring.")
    try:
        i = 0
        while i < max_frames:
            ok, frame_bgr = cap.read()
            if not ok:
                break
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
            scores.append(_ssim_change(prev_gray, gray))
            prev_gray = gray
            i += 1
        return scores, meta
    finally:
        cap.release()


def _ssim_change(prev_gray: np.ndarray | None, gray: np.ndarray) -> float:
    if prev_gray is None:
        return 0.0
    try:
        from skimage.metrics import structural_similarity as ssim  # type: ignore[import-untyped]

        s = float(ssim(prev_gray, gray, data_range=255))
        return _clamp01(1.0 - s)
    except Exception:
        hist_a = cv2.calcHist([prev_gray], [0], None, [64], [0, 256])
        hist_b = cv2.calcHist([gray], [0], None, [64], [0, 256])
        return _clamp01(float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_BHATTACHARYYA)))


def _vid_stride_from_scene(
    frame_count: int,
    scene_scores: list[float],
    *,
    vp: VideoPipelineSettings,
) -> int:
    if frame_count <= 1:
        return 1
    target = max(1, int(math.ceil(math.sqrt(frame_count)) * vp.advanced_sampling_budget_multiplier))
    stride = max(1, int(round(frame_count / max(1, target))))
    if scene_scores:
        arr = np.array(scene_scores, dtype=np.float64)
        q = float(vp.advanced_scene_change_quantile)
        thresh = float(np.quantile(arr, q)) if len(arr) else 0.0
        # Slightly reduce stride when scene is dynamic (more changes).
        if thresh > 0.15:
            stride = max(1, stride - 1)
    return stride


def _part_label_for_class(
    cls_id: int,
    names: dict[int, str],
    class_map: dict[str, str],
) -> str:
    raw = names.get(cls_id, str(cls_id))
    return class_map.get(str(cls_id), class_map.get(raw, raw))


def _crop_xyxy(
    frame_bgr: np.ndarray,
    xyxy: list[float],
    *,
    pad_ratio: float,
) -> np.ndarray:
    h, w = frame_bgr.shape[:2]
    x1, y1, x2, y2 = [float(x) for x in xyxy]
    bw, bh = max(1.0, x2 - x1), max(1.0, y2 - y1)
    pad_w, pad_h = bw * pad_ratio, bh * pad_ratio
    xa = int(max(0, math.floor(x1 - pad_w)))
    ya = int(max(0, math.floor(y1 - pad_h)))
    xb = int(min(w, math.ceil(x2 + pad_w)))
    yb = int(min(h, math.ceil(y2 + pad_h)))
    if xb <= xa or yb <= ya:
        return frame_bgr
    return frame_bgr[ya:yb, xa:xb]


def _optional_sam_mask(
    frame_bgr: np.ndarray,
    xyxy: list[float],
    vp: VideoPipelineSettings,
) -> dict[str, Any] | None:
    if not (vp.advanced_segmentation_model_path or "").strip():
        return None
    backend = (vp.advanced_segmentation_backend or "auto").lower()
    if backend not in {"auto", "ultralytics", "adapter"}:
        return None
    path = vp.advanced_segmentation_model_path.strip()
    if backend == "adapter" and (vp.advanced_segmentation_adapter or "").strip():
        return _sam_via_adapter(frame_bgr, xyxy, vp)
    try:
        from ultralytics import SAM  # type: ignore[import-untyped]

        model = SAM(path)
        res = model.predict(frame_bgr, bboxes=[xyxy], verbose=False)
        if res and getattr(res[0], "masks", None) is not None:
            masks = res[0].masks
            shape = None
            if masks is not None and getattr(masks, "data", None) is not None:
                shape = tuple(getattr(masks.data, "shape", ()) or ())
            return {"backend": "ultralytics_sam", "mask_shape": shape}
    except Exception as exc:
        logger.debug("Ultralytics SAM segmentation skipped: %s", exc)
    if vp.advanced_require_segmentation:
        raise AdvancedVideoAnalysisError("Segmentation required but SAM backend failed.")
    return None


def _sam_via_adapter(frame_bgr: np.ndarray, xyxy: list[float], vp: VideoPipelineSettings) -> dict[str, Any]:
    dotted = (vp.advanced_segmentation_adapter or "").strip()
    if not dotted:
        return {}
    try:
        module_name, _, attr = dotted.rpartition(".")
        mod = __import__(module_name, fromlist=[attr])
        fn = getattr(mod, attr)
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        out = fn(
            frame_rgb=frame_rgb,
            bbox_xyxy=xyxy,
            model_path=vp.advanced_segmentation_model_path,
        )
        if isinstance(out, dict):
            return {"backend": "custom_adapter", **out}
    except Exception as exc:
        logger.warning("Custom SAM adapter failed: %s", exc)
        if vp.advanced_require_segmentation:
            raise AdvancedVideoAnalysisError("Custom segmentation adapter failed.") from exc
    return {}


def _run_yolo_bytetrack(
    video_path: str,
    *,
    vp: VideoPipelineSettings,
    vid_stride: int,
    deadline: float,
    probe: dict[str, Any],
) -> tuple[dict[int, dict[str, Any]], dict[int, str], dict[str, Any]]:
    from ultralytics import YOLO  # type: ignore[import-untyped]

    weights = _resolve_detector_weights_path(vp)
    if not weights.is_file():
        raise AdvancedVideoAnalysisError(f"YOLO weights not found at {weights}")

    model = YOLO(str(weights))
    names = {int(k): str(v) for k, v in (model.names or {}).items()}
    tracker = (vp.advanced_tracker_config or "bytetrack.yaml").strip() or "bytetrack.yaml"
    class_map = _parse_part_class_map(vp.advanced_part_class_map_json)
    allowed_class_ids = _resolve_allowed_class_ids(names, class_map)

    tracks: dict[int, dict[str, Any]] = {}
    fps = float(probe.get("frame_rate") or 0.0) or 25.0
    detection_count = 0

    vs = max(1, int(vid_stride))
    stream = model.track(
        source=str(video_path),
        stream=True,
        persist=True,
        tracker=tracker,
        conf=float(vp.advanced_detection_confidence),
        iou=float(vp.advanced_detection_iou),
        vid_stride=vs,
        verbose=False,
    )

    processed = 0
    for result in stream:
        if time.monotonic() > deadline:
            raise AdvancedVideoAnalysisError("Timeout during YOLO/ByteTrack processing.")
        if processed >= vp.advanced_max_track_frames:
            logger.warning(
                "Advanced video: hit VIDEO_ADVANCED_MAX_TRACK_FRAMES=%s",
                vp.advanced_max_track_frames,
            )
            break
        processed += 1
        frame_idx = (processed - 1) * vs
        timestamp_ms = int(round((frame_idx / max(fps, 1e-6)) * 1000.0))

        boxes = getattr(result, "boxes", None)
        img = getattr(result, "orig_img", None)
        if boxes is None or img is None or boxes.id is None or len(boxes) == 0:
            continue

        for i in range(len(boxes)):
            tid = int(boxes.id[i].item())
            cls_id = int(boxes.cls[i].item())
            if allowed_class_ids is not None and cls_id not in allowed_class_ids:
                continue
            conf = float(boxes.conf[i].item())
            xyxy = boxes.xyxy[i].cpu().numpy().tolist()
            detection_count += 1

            obs = tracks.setdefault(
                tid,
                {
                    "track_id": tid,
                    "class_ids": [],
                    "observations": [],
                },
            )
            obs["class_ids"].append(cls_id)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            clarity = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            obs["observations"].append(
                {
                    "frame_index": frame_idx,
                    "timestamp_ms": timestamp_ms,
                    "xyxy": [float(x) for x in xyxy],
                    "confidence": conf,
                    "class_id": cls_id,
                    "clarity": clarity,
                    "width": max(0.0, float(xyxy[2]) - float(xyxy[0])),
                    "height": max(0.0, float(xyxy[3]) - float(xyxy[1])),
                    "area": max(0.0, (float(xyxy[2]) - float(xyxy[0])) * (float(xyxy[3]) - float(xyxy[1]))),
                    "frame_bgr": img.copy(),
                }
            )

    return (
        tracks,
        names,
        {
            "processed_frames": processed,
            "detection_count": detection_count,
            "allowed_class_ids": sorted(allowed_class_ids) if allowed_class_ids else [],
            "tracker": tracker,
            "detector_weights": str(weights),
        },
    )


def _observation_score(observation: dict[str, Any]) -> float:
    confidence = float(observation.get("confidence") or 0.0)
    clarity = float(observation.get("clarity") or 0.0)
    area = max(1.0, float(observation.get("area") or 0.0))
    return confidence * math.log1p(clarity + 1.0) * math.log1p(area)


def _pick_best_observation(observations: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not observations:
        return None
    return max(observations, key=_observation_score)


def _select_track_observations(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not observations:
        return []
    ordered = sorted(
        observations,
        key=lambda item: (
            int(item.get("timestamp_ms") or 0),
            int(item.get("frame_index") or 0),
        ),
    )
    if len(ordered) == 1:
        return ordered

    budget = max(1, min(len(ordered), int(math.ceil(math.log2(len(ordered) + 1)))))
    duration_ms = max(
        1,
        int(ordered[-1].get("timestamp_ms") or 0) - int(ordered[0].get("timestamp_ms") or 0),
    )
    min_spacing_ms = max(1, int(round(duration_ms / max(1, budget))))
    ranked = sorted(ordered, key=_observation_score, reverse=True)

    selected: list[dict[str, Any]] = []
    seen_keys: set[tuple[int, int]] = set()
    for candidate in ranked:
        key = (
            int(candidate.get("timestamp_ms") or 0),
            int(candidate.get("frame_index") or 0),
        )
        if key in seen_keys:
            continue
        if any(abs(key[0] - int(existing.get("timestamp_ms") or 0)) < min_spacing_ms for existing in selected):
            continue
        selected.append(candidate)
        seen_keys.add(key)
        if len(selected) >= budget:
            break

    for anchor in (ordered[0], _pick_best_observation(ordered), ordered[-1]):
        if not anchor or len(selected) >= budget:
            continue
        key = (
            int(anchor.get("timestamp_ms") or 0),
            int(anchor.get("frame_index") or 0),
        )
        if key in seen_keys:
            continue
        if any(abs(key[0] - int(existing.get("timestamp_ms") or 0)) < min_spacing_ms for existing in selected):
            continue
        selected.append(anchor)
        seen_keys.add(key)

    return sorted(
        selected,
        key=lambda item: (
            int(item.get("timestamp_ms") or 0),
            int(item.get("frame_index") or 0),
        ),
    )


def run_advanced_video_analysis(
    video_path: str,
    *,
    complaint_id: str | None = None,
    incident_description: str | None = None,
    flood_coverage: bool = False,
    source_hint: str = "",
    progress_callback: ProgressCallback | None = None,
    pipeline_settings: VideoPipelineSettings | None = None,
) -> dict[str, Any]:
    """
    Preferred video pipeline: scene-aware sampling metadata, YOLO+ByteTrack,
    per-track VLM via existing frame assessor, then shared LLM fusion.
    """
    from claims.video_analysis import (
        _analyze_frame_bytes,
        _frame_fingerprint,
        compose_video_analysis_result,
        probe_video_metadata,
    )

    vp = pipeline_settings or load_video_pipeline_settings()
    capability = get_advanced_pipeline_capabilities(vp)
    if not capability.get("enabled", True):
        raise AdvancedVideoAnalysisError("Advanced video provider is disabled by configuration.")
    if not capability.get("available"):
        reasons = capability.get("reasons") or ["advanced prerequisites unavailable"]
        raise AdvancedVideoAnalysisError("; ".join(str(reason) for reason in reasons))

    deadline = time.monotonic() + min(int(vp.advanced_timeout_s), int(cfg.video_advanced_timeout_s))
    class_map = _parse_part_class_map(vp.advanced_part_class_map_json)

    probe = probe_video_metadata(video_path)
    fc = int(probe.get("frame_count") or 0)
    max_scene = min(fc or vp.advanced_max_track_frames, vp.advanced_max_track_frames)
    scene_scores, scene_meta = _scene_scores_pyav_ssim(video_path, max_frames=max_scene)
    vid_stride = _vid_stride_from_scene(fc or len(scene_scores) or 1, scene_scores, vp=vp)

    if progress_callback:
        progress_callback(
            "advanced_sampling",
            12.0,
            "Profiled scene dynamics (PyAV/OpenCV + SSIM or histogram fallback).",
            {"decoder": scene_meta.get("decoder"), "vid_stride": vid_stride},
        )

    tracks, names, tracking_meta = _run_yolo_bytetrack(
        video_path,
        vp=vp,
        vid_stride=vid_stride,
        deadline=deadline,
        probe=probe,
    )
    if not tracks:
        raise AdvancedVideoAnalysisError("No ByteTrack trajectories found.")

    if progress_callback:
        progress_callback(
            "advanced_tracking",
            38.0,
            f"YOLO + ByteTrack produced {len(tracks)} track(s).",
            {
                "tracker": vp.advanced_tracker_config,
                "tracks": len(tracks),
                "detections": tracking_meta.get("detection_count"),
            },
        )

    orchestration = "sequential"
    if vp.advanced_use_langgraph:
        try:
            import langgraph  # noqa: F401

            orchestration = "langgraph_available"
        except ImportError:
            orchestration = "sequential_langgraph_missing"

    selected_tracks: list[dict[str, Any]] = []
    for tid, data in sorted(tracks.items(), key=lambda item: int(item[0])):
        observations = _select_track_observations(data.get("observations") or [])
        if not observations:
            continue
        cls_ids = [int(value) for value in (data.get("class_ids") or [])]
        dominant_cls = int(max(set(cls_ids), key=cls_ids.count)) if cls_ids else int(
            observations[0].get("class_id") or 0
        )
        part_label = _part_label_for_class(dominant_cls, names, class_map)
        detector_class_name = str(names.get(dominant_cls, dominant_cls))
        all_timestamps = sorted(
            {
                int(item.get("timestamp_ms") or 0)
                for item in (data.get("observations") or [])
            }
        )
        selected_tracks.append(
            {
                "track_id": tid,
                "part_label": part_label,
                "dominant_class_id": dominant_cls,
                "detector_class_name": detector_class_name,
                "observations": observations,
                "observed_frame_count": len(data.get("observations") or []),
                "observed_timestamps_ms": all_timestamps,
            }
        )

    if not selected_tracks:
        raise AdvancedVideoAnalysisError("No representative tracked-part keyframes were selected.")

    total_selected_observations = sum(len(track["observations"]) for track in selected_tracks)
    frame_analyses: list[dict[str, Any]] = []
    track_summaries: list[dict[str, Any]] = []
    processed_observations = 0
    for track in selected_tracks:
        if time.monotonic() > deadline:
            raise AdvancedVideoAnalysisError("Timeout before per-track VLM stage.")

        tid = int(track["track_id"])
        part_label = str(track["part_label"])
        dominant_cls = int(track["dominant_class_id"])
        detector_class_name = str(track["detector_class_name"])
        selected_timestamps: list[int] = []

        for observation_rank, observation in enumerate(track["observations"], start=1):
            if time.monotonic() > deadline:
                raise AdvancedVideoAnalysisError("Timeout during per-track VLM stage.")

            frame_bgr = observation["frame_bgr"]
            xyxy = observation["xyxy"]
            crop = _crop_xyxy(
                frame_bgr,
                xyxy,
                pad_ratio=float(vp.advanced_keyframe_padding_ratio),
            )
            seg_meta = _optional_sam_mask(frame_bgr, xyxy, vp)
            ok, enc = cv2.imencode(".jpg", crop)
            if not ok:
                continue
            frame_bytes = enc.tobytes()

            processed_observations += 1
            fi = int(observation.get("frame_index") or 0)
            timestamp_ms = int(observation.get("timestamp_ms") or 0)
            selected_timestamps.append(timestamp_ms)
            if progress_callback:
                progress_callback(
                    "advanced_vlm",
                    40.0 + _clamp01(processed_observations / max(1, total_selected_observations)) * 35.0,
                    (
                        f"VLM assessment for track {tid} ({part_label}) "
                        f"keyframe {observation_rank} of {len(track['observations'])}."
                    ),
                    {
                        "track_id": tid,
                        "part": part_label,
                        "frame_index": fi,
                        "timestamp_ms": timestamp_ms,
                    },
                )

            analysis = _analyze_frame_bytes(
                frame_bytes,
                complaint_id=complaint_id,
                incident_description=incident_description,
                flood_coverage=flood_coverage,
                image_hint=f"{source_hint}#track{tid}:{fi}",
                enable_web_search=bool(vp.advanced_enable_web_search),
                prefer_agentic_pipeline=bool(vp.advanced_use_langgraph),
            )

            fp = _frame_fingerprint(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))
            if scene_scores:
                si = min(fi, len(scene_scores) - 1)
                sc = float(scene_scores[si])
            else:
                sc = 0.0

            frame_analyses.append(
                {
                    "frame_index": fi,
                    "timestamp_ms": timestamp_ms,
                    "motion_score": sc,
                    "scene_score": sc,
                    "clarity_score": float(observation.get("clarity") or 0.0),
                    "brightness_score": float(np.mean(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)) / 255.0),
                    "fingerprint": fp,
                    "frame_bytes": frame_bytes,
                    "analysis": {
                        "fraud_score": analysis["fraud_score"],
                        "fraud_reasoning": analysis["fraud_reasoning"],
                        "fraud_red_flags": analysis["fraud_red_flags"],
                        "damage_labels": analysis["damage_labels"],
                        "damage_severity": analysis["damage_severity"],
                        "damage_assessment": analysis.get("damage_assessment") or {},
                    },
                    "image_fraud": analysis["image_fraud"],
                    "advanced_track_id": tid,
                    "advanced_part_label": part_label,
                    "advanced_detector_class_id": dominant_cls,
                    "advanced_detector_class_name": detector_class_name,
                    "advanced_observation_rank": observation_rank,
                    "advanced_observation_count": len(track["observations"]),
                    "advanced_segmentation": seg_meta,
                }
            )

        track_summaries.append(
            {
                "track_id": tid,
                "part_label": part_label,
                "detector_class_id": dominant_cls,
                "detector_class_name": detector_class_name,
                "observed_frame_count": int(track["observed_frame_count"]),
                "selected_keyframe_count": len(selected_timestamps),
                "observed_timestamps_ms": track["observed_timestamps_ms"],
                "selected_timestamps_ms": selected_timestamps,
            }
        )

    if not frame_analyses:
        raise AdvancedVideoAnalysisError("No per-track frames produced for VLM.")

    metadata = dict(probe)
    peak_frame = max(
        frame_analyses,
        key=lambda item: float(item.get("motion_score") or item.get("scene_score") or 0.0),
    )
    metadata["sampling_stride"] = vid_stride
    metadata["sample_count"] = int(tracking_meta.get("processed_frames") or len(scene_scores) or 0)
    metadata["representative_frame_count"] = len(frame_analyses)
    metadata["duplicate_sample_count"] = 0
    metadata["scene_decoder"] = scene_meta.get("decoder")
    metadata["advanced_orchestration"] = orchestration
    metadata["advanced_track_count"] = len(track_summaries)
    metadata["advanced_detection_count"] = int(tracking_meta.get("detection_count") or 0)
    metadata["advanced_selected_keyframe_count"] = total_selected_observations
    metadata["duplicate_sample_ratio"] = 0.0
    metadata["peak_motion_timestamp_ms"] = int(peak_frame.get("timestamp_ms") or 0)
    metadata["average_motion_score"] = round(
        float(np.mean([float(f.get("motion_score") or 0.0) for f in frame_analyses])),
        6,
    )
    metadata["average_scene_score"] = round(
        float(np.mean([float(f.get("scene_score") or 0.0) for f in frame_analyses])),
        6,
    )

    sampling_extra = {
        "vid_stride": vid_stride,
        "scene_decoder": scene_meta.get("decoder"),
        "scene_similarity": capability.get("scene_similarity"),
        "tracker": tracking_meta.get("tracker") or vp.advanced_tracker_config,
        "detector_weights": tracking_meta.get("detector_weights") or str(_resolve_detector_weights_path(vp)),
        "track_count": len(track_summaries),
        "detection_count": tracking_meta.get("detection_count"),
        "keyframe_count": len(frame_analyses),
        "allowed_class_ids": tracking_meta.get("allowed_class_ids") or capability.get("allowed_class_ids") or [],
    }
    context_extra = {
        "advanced_pipeline": {
            "stages": [
                "intelligent_sampling",
                "yolo_bytetrack",
                "optional_sam",
                "per_track_vlm",
                "temporal_aggregation",
                "pricing_agent_optional",
            ],
            "orchestration": orchestration,
            "web_search_enabled": bool(vp.advanced_enable_web_search),
            "langgraph_agentic_preference": bool(vp.advanced_use_langgraph),
            "capabilities": capability,
            "tracks": track_summaries,
        }
    }

    return compose_video_analysis_result(
        metadata=metadata,
        frame_analyses=frame_analyses,
        representative_samples=frame_analyses,
        pipeline_version="video_analysis_advanced_v1",
        sampling_strategy="pyav_ssim_adaptive_yolo_bytetrack",
        sampling_extra=sampling_extra,
        analysis_context_extra=context_extra,
        progress_callback=progress_callback,
        summary_progress_message=(
            "Generated accident-scenario and fraud summary from tracked part keyframes."
        ),
    )
