from __future__ import annotations

import base64
from collections import Counter
from decimal import Decimal
import hashlib
import json
import logging
import math
import tempfile
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

from claim_automation.llm_client import ChatCompletionTarget, get_chat_completion_target
from claims.video_pipeline_config import load_video_pipeline_settings
from claims.video_runtime import (
    build_video_provider_selection_preview,
    get_video_pipeline_runtime_status,
)
from damage_detection_llm.image_fraud_service import analyze_image_fraud
from damage_detection_llm.services import run_damage_assessment, run_damage_assessment_detailed

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, float, str, dict[str, Any] | None], None]
_SEVERITY_RANK = {"unknown": 0, "minor": 1, "moderate": 2, "severe": 3}


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _timestamp_label(timestamp_ms: int | float | None) -> str:
    total_ms = max(0, int(round(float(timestamp_ms or 0))))
    total_seconds, ms = divmod(total_ms, 1000)
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{ms:03d}"
    return f"{minutes:02d}:{seconds:02d}.{ms:03d}"


def probe_video_metadata(video_path: str) -> dict[str, Any]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Unable to open video: {video_path}")
    try:
        frame_count = int(max(capture.get(cv2.CAP_PROP_FRAME_COUNT), 0))
        frame_rate = float(max(capture.get(cv2.CAP_PROP_FPS), 0.0))
        width = int(max(capture.get(cv2.CAP_PROP_FRAME_WIDTH), 0))
        height = int(max(capture.get(cv2.CAP_PROP_FRAME_HEIGHT), 0))
        duration_ms = 0
        if frame_count > 0 and frame_rate > 0:
            duration_ms = int(round((frame_count / frame_rate) * 1000.0))
        elif frame_rate > 0:
            duration_ms = int(round(capture.get(cv2.CAP_PROP_POS_MSEC)))
        return {
            "frame_count": frame_count,
            "frame_rate": round(frame_rate, 4) if frame_rate > 0 else None,
            "width": width or None,
            "height": height or None,
            "duration_ms": duration_ms or None,
        }
    finally:
        capture.release()


def _sampling_stride(frame_count: int) -> int:
    if frame_count <= 1:
        return 1
    target_samples = max(1, int(math.ceil(math.sqrt(frame_count))))
    return max(1, int(round(frame_count / target_samples)))


def _encode_frame(frame_bgr: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".jpg", frame_bgr)
    if not ok:
        raise ValueError("Failed to encode frame as JPEG")
    return encoded.tobytes()


def _frame_fingerprint(gray_frame: np.ndarray) -> str:
    resized = cv2.resize(gray_frame, (64, 64))
    return hashlib.sha256(resized.tobytes()).hexdigest()


def _clarity_score(gray_frame: np.ndarray) -> float:
    variance = cv2.Laplacian(gray_frame, cv2.CV_64F).var()
    return float(variance)


def _build_sample_payloads(
    video_path: str,
    *,
    progress_callback: ProgressCallback | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    metadata = probe_video_metadata(video_path)
    frame_count = int(metadata.get("frame_count") or 0)
    stride = _sampling_stride(frame_count if frame_count > 0 else 1)

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError(f"Unable to open video: {video_path}")

    previous_gray: np.ndarray | None = None
    samples: list[dict[str, Any]] = []
    duplicate_count = 0
    fingerprints_seen: dict[str, int] = {}
    frame_index = 0

    try:
        while True:
            ok, frame_bgr = capture.read()
            if not ok:
                break
            should_process = (
                frame_index == 0
                or stride == 1
                or frame_index % stride == 0
                or (frame_count > 0 and frame_index == frame_count - 1)
            )
            if not should_process:
                frame_index += 1
                continue

            timestamp_ms = int(
                round(capture.get(cv2.CAP_PROP_POS_MSEC))
            ) or int(
                round(
                    (frame_index / max(float(metadata.get("frame_rate") or 1.0), 1.0))
                    * 1000.0
                )
            )
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
            brightness = float(np.mean(gray) / 255.0)
            clarity = _clarity_score(gray)
            fingerprint = _frame_fingerprint(gray)
            if fingerprint in fingerprints_seen:
                duplicate_count += 1
            fingerprints_seen[fingerprint] = fingerprints_seen.get(fingerprint, 0) + 1

            motion_score = 0.0
            scene_score = 0.0
            if previous_gray is not None:
                frame_delta = cv2.absdiff(gray, previous_gray)
                motion_score = float(np.mean(frame_delta) / 255.0)
                hist_a = cv2.calcHist([gray], [0], None, [64], [0, 256])
                hist_b = cv2.calcHist([previous_gray], [0], None, [64], [0, 256])
                scene_score = float(
                    cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_BHATTACHARYYA)
                )
            previous_gray = gray
            samples.append(
                {
                    "frame_index": frame_index,
                    "timestamp_ms": timestamp_ms,
                    "motion_score": motion_score,
                    "scene_score": scene_score,
                    "brightness_score": brightness,
                    "clarity_score": clarity,
                    "fingerprint": fingerprint,
                    "frame_bytes": _encode_frame(frame_bgr),
                }
            )
            if progress_callback:
                processed = len(samples)
                total = max(1, int(math.ceil(math.sqrt(frame_count or processed))))
                percent = _clamp01(processed / total) * 35.0
                progress_callback(
                    "sampling",
                    percent,
                    f"Sampled {processed} video frame(s) for motion analysis.",
                    {
                        "sampled_frames": processed,
                        "sampling_stride": stride,
                    },
                )
            frame_index += 1
    finally:
        capture.release()

    metadata["sampling_stride"] = stride
    metadata["duplicate_sample_count"] = duplicate_count
    metadata["sample_count"] = len(samples)
    return metadata, samples


