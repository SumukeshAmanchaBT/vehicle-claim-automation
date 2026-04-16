from __future__ import annotations

from typing import Any

from claims.video_pipeline_config import (
    VideoPipelineSettings,
    load_video_pipeline_settings,
)


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


def _requested_provider_order(settings: VideoPipelineSettings) -> tuple[str, ...]:
    primary = str(settings.primary_provider or "advanced").strip().lower()
    if primary not in {"advanced", "legacy"}:
        primary = "advanced"
    secondary = "legacy" if primary == "advanced" else "advanced"
    if settings.allow_fallback:
        return (primary, secondary)
    return (primary,)


def _legacy_capability() -> dict[str, Any]:
    return {
        "available": True,
        "enabled": True,
        "reasons": [],
        "execution_backend": "database_worker",
        "sampling_backend": "opencv",
    }


def get_video_pipeline_runtime_status(
    pipeline_settings: VideoPipelineSettings | None = None,
) -> dict[str, Any]:
    from claims.advanced_video_analysis import get_advanced_pipeline_capabilities
    from damage_detection_llm.agentic_pipeline import (
        get_agentic_pipeline_runtime_status,
    )

    settings = pipeline_settings or load_video_pipeline_settings()
    requested_provider_order = _requested_provider_order(settings)

    if settings.advanced_enabled:
        try:
            advanced = get_advanced_pipeline_capabilities(settings)
        except Exception as exc:
            advanced = {
                "available": False,
                "enabled": True,
                "reasons": [f"advanced capability inspection failed: {exc}"],
            }
    else:
        advanced = {
            "available": False,
            "enabled": False,
            "reasons": ["advanced video provider is disabled by configuration."],
        }

    legacy = _legacy_capability()
    try:
        orchestration = get_agentic_pipeline_runtime_status(
            enable_web_search=bool(settings.advanced_enable_web_search),
            prefer_agentic_pipeline=bool(settings.advanced_use_langgraph),
        )
    except Exception as exc:
        orchestration = {
            "requested": "langgraph_agentic"
            if bool(settings.advanced_use_langgraph)
            else "vision_llm_direct",
            "selected_mode": "vision_llm_direct",
            "available": False,
            "langgraph_available": False,
            "llm_available": False,
            "web_search_requested": bool(settings.advanced_enable_web_search),
            "web_search_available": False,
            "blocking_reasons": [f"orchestration runtime inspection failed: {exc}"],
            "advisory_notes": [],
            "selection_reason": f"orchestration runtime inspection failed: {exc}",
        }

    effective_provider_order: list[str] = []
    selection_reason = ""
    for provider in requested_provider_order:
        if provider == "advanced":
            if advanced.get("available"):
                effective_provider_order.append("advanced")
            elif not selection_reason:
                selection_reason = "; ".join(
                    str(reason).strip()
                    for reason in (advanced.get("reasons") or [])
                    if str(reason).strip()
                ) or "advanced video provider is not runtime-ready."
        elif provider == "legacy":
            effective_provider_order.append("legacy")

    if not effective_provider_order and not selection_reason:
        selection_reason = "No video analysis provider is runtime-ready."

    effective_primary_provider = effective_provider_order[0] if effective_provider_order else ""
    return {
        "ready": bool(effective_provider_order),
        "requested_primary_provider": requested_provider_order[0] if requested_provider_order else "",
        "requested_provider_order": list(requested_provider_order),
        "effective_primary_provider": effective_primary_provider,
        "effective_provider_order": list(effective_provider_order),
        "fallback_allowed": bool(settings.allow_fallback),
        "selection_reason": selection_reason,
        "advanced": _json_safe(advanced),
        "legacy": _json_safe(legacy),
        "orchestration": _json_safe(orchestration),
    }


def build_video_provider_selection_preview(
    runtime_status: dict[str, Any],
) -> dict[str, Any]:
    requested_order = list(runtime_status.get("requested_provider_order") or [])
    effective_order = list(runtime_status.get("effective_provider_order") or [])
    advanced = dict(runtime_status.get("advanced") or {})
    attempts: list[dict[str, Any]] = []

    for provider in requested_order:
        if provider in effective_order[:1]:
            status = "selected"
            detail = ""
        elif provider == "advanced" and not advanced.get("available"):
            status = "unavailable"
            detail = "; ".join(
                str(reason).strip()
                for reason in (advanced.get("reasons") or [])
                if str(reason).strip()
            )
        elif provider in effective_order:
            status = "standby"
            detail = ""
        else:
            status = "skipped"
            detail = ""
        attempts.append(
            {
                "provider": provider,
                "status": status,
                "detail": detail,
            }
        )

    preview = {
        "selected_provider": str(runtime_status.get("effective_primary_provider") or ""),
        "requested_primary_provider": str(runtime_status.get("requested_primary_provider") or ""),
        "requested_provider_order": requested_order,
        "effective_provider_order": effective_order,
        "fallback_allowed": bool(runtime_status.get("fallback_allowed")),
        "selection_reason": str(runtime_status.get("selection_reason") or ""),
        "attempts": attempts,
        "advanced": _json_safe(runtime_status.get("advanced") or {}),
        "orchestration": _json_safe(runtime_status.get("orchestration") or {}),
    }
    return _json_safe(preview)
