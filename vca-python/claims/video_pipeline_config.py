from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from claim_automation.vca_config import cfg


def _env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or default).strip()


def _coerce_bool(value: Any, default: bool) -> bool:
    if value in (None, ""):
        return default
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _coerce_int(value: Any, default: int, *, minimum: int | None = None) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError, AttributeError):
        parsed = default
    if minimum is not None:
        parsed = max(minimum, parsed)
    return parsed


def _coerce_float(
    value: Any,
    default: float,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError, AttributeError):
        parsed = default
    if minimum is not None:
        parsed = max(minimum, parsed)
    if maximum is not None:
        parsed = min(maximum, parsed)
    return parsed


def _pricing_value(config_key: str) -> str | None:
    try:
        from claims.models import PricingConfig

        row = PricingConfig.objects.filter(
            config_key=config_key,
            is_active=True,
        ).first()
    except Exception:
        return None
    if not row:
        return None
    value = str(row.config_value or "").strip()
    return value if value else None


def _string_setting(*, env_name: str, config_key: str | None = None, default: str = "") -> str:
    value = _pricing_value(config_key) if config_key else None
    if value is None:
        value = _env(env_name, default)
    return str(value or default).strip()


def _bool_setting(*, env_name: str, config_key: str | None = None, default: bool) -> bool:
    value = _pricing_value(config_key) if config_key else None
    if value is None:
        value = _env(env_name, "1" if default else "0")
    return _coerce_bool(value, default)


def _int_setting(
    *,
    env_name: str,
    config_key: str | None = None,
    default: int,
    minimum: int | None = None,
) -> int:
    value = _pricing_value(config_key) if config_key else None
    if value is None:
        value = _env(env_name, str(default))
    return _coerce_int(value, default, minimum=minimum)