def _representative_samples(
    samples: list[dict[str, Any]],
    *,
    duration_ms: int | None,
) -> list[dict[str, Any]]:
    if not samples:
        return []

    budget = max(1, int(math.ceil(math.sqrt(len(samples)))))
    ranked = sorted(
        samples,
        key=lambda sample: (
            float(sample.get("motion_score") or 0.0)
            + float(sample.get("scene_score") or 0.0)
            + float(sample.get("clarity_score") or 0.0) / 1000.0
        ),
        reverse=True,
    )

    if len(samples) == 1:
        return [samples[0]]

    duration = max(1, int(duration_ms or samples[-1]["timestamp_ms"] or 1))
    min_spacing_ms = max(
        1,
        int(round(duration / max(1, budget))),
    )
    selected: list[dict[str, Any]] = []
    used_timestamps: list[int] = []

    for candidate in ranked:
        timestamp_ms = int(candidate.get("timestamp_ms") or 0)
        if any(abs(timestamp_ms - ts) < min_spacing_ms for ts in used_timestamps):
            continue
        selected.append(candidate)
        used_timestamps.append(timestamp_ms)
        if len(selected) >= budget:
            break

    anchors = [samples[0], samples[-1]]
    for anchor in anchors:
        timestamp_ms = int(anchor.get("timestamp_ms") or 0)
        if any(
            abs(timestamp_ms - int(existing.get("timestamp_ms") or 0)) < min_spacing_ms
            for existing in selected
        ):
            continue
        selected.append(anchor)

    return sorted(
        {sample["timestamp_ms"]: sample for sample in selected}.values(),
        key=lambda sample: (sample["timestamp_ms"], sample["frame_index"]),
    )


def _normalize_damage_severity(value: str | None) -> str:
    key = str(value or "unknown").strip().lower()
    return key if key in _SEVERITY_RANK else "unknown"


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _pricing_decimal(config_key: str, default: str) -> Decimal:
    from claims.models import PricingConfig

    row = PricingConfig.objects.filter(config_key=config_key, is_active=True).first()
    raw = str(row.config_value).strip() if row else default
    try:
        return Decimal(raw)
    except Exception:
        return Decimal(default)


def _video_decision_policy() -> dict[str, Any]:
    weights = {
        "fraud_score": _pricing_decimal("VIDEO_POLICY_FRAUD_WEIGHT", "0.40"),
        "fraud_red_flags": _pricing_decimal("VIDEO_POLICY_RED_FLAG_WEIGHT", "0.20"),
        "duplicate_ratio": _pricing_decimal("VIDEO_POLICY_DUPLICATE_WEIGHT", "0.15"),
        "scene_discontinuity": _pricing_decimal("VIDEO_POLICY_SCENE_WEIGHT", "0.10"),
        "damage_severity": _pricing_decimal("VIDEO_POLICY_DAMAGE_WEIGHT", "0.15"),
    }
    threshold = _pricing_decimal("VIDEO_MANUAL_REVIEW_THRESHOLD", "0.55")
    return {
        "manual_review_threshold": float(max(Decimal("0"), min(Decimal("1"), threshold))),
        "weights": {key: float(max(Decimal("0"), value)) for key, value in weights.items()},
    }


def _aggregate_damage_assessment(frame_analyses: list[dict[str, Any]]) -> dict[str, Any]:
    labels: list[str] = []
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    frame_costs: list[float] = []
    currency_counts: Counter[str] = Counter()
    highest_severity_percent = 0

    for frame in frame_analyses:
        analysis = frame.get("analysis") or {}
        for label in analysis.get("damage_labels") or []:
            label_value = str(label).strip()
            if label_value and label_value not in labels:
                labels.append(label_value)

        assessment = analysis.get("damage_assessment") or {}
        currency_code = str(assessment.get("currency_code") or "").strip().upper()
        if currency_code:
            currency_counts[currency_code] += 1

        total_estimated_cost = _safe_float(assessment.get("total_estimated_cost"), 0.0)
        if total_estimated_cost > 0:
            frame_costs.append(total_estimated_cost)

        for part in assessment.get("part_breakdown") or []:
            if not isinstance(part, dict):
                continue
            part_name = str(part.get("part") or "").strip()
            damage_type = str(part.get("damage_type") or "").strip().lower()
            if not part_name or not damage_type:
                continue

            timestamp_ms = _safe_int(frame.get("timestamp_ms"), 0)
            severity_percent = max(0, min(100, _safe_int(part.get("severity_percent"), 0)))
            estimated_cost = max(0.0, _safe_float(part.get("estimated_cost"), 0.0))
            repair_action = str(part.get("repair_action") or "REPAIR").strip().upper() or "REPAIR"
            highest_severity_percent = max(highest_severity_percent, severity_percent)

            key = (part_name.lower(), damage_type)
            entry = grouped.setdefault(
                key,
                {
                    "part": part_name,
                    "damage_type": damage_type,
                    "max_severity_percent": severity_percent,
                    "estimated_costs": [],
                    "repair_actions": [],
                    "observed_timestamps_ms": [],
                },
            )
            entry["max_severity_percent"] = max(
                int(entry.get("max_severity_percent") or 0),
                severity_percent,
            )
            entry["estimated_costs"].append(estimated_cost)
            entry["repair_actions"].append(repair_action)
            entry["observed_timestamps_ms"].append(timestamp_ms)

    aggregated_parts = []
    for entry in grouped.values():
        cost_values = [float(value) for value in entry.get("estimated_costs") or [] if value >= 0]
        action_counts = Counter(
            str(action).strip().upper() or "REPAIR"
            for action in entry.get("repair_actions") or []
        )
        timestamps_ms = sorted(
            {max(0, _safe_int(value, 0)) for value in entry.get("observed_timestamps_ms") or []}
        )
        aggregated_parts.append(
            {
                "part": entry["part"],
                "damage_type": entry["damage_type"],
                "max_severity_percent": int(entry.get("max_severity_percent") or 0),
                "repair_action": action_counts.most_common(1)[0][0] if action_counts else "REPAIR",
                "estimated_cost_min": round(min(cost_values), 2) if cost_values else 0.0,
                "estimated_cost_max": round(max(cost_values), 2) if cost_values else 0.0,
                "observed_frame_count": len(timestamps_ms),
                "observed_timestamps_ms": timestamps_ms,
                "observed_timestamps": [_timestamp_label(value) for value in timestamps_ms],
            }
        )

    aggregated_parts.sort(
        key=lambda item: (
            -int(item.get("max_severity_percent") or 0),
            str(item.get("part") or ""),
            str(item.get("damage_type") or ""),
        )
    )
    dominant_currency = currency_counts.most_common(1)[0][0] if currency_counts else ""

    return {
        "damage_labels": labels,
        "currency_code": dominant_currency,
        "aggregated_parts": aggregated_parts,
        "part_count": len(aggregated_parts),
        "highest_severity_percent": highest_severity_percent,
        "max_estimated_frame_cost": round(max(frame_costs), 2) if frame_costs else 0.0,
        "average_estimated_frame_cost": round(float(np.mean(frame_costs)), 2) if frame_costs else 0.0,
    }


def _build_decision_support(
    *,
    metadata: dict[str, Any],
    frame_analyses: list[dict[str, Any]],
    damage_assessment: dict[str, Any],
    summary_text: str,
) -> dict[str, Any]:
    policy = _video_decision_policy()
    fraud_scores = [
        _safe_float(item.get("analysis", {}).get("fraud_score"), 0.0)
        for item in frame_analyses
    ]
    highest_fraud_score = max(fraud_scores, default=0.0) / 100.0
    fraud_red_flag_count = sum(
        len((item.get("analysis", {}).get("fraud_red_flags") or []))
        for item in frame_analyses
    )
    fraud_red_flag_density = min(
        1.0,
        fraud_red_flag_count / max(1, len(frame_analyses)),
    )
    duplicate_ratio = _safe_float(metadata.get("duplicate_sample_ratio"), 0.0)
    scene_discontinuity = min(
        1.0,
        max(
            _safe_float(metadata.get("average_scene_score"), 0.0),
            max(
                (_safe_float(item.get("scene_score"), 0.0) for item in frame_analyses),
                default=0.0,
            ),
        ),
    )
    damage_severity = min(
        1.0,
        _safe_float(damage_assessment.get("highest_severity_percent"), 0.0) / 100.0,
    )

    signals = {
        "fraud_score": round(highest_fraud_score, 6),
        "fraud_red_flags": round(fraud_red_flag_density, 6),
        "duplicate_ratio": round(duplicate_ratio, 6),
        "scene_discontinuity": round(scene_discontinuity, 6),
        "damage_severity": round(damage_severity, 6),
    }
    active_weights = {
        key: float(value)
        for key, value in (policy.get("weights") or {}).items()
        if float(value) > 0
    }
    weighted_total = sum(active_weights.values()) or 1.0
    risk_score = sum(signals.get(key, 0.0) * weight for key, weight in active_weights.items()) / weighted_total
    recommended_action = (
        "manual_review"
        if risk_score >= float(policy.get("manual_review_threshold") or 0.55)
        else "standard_review"
    )
    rationale = (
        f"{summary_text} Composite review risk={round(risk_score, 4)} based on "
        f"fraud={round(signals['fraud_score'], 4)}, red_flags={round(signals['fraud_red_flags'], 4)}, "
        f"duplicate_ratio={round(signals['duplicate_ratio'], 4)}, scene_discontinuity={round(signals['scene_discontinuity'], 4)}, "
        f"damage_severity={round(signals['damage_severity'], 4)}."
    )
    return {
        "recommended_action": recommended_action,
        "rationale": rationale,
        "policy_source": "risk_policy",
        "risk_score": round(risk_score, 6),
        "signals": signals,
        "policy_snapshot_json": _json_safe(policy),
    }