def _float_setting(
    *,
    env_name: str,
    config_key: str | None = None,
    default: float,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    value = _pricing_value(config_key) if config_key else None
    if value is None:
        value = _env(env_name, str(default))
    return _coerce_float(value, default, minimum=minimum, maximum=maximum)


@dataclass(frozen=True)
class VideoPipelineSettings:
    primary_provider: str
    allow_fallback: bool
    advanced_enabled: bool
    advanced_timeout_s: int
    advanced_use_langgraph: bool
    advanced_enable_web_search: bool
    advanced_detector_model_path: str
    advanced_tracker_config: str
    advanced_detection_confidence: float
    advanced_detection_iou: float
    advanced_segmentation_backend: str
    advanced_segmentation_model_path: str
    advanced_segmentation_adapter: str
    advanced_require_segmentation: bool
    advanced_scene_change_quantile: float
    advanced_sampling_budget_multiplier: int
    advanced_keyframe_padding_ratio: float
    advanced_max_track_frames: int
    advanced_part_class_map_json: str

    @property
    def provider_order(self) -> tuple[str, ...]:
        primary = self.primary_provider
        if primary not in {"advanced", "legacy"}:
            primary = "advanced"
        secondary = "legacy" if primary == "advanced" else "advanced"
        if primary == "advanced" and not self.advanced_enabled:
            primary = "legacy"
            secondary = "advanced"
        if self.allow_fallback:
            return (primary, secondary)
        return (primary,)


def load_video_pipeline_settings() -> VideoPipelineSettings:
    primary_provider = _string_setting(
        env_name="VIDEO_PIPELINE_PRIMARY_PROVIDER",
        config_key="VIDEO_PIPELINE_PRIMARY_PROVIDER",
        default="advanced",
    ).lower()
    if primary_provider not in {"advanced", "legacy"}:
        primary_provider = "advanced"

    return VideoPipelineSettings(
        primary_provider=primary_provider,
        allow_fallback=_bool_setting(
            env_name="VIDEO_PIPELINE_ALLOW_FALLBACK",
            config_key="VIDEO_PIPELINE_ALLOW_FALLBACK",
            default=True,
        ),
        advanced_enabled=_bool_setting(
            env_name="VIDEO_ADVANCED_ENABLED",
            config_key="VIDEO_ADVANCED_ENABLED",
            default=True,
        ),
        advanced_timeout_s=_int_setting(
            env_name="VIDEO_ADVANCED_TIMEOUT",
            config_key="VIDEO_ADVANCED_TIMEOUT",
            default=int(cfg.video_advanced_timeout_s),
            minimum=30,
        ),
        advanced_use_langgraph=_bool_setting(
            env_name="VIDEO_ADVANCED_USE_LANGGRAPH",
            config_key="VIDEO_ADVANCED_USE_LANGGRAPH",
            default=True,
        ),
        advanced_enable_web_search=_bool_setting(
            env_name="VIDEO_ADVANCED_ENABLE_WEB_SEARCH",
            config_key="VIDEO_ADVANCED_ENABLE_WEB_SEARCH",
            default=True,
        ),
        advanced_detector_model_path=_string_setting(
            env_name="VIDEO_ADVANCED_DETECTOR_MODEL_PATH",
            config_key="VIDEO_ADVANCED_DETECTOR_MODEL_PATH",
            default="",
        ),
        advanced_tracker_config=_string_setting(
            env_name="VIDEO_ADVANCED_TRACKER_CONFIG",
            config_key="VIDEO_ADVANCED_TRACKER_CONFIG",
            default="bytetrack.yaml",
        ),
        advanced_detection_confidence=_float_setting(
            env_name="VIDEO_ADVANCED_DETECTION_CONFIDENCE",
            config_key="VIDEO_ADVANCED_DETECTION_CONFIDENCE",
            default=0.05,
            minimum=0.0,
            maximum=1.0,
        ),
        advanced_detection_iou=_float_setting(
            env_name="VIDEO_ADVANCED_DETECTION_IOU",
            config_key="VIDEO_ADVANCED_DETECTION_IOU",
            default=0.50,
            minimum=0.0,
            maximum=1.0,
        ),
        advanced_segmentation_backend=_string_setting(
            env_name="VIDEO_ADVANCED_SEGMENTATION_BACKEND",
            config_key="VIDEO_ADVANCED_SEGMENTATION_BACKEND",
            default="auto",
        ).lower(),
        advanced_segmentation_model_path=_string_setting(
            env_name="VIDEO_ADVANCED_SEGMENTATION_MODEL_PATH",
            config_key="VIDEO_ADVANCED_SEGMENTATION_MODEL_PATH",
            default="",
        ),
        advanced_segmentation_adapter=_string_setting(
            env_name="VIDEO_ADVANCED_SEGMENTATION_ADAPTER",
            config_key="VIDEO_ADVANCED_SEGMENTATION_ADAPTER",
            default="",
        ),
        advanced_require_segmentation=_bool_setting(
            env_name="VIDEO_ADVANCED_REQUIRE_SEGMENTATION",
            config_key="VIDEO_ADVANCED_REQUIRE_SEGMENTATION",
            default=False,
        ),
        advanced_scene_change_quantile=_float_setting(
            env_name="VIDEO_ADVANCED_SCENE_CHANGE_QUANTILE",
            config_key="VIDEO_ADVANCED_SCENE_CHANGE_QUANTILE",
            default=0.85,
            minimum=0.05,
            maximum=0.99,
        ),
        advanced_sampling_budget_multiplier=_int_setting(
            env_name="VIDEO_ADVANCED_SAMPLING_BUDGET_MULTIPLIER",
            config_key="VIDEO_ADVANCED_SAMPLING_BUDGET_MULTIPLIER",
            default=4,
            minimum=1,
        ),
        advanced_keyframe_padding_ratio=_float_setting(
            env_name="VIDEO_ADVANCED_KEYFRAME_PADDING_RATIO",
            config_key="VIDEO_ADVANCED_KEYFRAME_PADDING_RATIO",
            default=0.08,
            minimum=0.0,
            maximum=0.5,
        ),
        advanced_max_track_frames=_int_setting(
            env_name="VIDEO_ADVANCED_MAX_TRACK_FRAMES",
            config_key="VIDEO_ADVANCED_MAX_TRACK_FRAMES",
            default=10_000,
            minimum=30,
        ),
        advanced_part_class_map_json=_string_setting(
            env_name="VIDEO_ADVANCED_PART_CLASS_MAP",
            config_key="VIDEO_ADVANCED_PART_CLASS_MAP",
            default="",
        ),
    )