def _analyze_frame_bytes(
    frame_bytes: bytes,
    *,
    complaint_id: str | None,
    incident_description: str | None,
    flood_coverage: bool,
    image_hint: str,
    enable_web_search: bool = False,
    prefer_agentic_pipeline: bool = True,
) -> dict[str, Any]:
    tmp_name = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp.write(frame_bytes)
            tmp_name = tmp.name

        fraud_result = analyze_image_fraud(tmp_name)
        damage_assessment = None
        if complaint_id:
            try:
                damage_assessment = run_damage_assessment_detailed(
                    tmp_name,
                    complaint_id=complaint_id,
                    incident_description=incident_description,
                    flood_coverage=flood_coverage,
                    image_url=image_hint,
                    enable_web_search=enable_web_search,
                    persist_claim_rows=False,
                    prefer_agentic_pipeline=prefer_agentic_pipeline,
                )
            except Exception:
                logger.exception("Detailed damage assessment for video frame failed")

        if damage_assessment:
            damages = damage_assessment.get("damages") or []
            severity = damage_assessment.get("severity") or "unknown"
        else:
            damages, severity = run_damage_assessment(
                tmp_name,
                incident_description=incident_description,
                flood_coverage=flood_coverage,
                image_url=image_hint,
            )
            damage_assessment = {
                "damages": damages,
                "severity": severity,
                "part_breakdown": [],
                "total_parts": 0,
                "total_estimated_cost": 0.0,
                "currency_code": "",
                "pipeline_metadata": {
                    "analysis_source": "frame_damage_summary_only",
                },
            }
        return {
            "fraud_score": float(fraud_result.get("fraud_score") or 0),
            "fraud_reasoning": (
                (fraud_result.get("llm_authenticity") or {}).get("reasoning") or ""
            ),
            "fraud_red_flags": (
                (fraud_result.get("llm_authenticity") or {}).get("red_flags") or []
            ),
            "damage_labels": list(damages or []),
            "damage_severity": _normalize_damage_severity(severity),
            "damage_assessment": _json_safe(damage_assessment),
            "image_fraud": fraud_result,
        }
    finally:
        if tmp_name:
            try:
                Path(tmp_name).unlink(missing_ok=True)
            except Exception:
                pass


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    text = str(raw_text or "").strip()
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        parsed = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _frame_context_payload(frame: dict[str, Any]) -> dict[str, Any]:
    analysis = frame.get("analysis") or {}
    damage_assessment = analysis.get("damage_assessment") or {}
    return {
        "timestamp_ms": frame["timestamp_ms"],
        "timestamp_label": _timestamp_label(frame["timestamp_ms"]),
        "frame_index": frame["frame_index"],
        "motion_score": round(float(frame.get("motion_score") or 0.0), 6),
        "scene_score": round(float(frame.get("scene_score") or 0.0), 6),
        "clarity_score": round(float(frame.get("clarity_score") or 0.0), 6),
        "brightness_score": round(float(frame.get("brightness_score") or 0.0), 6),
        "damage_labels": analysis.get("damage_labels") or [],
        "damage_severity": analysis.get("damage_severity") or "",
        "fraud_score": analysis.get("fraud_score"),
        "fraud_red_flags": analysis.get("fraud_red_flags") or [],
        "damage_assessment": {
            "currency_code": damage_assessment.get("currency_code") or "",
            "total_parts": _safe_int(damage_assessment.get("total_parts"), 0),
            "total_estimated_cost": round(
                _safe_float(damage_assessment.get("total_estimated_cost"), 0.0), 2
            ),
            "part_breakdown": _json_safe(damage_assessment.get("part_breakdown") or []),
        },
    }


def _build_dynamic_timeline(frame_analyses: list[dict[str, Any]]) -> list[dict[str, Any]]:
    timeline = []
    for frame in frame_analyses:
        analysis = frame.get("analysis") or {}
        damage_assessment = analysis.get("damage_assessment") or {}
        motion_score = round(float(frame.get("motion_score") or 0.0), 4)
        scene_score = round(float(frame.get("scene_score") or 0.0), 4)
        damage_labels = list(analysis.get("damage_labels") or [])
        event_summary = (
            f"Representative video window with motion={motion_score} "
            f"and scene_change={scene_score}."
        )
        if damage_labels:
            event_summary += f" Visible damage cues: {', '.join(damage_labels)}."
        if damage_assessment.get("part_breakdown"):
            event_summary += (
                f" Estimated frame repair cost="
                f"{round(_safe_float(damage_assessment.get('total_estimated_cost'), 0.0), 2)}"
                f" {damage_assessment.get('currency_code') or ''}."
            )
        if analysis.get("fraud_score") is not None:
            event_summary += (
                f" Frame-level fraud score={round(float(analysis['fraud_score']), 2)}."
            )
        timeline.append(
            {
                "timestamp_ms": frame["timestamp_ms"],
                "timestamp_label": _timestamp_label(frame["timestamp_ms"]),
                "frame_index": frame["frame_index"],
                "summary": event_summary,
                "damage_labels": damage_labels,
                "fraud_score": analysis.get("fraud_score"),
                "damage_assessment": {
                    "currency_code": damage_assessment.get("currency_code") or "",
                    "total_parts": _safe_int(damage_assessment.get("total_parts"), 0),
                    "total_estimated_cost": round(
                        _safe_float(damage_assessment.get("total_estimated_cost"), 0.0), 2
                    ),
                },
            }
        )
    return timeline


def _build_derived_summary(
    *,
    metadata: dict[str, Any],
    representative_samples: list[dict[str, Any]],
    frame_analyses: list[dict[str, Any]],
) -> dict[str, Any]:
    duration_ms = int(metadata.get("duration_ms") or 0)
    sample_count = len(representative_samples)
    top_motion = max(
        (float(sample.get("motion_score") or 0.0) for sample in representative_samples),
        default=0.0,
    )
    top_scene = max(
        (float(sample.get("scene_score") or 0.0) for sample in representative_samples),
        default=0.0,
    )
    fraud_scores = [
        float(item.get("analysis", {}).get("fraud_score") or 0.0)
        for item in frame_analyses
    ]
    damage_labels = [
        label
        for item in frame_analyses
        for label in item.get("analysis", {}).get("damage_labels") or []
    ]
    unique_damage_labels = list(dict.fromkeys(str(label) for label in damage_labels if label))
    fraud_red_flag_count = sum(
        len((item.get("analysis", {}).get("fraud_red_flags") or []))
        for item in frame_analyses
    )
    aggregated_damage_assessment = _aggregate_damage_assessment(frame_analyses)
    summary_text = (
        f"Processed {sample_count} representative frame(s) across "
        f"{_timestamp_label(duration_ms)} of video. Peak motion occurred near "
        f"{_timestamp_label(metadata.get('peak_motion_timestamp_ms'))}."
    )
    if unique_damage_labels:
        summary_text += f" Visible damage cues included {', '.join(unique_damage_labels)}."
    if aggregated_damage_assessment.get("part_count"):
        summary_text += (
            f" Aggregated damage assessment identified "
            f"{aggregated_damage_assessment['part_count']} distinct damaged part pattern(s)."
        )
        if aggregated_damage_assessment.get("max_estimated_frame_cost"):
            summary_text += (
                f" Highest representative-frame repair estimate was "
                f"{aggregated_damage_assessment['max_estimated_frame_cost']} "
                f"{aggregated_damage_assessment.get('currency_code') or ''}."
            )
    if fraud_scores:
        summary_text += (
            f" Highest frame-level fraud score was {round(max(fraud_scores), 2)}."
        )

    observations = []
    if metadata.get("duplicate_sample_ratio") is not None:
        observations.append(
            {
                "summary": (
                    f"Repeated-frame ratio across sampled video windows was "
                    f"{round(float(metadata['duplicate_sample_ratio']) * 100, 2)}%."
                ),
                "metric": "duplicate_sample_ratio",
                "value": round(float(metadata["duplicate_sample_ratio"]), 4),
            }
        )
    observations.append(
        {
            "summary": (
                f"Peak motion score reached {round(top_motion, 4)} while peak scene-change "
                f"score reached {round(top_scene, 4)}."
            ),
            "metric": "motion_scene_peak",
            "value": round(top_motion + top_scene, 4),
        }
    )
    timeline = _build_dynamic_timeline(frame_analyses)
    decision_support = _build_decision_support(
        metadata=metadata,
        frame_analyses=frame_analyses,
        damage_assessment=aggregated_damage_assessment,
        summary_text=summary_text,
    )

    return {
        "summary_text": summary_text,
        "scenario_summary_json": {
            "summary_text": summary_text,
            "representative_frame_count": sample_count,
            "duration_ms": duration_ms or None,
            "damage_labels": unique_damage_labels,
            "damage_assessment": aggregated_damage_assessment,
        },
        "fraud_signals_json": {
            "observations": observations,
            "highest_frame_fraud_score": round(max(fraud_scores), 2) if fraud_scores else None,
            "fraud_red_flag_count": fraud_red_flag_count,
            "duplicate_sample_ratio": round(
                _safe_float(metadata.get("duplicate_sample_ratio"), 0.0), 6
            ),
        },
        "decision_support_json": decision_support,
        "timeline_json": timeline,
    }


def _merge_summary_layer(
    *,
    base: dict[str, Any],
    candidate: dict[str, Any] | None,
) -> dict[str, Any]:
    if not candidate:
        return base

    merged = dict(base)
    summary_text = str(candidate.get("summary_text") or "").strip()
    if summary_text:
        merged["summary_text"] = summary_text

    for key in ("scenario_summary_json", "fraud_signals_json", "decision_support_json"):
        base_section = dict(merged.get(key) or {})
        candidate_section = candidate.get(key)
        if isinstance(candidate_section, dict):
            base_section.update(_json_safe(candidate_section))
            merged[key] = base_section

    candidate_timeline = candidate.get("timeline_json")
    if isinstance(candidate_timeline, list) and candidate_timeline:
        normalized_timeline = []
        for item in candidate_timeline:
            if not isinstance(item, dict):
                continue
            normalized = dict(item)
            timestamp_ms = int(normalized.get("timestamp_ms") or 0)
            normalized["timestamp_ms"] = timestamp_ms
            normalized["timestamp_label"] = normalized.get("timestamp_label") or _timestamp_label(timestamp_ms)
            normalized_timeline.append(_json_safe(normalized))
        if normalized_timeline:
            merged["timeline_json"] = normalized_timeline
    return merged


def _target_descriptor(target: ChatCompletionTarget | None) -> dict[str, Any] | None:
    if target is None:
        return None
    return {
        "provider": target.provider,
        "model": target.model,
        "profile": target.profile,
        "timeout_s": target.timeout_s,
        "max_retries": target.max_retries,
    }


def _llm_structured_summary(
    *,
    metadata: dict[str, Any],
    frame_analyses: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, ChatCompletionTarget | None]:
    target = get_chat_completion_target(profile="light")
    if target is None or not frame_analyses:
        return None, None

    frame_context = [_frame_context_payload(frame) for frame in frame_analyses]
    system_prompt = (
        "You are a backend video-evidence summarizer for motor claims. "
        "Return one strict JSON object only with these keys: summary_text, "
        "scenario_summary_json, fraud_signals_json, decision_support_json, timeline_json. "
        "Use only the provided metadata and frame evidence. "
        "Do not invent unseen actors, causes, speeds, or labels."
    )
    user_prompt = (
        "Summarize the likely sequence of events from the representative dashcam frames. "
        "Keep timeline_json ordered by timestamp. Each timeline event must include "
        "timestamp_ms, timestamp_label, frame_index, summary, damage_labels, fraud_score. "
        "fraud_signals_json should focus on continuity, duplication, replay, abrupt cuts, or "
        "other event-level concerns supported by the evidence. "
        "decision_support_json must include recommended_action and rationale.\n\n"
        f"Derived metadata:\n{json.dumps(metadata, default=str)}\n\n"
        f"Frame context:\n{json.dumps(frame_context, default=str)}"
    )
    try:
        response = target.client.chat.completions.create(
            model=target.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=900,
            temperature=0,
        )
        parsed = _extract_json_object(response.choices[0].message.content or "")
        return parsed, target
    except Exception:
        logger.exception("Lightweight LLM video summary generation failed")
        return None, target


def _llm_multimodal_reasoning(
    *,
    metadata: dict[str, Any],
    frame_analyses: list[dict[str, Any]],
    base_summary: dict[str, Any],
) -> tuple[dict[str, Any] | None, ChatCompletionTarget | None]:
    target = get_chat_completion_target(profile="rich")
    if target is None or not frame_analyses:
        return None, None

    frame_context = [_frame_context_payload(frame) for frame in frame_analyses]
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "You are reviewing dashcam evidence for a motor insurance claim. "
                "Return one strict JSON object only with keys summary_text, "
                "scenario_summary_json, fraud_signals_json, decision_support_json, timeline_json. "
                "Use the images plus the derived metadata to describe the likely accident scenario, "
                "continuity/fraud concerns, and the next backend review action. "
                "Do not invent facts not visible or derivable from the evidence.\n\n"
                f"Derived metadata:\n{json.dumps(metadata, default=str)}\n\n"
                f"Representative frame context:\n{json.dumps(frame_context, default=str)}\n\n"
                f"Derived baseline summary:\n{json.dumps(base_summary, default=str)}"
            ),
        }
    ]
    for frame in frame_analyses:
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:image/jpeg;base64,"
                    + base64.b64encode(frame["frame_bytes"]).decode("ascii")
                },
            }
        )

    try:
        response = target.client.chat.completions.create(
            model=target.model,
            messages=[{"role": "user", "content": content}],
            max_tokens=1200,
            temperature=0.1,
        )
        parsed = _extract_json_object(response.choices[0].message.content or "")
        return parsed, target
    except Exception:
        logger.exception("Rich multimodal LLM video reasoning failed")
        return None, target


def compose_video_analysis_result(
    *,
    metadata: dict[str, Any],
    frame_analyses: list[dict[str, Any]],
    representative_samples: list[dict[str, Any]],
    pipeline_version: str,
    sampling_strategy: str,
    sampling_extra: dict[str, Any] | None,
    analysis_context_extra: dict[str, Any] | None,
    progress_callback: ProgressCallback | None,
    summary_progress_message: str = (
        "Generated accident-scenario and fraud summary from representative frames."
    ),
) -> dict[str, Any]:
    """
    Shared tail: derived summaries, optional LLM layers, metrics, persistence-shaped dict.

    Used by both the legacy OpenCV sampler and the advanced PyAV/YOLO/ByteTrack path.
    """
    derived_summary = _build_derived_summary(
        metadata=metadata,
        representative_samples=representative_samples,
        frame_analyses=frame_analyses,
    )
    final_summary = dict(derived_summary)
    structured_summary = None
    reasoning_summary = None
    structured_target = None
    reasoning_target = None

    light_target = get_chat_completion_target(profile="light")
    rich_target = get_chat_completion_target(profile="rich")
    should_run_structured_stage = (
        light_target is not None
        and (
            rich_target is None
            or (light_target.provider, light_target.model)
            != (rich_target.provider, rich_target.model)
        )
    )

    if should_run_structured_stage:
        structured_summary, structured_target = _llm_structured_summary(
            metadata=metadata,
            frame_analyses=frame_analyses,
        )
        final_summary = _merge_summary_layer(
            base=final_summary,
            candidate=structured_summary,
        )
    elif light_target is not None:
        structured_target = light_target

    reasoning_summary, reasoning_target = _llm_multimodal_reasoning(
        metadata=metadata,
        frame_analyses=frame_analyses,
        base_summary=final_summary,
    )
    final_summary = _merge_summary_layer(
        base=final_summary,
        candidate=reasoning_summary,
    )

    if progress_callback:
        progress_callback(
            "summary",
            95.0,
            summary_progress_message,
            {
                "representative_frame_count": len(frame_analyses),
            },
        )

    keyframes_json = []
    for frame in frame_analyses:
        keyframes_json.append(
            {
                "frame_index": frame["frame_index"],
                "timestamp_ms": frame["timestamp_ms"],
                "timestamp_label": _timestamp_label(frame["timestamp_ms"]),
                "motion_score": round(float(frame.get("motion_score") or 0.0), 6),
                "scene_score": round(float(frame.get("scene_score") or 0.0), 6),
                "clarity_score": round(float(frame.get("clarity_score") or 0.0), 6),
                "brightness_score": round(
                    float(frame.get("brightness_score") or 0.0), 6
                ),
                "analysis": frame.get("analysis") or {},
            }
        )

    motion_summary_json = {
        "duration_ms": metadata.get("duration_ms"),
        "frame_count": metadata.get("frame_count"),
        "frame_rate": metadata.get("frame_rate"),
        "sampling_stride": metadata.get("sampling_stride"),
        "sample_count": metadata.get("sample_count"),
        "representative_frame_count": metadata.get("representative_frame_count"),
        "peak_motion_timestamp_ms": metadata.get("peak_motion_timestamp_ms"),
        "average_motion_score": metadata.get("average_motion_score"),
        "average_scene_score": metadata.get("average_scene_score"),
        "duplicate_sample_count": metadata.get("duplicate_sample_count"),
        "duplicate_sample_ratio": round(
            float(metadata.get("duplicate_sample_ratio") or 0.0), 6
        ),
    }

    highest_frame_fraud = max(
        (
            float((frame.get("analysis") or {}).get("fraud_score") or 0.0)
            for frame in frame_analyses
        ),
        default=0.0,
    )
    metrics_json = {
        "video_metadata": metadata,
        "highest_frame_fraud_score": round(highest_frame_fraud, 2),
        "representative_frame_count": len(frame_analyses),
        "timeline_event_count": len(final_summary.get("timeline_json") or []),
        "aggregated_damage_part_count": _safe_int(
            ((final_summary.get("scenario_summary_json") or {}).get("damage_assessment") or {}).get(
                "part_count"
            ),
            0,
        ),
        "max_estimated_frame_cost": round(
            _safe_float(
                ((final_summary.get("scenario_summary_json") or {}).get("damage_assessment") or {}).get(
                    "max_estimated_frame_cost"
                ),
                0.0,
            ),
            2,
        ),
        "llm_pipeline": {
            "structured_summary_target": _target_descriptor(structured_target),
            "structured_summary_applied": bool(structured_summary),
            "reasoning_target": _target_descriptor(reasoning_target),
            "reasoning_applied": bool(reasoning_summary),
        },
    }
    summary_text = (
        str(final_summary.get("summary_text") or "").strip()
        or "Video analysis completed from representative frame and motion evidence."
    )
    sampling_block: dict[str, Any] = {
        "strategy": sampling_strategy,
        "sampling_stride": metadata.get("sampling_stride"),
        "sample_count": metadata.get("sample_count"),
        "representative_frame_count": len(frame_analyses),
    }
    if sampling_extra:
        sampling_block.update(_json_safe(sampling_extra))

    analysis_context_json: dict[str, Any] = {
        "pipeline_version": pipeline_version,
        "sampling": sampling_block,
        "video_metadata": _json_safe(metadata),
        "damage_assessment": _json_safe(
            ((final_summary.get("scenario_summary_json") or {}).get("damage_assessment") or {})
        ),
        "llm_pipeline": {
            "structured_summary_target": _target_descriptor(structured_target),
            "structured_summary_applied": bool(structured_summary),
            "reasoning_target": _target_descriptor(reasoning_target),
            "reasoning_applied": bool(reasoning_summary),
        },
        "decision_support": _json_safe(final_summary.get("decision_support_json") or {}),
    }
    if analysis_context_extra:
        analysis_context_json.update(_json_safe(analysis_context_extra))

    return {
        "summary_text": summary_text,
        "analysis_context_json": analysis_context_json,
        "keyframes_json": keyframes_json,
        "timeline_json": final_summary.get("timeline_json") or [],
        "metrics_json": metrics_json,
        "motion_summary_json": motion_summary_json,
        "scenario_summary_json": final_summary.get("scenario_summary_json") or {},
        "fraud_signals_json": final_summary.get("fraud_signals_json") or {},
        "decision_support_json": final_summary.get("decision_support_json") or {},
        "frame_artifacts": frame_analyses,
    }


def _analyze_video_file_legacy(
    video_path: str,
    *,
    complaint_id: str | None = None,
    incident_description: str | None = None,
    flood_coverage: bool = False,
    source_hint: str = "",
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    metadata, samples = _build_sample_payloads(
        video_path,
        progress_callback=progress_callback,
    )
    if not samples:
        raise ValueError("No readable frames were extracted from the video.")

    if progress_callback:
        progress_callback(
            "motion_analysis",
            45.0,
            "Derived motion and continuity metrics from sampled frames.",
            metadata,
        )

    duration_ms = int(metadata.get("duration_ms") or 0)
    representative = _representative_samples(samples, duration_ms=duration_ms)
    metadata["representative_frame_count"] = len(representative)
    metadata["peak_motion_timestamp_ms"] = (
        max(representative, key=lambda sample: sample.get("motion_score") or 0.0).get(
            "timestamp_ms"
        )
        if representative
        else 0
    )
    metadata["duplicate_sample_ratio"] = (
        float(metadata.get("duplicate_sample_count") or 0) / max(1, len(samples))
    )
    metadata["average_motion_score"] = round(
        float(
            np.mean([float(sample.get("motion_score") or 0.0) for sample in samples])
        ),
        6,
    )
    metadata["average_scene_score"] = round(
        float(
            np.mean([float(sample.get("scene_score") or 0.0) for sample in samples])
        ),
        6,
    )

    frame_analyses: list[dict[str, Any]] = []
    for position, sample in enumerate(representative, start=1):
        if progress_callback:
            progress_callback(
                "frame_analysis",
                45.0 + (_clamp01(position / max(1, len(representative))) * 35.0),
                f"Analyzing representative frame {position} of {len(representative)}.",
                {
                    "timestamp_ms": sample["timestamp_ms"],
                    "frame_index": sample["frame_index"],
                },
            )

        analysis = _analyze_frame_bytes(
            sample["frame_bytes"],
            complaint_id=complaint_id,
            incident_description=incident_description,
            flood_coverage=flood_coverage,
            image_hint=f"{source_hint}#{sample['frame_index']}",
        )
        frame_analyses.append(
            {
                **sample,
                "analysis": {
                    "fraud_score": analysis["fraud_score"],
                    "fraud_reasoning": analysis["fraud_reasoning"],
                    "fraud_red_flags": analysis["fraud_red_flags"],
                    "damage_labels": analysis["damage_labels"],
                    "damage_severity": analysis["damage_severity"],
                    "damage_assessment": analysis.get("damage_assessment") or {},
                },
                "image_fraud": analysis["image_fraud"],
            }
        )

    return compose_video_analysis_result(
        metadata=metadata,
        frame_analyses=frame_analyses,
        representative_samples=representative,
        pipeline_version="video_analysis_v2",
        sampling_strategy="adaptive_sqrt_stride",
        sampling_extra=None,
        analysis_context_extra=None,
        progress_callback=progress_callback,
    )


def _annotate_provider_metadata(
    result: dict[str, Any],
    *,
    selected_provider: str,
    provider_order: tuple[str, ...],
    provider_failures: dict[str, str],
    provider_capabilities: dict[str, Any],
    runtime_status: dict[str, Any],
    vp_settings,
) -> dict[str, Any]:
    annotated = dict(result)
    analysis_context = dict(annotated.get("analysis_context_json") or {})
    metrics_json = dict(annotated.get("metrics_json") or {})
    provider_order = tuple(runtime_status.get("requested_provider_order") or provider_order)

    preview = build_video_provider_selection_preview(runtime_status)
    attempts: list[dict[str, Any]] = []
    preview_by_provider = {
        str(item.get("provider") or ""): dict(item)
        for item in (preview.get("attempts") or [])
        if str(item.get("provider") or "")
    }
    for provider in provider_order:
        item = preview_by_provider.get(
            provider,
            {
                "provider": provider,
                "status": "skipped",
                "detail": "",
            },
        )
        if provider == selected_provider:
            item["status"] = "used"
            item["detail"] = str(provider_failures.get(provider) or item.get("detail") or "").strip()
        elif provider in provider_failures:
            item["status"] = "failed"
            item["detail"] = str(provider_failures.get(provider) or "").strip()
        attempts.append(item)

    provider_selection = {
        "selected_provider": selected_provider,
        "provider_order": list(runtime_status.get("effective_provider_order") or provider_order),
        "requested_primary_provider": str(runtime_status.get("requested_primary_provider") or ""),
        "requested_provider_order": list(runtime_status.get("requested_provider_order") or []),
        "effective_primary_provider": str(runtime_status.get("effective_primary_provider") or ""),
        "effective_provider_order": list(runtime_status.get("effective_provider_order") or []),
        "runtime_ready": bool(runtime_status.get("ready")),
        "fallback_allowed": bool(getattr(vp_settings, "allow_fallback", False)),
        "selection_reason": str(runtime_status.get("selection_reason") or ""),
        "attempts": attempts,
        "orchestration": _json_safe(runtime_status.get("orchestration") or {}),
        "config": {
            "primary_provider": str(getattr(vp_settings, "primary_provider", "advanced")),
            "advanced_enabled": bool(getattr(vp_settings, "advanced_enabled", True)),
        },
    }
    if provider_capabilities:
        provider_selection["capabilities"] = _json_safe(provider_capabilities)

    analysis_context["provider_selection"] = _json_safe(provider_selection)
    analysis_context["pipeline_runtime"] = _json_safe(runtime_status)
    metrics_json["provider_selection"] = _json_safe(provider_selection)
    metrics_json["pipeline_runtime"] = _json_safe(
        {
            "ready": bool(runtime_status.get("ready")),
            "effective_primary_provider": runtime_status.get("effective_primary_provider"),
            "selection_reason": runtime_status.get("selection_reason"),
        }
    )
    annotated["analysis_context_json"] = analysis_context
    annotated["metrics_json"] = metrics_json
    return annotated


def analyze_video_file(
    video_path: str,
    *,
    complaint_id: str | None = None,
    incident_description: str | None = None,
    flood_coverage: bool = False,
    source_hint: str = "",
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    """
    Video analysis with configurable provider order (advanced first, legacy fallback).

    Selection is driven by ``claims.video_pipeline_config.load_video_pipeline_settings``:
    env vars and optional ``PricingConfig`` rows (same keys as env).
    """
    vp_settings = load_video_pipeline_settings()
    runtime_status = get_video_pipeline_runtime_status(vp_settings)
    effective_provider_order = tuple(runtime_status.get("effective_provider_order") or ())
    if not effective_provider_order:
        message = (
            str(runtime_status.get("selection_reason") or "").strip()
            or "No video analysis provider is runtime-ready."
        )
        raise RuntimeError(message)

    last_error: BaseException | None = None
    provider_failures: dict[str, str] = {}
    provider_capabilities: dict[str, Any] = {
        "advanced": _json_safe(runtime_status.get("advanced") or {}),
        "legacy": _json_safe(runtime_status.get("legacy") or {}),
    }

    if (
        runtime_status.get("requested_primary_provider") == "advanced"
        and runtime_status.get("effective_primary_provider") != "advanced"
        and runtime_status.get("selection_reason")
    ):
        logger.info(
            "Video analysis routing to %s because advanced is not runtime-ready (%s).",
            runtime_status.get("effective_primary_provider") or "none",
            runtime_status.get("selection_reason"),
        )

    for provider in effective_provider_order:
        if provider == "advanced":
            try:
                from claims.advanced_video_analysis import (
                    AdvancedVideoAnalysisError,
                    run_advanced_video_analysis,
                )

                result = run_advanced_video_analysis(
                    video_path,
                    complaint_id=complaint_id,
                    incident_description=incident_description,
                    flood_coverage=flood_coverage,
                    source_hint=source_hint,
                    progress_callback=progress_callback,
                    pipeline_settings=vp_settings,
                )
                return _annotate_provider_metadata(
                    result,
                    selected_provider="advanced",
                    provider_order=effective_provider_order,
                    provider_failures=provider_failures,
                    provider_capabilities=provider_capabilities,
                    runtime_status=runtime_status,
                    vp_settings=vp_settings,
                )
            except AdvancedVideoAnalysisError as exc:
                logger.warning(
                    "Advanced video analysis unavailable (%s); trying next provider.",
                    exc,
                )
                provider_failures["advanced"] = str(exc)
                last_error = exc
                continue
            except Exception as exc:
                logger.exception("Advanced video analysis failed unexpectedly.")
                provider_failures["advanced"] = str(exc)
                last_error = exc
                if vp_settings.allow_fallback:
                    continue
                raise

        if provider == "legacy":
            result = _analyze_video_file_legacy(
                video_path,
                complaint_id=complaint_id,
                incident_description=incident_description,
                flood_coverage=flood_coverage,
                source_hint=source_hint,
                progress_callback=progress_callback,
            )
            return _annotate_provider_metadata(
                result,
                selected_provider="legacy",
                provider_order=effective_provider_order,
                provider_failures=provider_failures,
                provider_capabilities=provider_capabilities,
                runtime_status=runtime_status,
                vp_settings=vp_settings,
            )

    message = "No video analysis provider produced a result."
    if last_error is not None:
        raise RuntimeError(message) from last_error
    raise RuntimeError(message)
