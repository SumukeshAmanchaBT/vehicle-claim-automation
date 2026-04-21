"""
Centralized structured observability for OpenAI / Azure OpenAI SDK traffic.

The goal is to instrument the shared SDK client boundary once so that:
- synchronous API requests
- background workers / management commands
- future resource methods using the same client instance

all emit the same searchable, low-noise telemetry without scattering logging
code across business modules.
"""
from __future__ import annotations

import atexit
import json
import logging
import os
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from types import MethodType
from typing import Any, Iterator
from urllib.parse import urlparse

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError
from openai._base_client import model_copy

logger = logging.getLogger("claim_automation.llm")

_LLM_CONTEXT: ContextVar[dict[str, Any] | None] = ContextVar(
    "claim_automation_llm_context",
    default=None,
)

_SUMMARY_INTERVAL_S = max(
    30,
    int((os.getenv("LLM_OBSERVABILITY_SUMMARY_INTERVAL_S") or "300").strip() or 300),
)
_SUMMARY_EVERY_N_CALLS = max(
    1,
    int((os.getenv("LLM_OBSERVABILITY_SUMMARY_EVERY_N_CALLS") or "25").strip() or 25),
)
_OBSERVABILITY_ENABLED = (
    (os.getenv("LLM_OBSERVABILITY_ENABLED") or "1").strip().lower()
    not in {"0", "false", "no", "off"}
)

_SAFE_RESPONSE_HEADERS = (
    "x-request-id",
    "x-ms-request-id",
    "x-ms-client-request-id",
    "x-ms-region",
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "retry-after",
    "retry-after-ms",
    "ms-azureml-model-error-reason",
)


def _fetch_azure_metrics_for_window(
    resource_ids: set[str], *, window_minutes: int
) -> dict[str, Any] | None:
    """
    Fetch Azure Monitor metrics for all Azure OpenAI resources used in this window.

    Returns a dictionary keyed by resource_id containing cloud-truth metrics from Azure.
    Only fetches when Azure Monitor integration is enabled and resource IDs are available.
    """
    if not resource_ids:
        return None

    # Lazy import to avoid dependency when not using Azure
    try:
        from claim_automation.azure_monitor_client import get_azure_metrics_snapshot
    except ImportError:
        logger.debug("Azure Monitor client not available; skipping cloud metrics fetch")
        return None

    metrics_by_resource: dict[str, Any] = {}
    for resource_id in resource_ids:
        if not resource_id:
            continue
        try:
            snapshot = get_azure_metrics_snapshot(
                resource_id,
                time_window_minutes=max(1, min(window_minutes, 60)),
                use_cache=True,
            )
            if snapshot:
                metrics_by_resource[resource_id] = snapshot
        except Exception as e:
            logger.warning(
                "Failed to fetch Azure metrics for resource %s: %s",
                resource_id,
                str(e),
            )

    return metrics_by_resource if metrics_by_resource else None


@dataclass(frozen=True)
class LlmClientTelemetryMetadata:
    provider: str
    profile: str
    request_target: str
    timeout_s: int
    max_retries: int
    endpoint_host: str | None = None
    api_version: str | None = None
    resource_id: str | None = None
    subscription_id: str | None = None
    resource_group: str | None = None
    resource_name: str | None = None


class _AggregateWindow:
    def __init__(self) -> None:
        now = time.time()
        self.started_at = now
        self.last_flush_at = now
        self.total_calls = 0
        self.by_key: dict[tuple[Any, ...], dict[str, Any]] = {}


class _AggregateStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._window = _AggregateWindow()

    def record(self, payload: dict[str, Any]) -> None:
        summary: dict[str, Any] | None = None
        with self._lock:
            window = self._window
            window.total_calls += 1
            key = (
                payload.get("provider"),
                payload.get("profile"),
                payload.get("request_target"),
                payload.get("operation"),
            )
            bucket = window.by_key.setdefault(
                key,
                {
                    "provider": payload.get("provider"),
                    "profile": payload.get("profile"),
                    "request_target": payload.get("request_target"),
                    "operation": payload.get("operation"),
                    "azure_resource_id": payload.get("azure_resource_id"),
                    "azure_resource_name": payload.get("azure_resource_name"),
                    "calls": 0,
                    "failures": 0,
                    "throttles": 0,
                    "total_retries": 0,
                    "latency_ms_total": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                },
            )
            bucket["calls"] += 1
            if payload.get("status") != "success":
                bucket["failures"] += 1
            if payload.get("throttled"):
                bucket["throttles"] += 1
            bucket["total_retries"] += int(payload.get("retries_taken") or 0)
            bucket["latency_ms_total"] += int(payload.get("latency_ms") or 0)
            usage = payload.get("usage") or {}
            bucket["prompt_tokens"] += int(usage.get("prompt_tokens") or 0)
            bucket["completion_tokens"] += int(usage.get("completion_tokens") or 0)
            bucket["total_tokens"] += int(usage.get("total_tokens") or 0)

            now = time.time()
            should_flush = (
                window.total_calls >= _SUMMARY_EVERY_N_CALLS
                or (now - window.last_flush_at) >= _SUMMARY_INTERVAL_S
            )
            if should_flush:
                summary = self._snapshot_locked(reason="interval_or_volume")
                self._window = _AggregateWindow()

        if summary is not None:
            _emit_log(logging.INFO, summary)

    def snapshot(self, *, reset: bool = False, reason: str = "manual") -> dict[str, Any]:
        with self._lock:
            summary = self._snapshot_locked(reason=reason)
            if reset:
                self._window = _AggregateWindow()
            return summary

    def _snapshot_locked(self, *, reason: str) -> dict[str, Any]:
        window = self._window
        now = time.time()
        groups = []
        azure_resource_ids = set()

        for bucket in sorted(
            window.by_key.values(),
            key=lambda item: (-item["calls"], item["provider"] or "", item["request_target"] or ""),
        ):
            calls = max(1, int(bucket["calls"] or 0))
            group = {
                "provider": bucket["provider"],
                "profile": bucket["profile"],
                "request_target": bucket["request_target"],
                "operation": bucket["operation"],
                "calls": bucket["calls"],
                "failures": bucket["failures"],
                "throttles": bucket["throttles"],
                "total_retries": bucket["total_retries"],
                "avg_latency_ms": round(bucket["latency_ms_total"] / calls, 2),
                "prompt_tokens": bucket["prompt_tokens"],
                "completion_tokens": bucket["completion_tokens"],
                "total_tokens": bucket["total_tokens"],
            }
            # Include Azure resource context if present
            if bucket.get("azure_resource_id"):
                group["azure_resource_id"] = bucket["azure_resource_id"]
                azure_resource_ids.add(bucket["azure_resource_id"])
            if bucket.get("azure_resource_name"):
                group["azure_resource_name"] = bucket["azure_resource_name"]
            groups.append(group)

        # Fetch Azure Monitor metrics for all Azure resources in this window
        azure_metrics = None
        if azure_resource_ids:
            try:
                azure_metrics = _fetch_azure_metrics_for_window(
                    azure_resource_ids,
                    window_minutes=int((now - window.started_at) / 60) + 1,
                )
            except Exception as exc:
                # Avoid breaking aggregates / atexit flush (e.g. reload, optional deps)
                logger.debug(
                    "Skipping Azure cloud metrics in llm_aggregate snapshot: %s",
                    exc,
                    exc_info=True,
                )

        summary = _compact_payload(
            {
                "event": "llm_aggregate",
                "reason": reason,
                "window_started_at": _iso_timestamp(window.started_at),
                "window_ended_at": _iso_timestamp(now),
                "window_seconds": round(max(0.0, now - window.started_at), 3),
                "total_calls": window.total_calls,
                "groups": groups,
                "azure_cloud_metrics": azure_metrics if azure_metrics else None,
            }
        )
        return summary


_AGGREGATES = _AggregateStore()


def current_llm_observation_context() -> dict[str, Any]:
    return dict(_LLM_CONTEXT.get() or {})


def bind_llm_observation_context(**kwargs: Any) -> Token:
    current = current_llm_observation_context()
    for key, value in kwargs.items():
        if value is None or value == "":
            continue
        current[key] = value
    return _LLM_CONTEXT.set(current)


def reset_llm_observation_context(token: Token) -> None:
    _LLM_CONTEXT.reset(token)


@contextmanager
def llm_observation_context(**kwargs: Any) -> Iterator[dict[str, Any]]:
    token = bind_llm_observation_context(**kwargs)
    try:
        yield current_llm_observation_context()
    finally:
        reset_llm_observation_context(token)


def instrument_openai_client(
    client: Any,
    *,
    provider: str,
    profile: str,
    request_target: str,
    timeout_s: int,
    max_retries: int,
    endpoint_host: str | None = None,
    api_version: str | None = None,
    resource_id: str | None = None,
    subscription_id: str | None = None,
    resource_group: str | None = None,
    resource_name: str | None = None,
) -> Any:
    if not _OBSERVABILITY_ENABLED:
        return client

    if getattr(client, "_vca_llm_observed", False):
        return client

    client._vca_llm_observed = True
    client._vca_llm_observed_meta = LlmClientTelemetryMetadata(
        provider=provider,
        profile=profile,
        request_target=request_target,
        timeout_s=timeout_s,
        max_retries=max_retries,
        endpoint_host=endpoint_host,
        api_version=api_version,
        resource_id=resource_id,
        subscription_id=subscription_id,
        resource_group=resource_group,
        resource_name=resource_name,
    )
    client.request = MethodType(_observed_request, client)
    return client


def flush_llm_observability_metrics(*, reason: str = "manual") -> None:
    if not _OBSERVABILITY_ENABLED:
        return
    try:
        summary = _AGGREGATES.snapshot(reset=True, reason=reason)
        if summary.get("total_calls"):
            _emit_log(logging.INFO, summary)
    except Exception:
        # Never fail interpreter shutdown / autoreload (atexit); log for diagnosis.
        logger.warning("flush_llm_observability_metrics failed", exc_info=True)


def snapshot_llm_observability_metrics(*, reset: bool = False) -> dict[str, Any]:
    return _AGGREGATES.snapshot(reset=reset, reason="snapshot")


def _observed_request(self, cast_to, options, *, stream: bool = False, stream_cls=None):
    meta: LlmClientTelemetryMetadata | None = getattr(self, "_vca_llm_observed_meta", None)
    if meta is None or not _OBSERVABILITY_ENABLED:
        raise RuntimeError("Observed request hook installed without telemetry metadata.")

    context = current_llm_observation_context()

    cast_to = self._maybe_override_cast_to(cast_to, options)

    input_options = model_copy(options)
    if input_options.idempotency_key is None and input_options.method.lower() != "get":
        input_options.idempotency_key = self._idempotency_key()

    _merge_correlation_headers(input_options, context)

    response: httpx.Response | None = None
    request: httpx.Request | None = None
    max_retries = input_options.get_max_retries(self.max_retries)
    started_at = time.time()
    started_perf = time.perf_counter()
    throttle_seen = False

    retries_taken = 0
    for retries_taken in range(max_retries + 1):
        options = model_copy(input_options)
        options = self._prepare_options(options)

        remaining_retries = max_retries - retries_taken
        request = self._build_request(options, retries_taken=retries_taken)
        self._prepare_request(request)

        kwargs: dict[str, Any] = {}
        if self.custom_auth is not None:
            kwargs["auth"] = self.custom_auth
        if options.follow_redirects is not None:
            kwargs["follow_redirects"] = options.follow_redirects

        response = None
        try:
            response = self._client.send(
                request,
                stream=stream or self._should_stream_response_body(request=request),
                **kwargs,
            )
        except httpx.TimeoutException as err:
            if remaining_retries > 0:
                self._sleep_for_retry(
                    retries_taken=retries_taken,
                    max_retries=max_retries,
                    options=input_options,
                    response=None,
                )
                continue

            error = APITimeoutError(request=request)  # pragma: no cover - exercised indirectly
            _record_llm_event(
                meta=meta,
                context=context,
                started_at=started_at,
                started_perf=started_perf,
                request=request,
                response=None,
                result=None,
                retries_taken=retries_taken,
                status="error",
                error=error,
                stream=stream,
                throttle_seen=throttle_seen,
            )
            raise error from err
        except Exception as err:
            if remaining_retries > 0:
                self._sleep_for_retry(
                    retries_taken=retries_taken,
                    max_retries=max_retries,
                    options=input_options,
                    response=None,
                )
                continue

            error = APIConnectionError(request=request)
            _record_llm_event(
                meta=meta,
                context=context,
                started_at=started_at,
                started_perf=started_perf,
                request=request,
                response=None,
                result=None,
                retries_taken=retries_taken,
                status="error",
                error=error,
                stream=stream,
                throttle_seen=throttle_seen,
            )
            raise error from err

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as err:
            if err.response.status_code == 429:
                throttle_seen = True
            if remaining_retries > 0 and self._should_retry(err.response):
                err.response.close()
                self._sleep_for_retry(
                    retries_taken=retries_taken,
                    max_retries=max_retries,
                    options=input_options,
                    response=response,
                )
                continue

            if not err.response.is_closed:
                err.response.read()

            error = self._make_status_error_from_response(err.response)
            _record_llm_event(
                meta=meta,
                context=context,
                started_at=started_at,
                started_perf=started_perf,
                request=request,
                response=err.response,
                result=None,
                retries_taken=retries_taken,
                status="error",
                error=error,
                stream=stream,
                throttle_seen=throttle_seen,
            )
            raise error from None

        break

    assert response is not None, "could not resolve response (should never happen)"
    result = self._process_response(
        cast_to=cast_to,
        options=options,
        response=response,
        stream=stream,
        stream_cls=stream_cls,
        retries_taken=retries_taken,
    )
    _record_llm_event(
        meta=meta,
        context=context,
        started_at=started_at,
        started_perf=started_perf,
        request=request,
        response=response,
        result=result,
        retries_taken=retries_taken,
        status="success",
        error=None,
        stream=stream,
        throttle_seen=throttle_seen,
    )
    return result


def _merge_correlation_headers(options: Any, context: dict[str, Any]) -> None:
    correlation_id = (
        context.get("correlation_id")
        or context.get("request_id")
        or context.get("job_id")
    )
    if not correlation_id:
        return

    headers = dict(getattr(options, "headers", None) or {})
    headers.setdefault("x-ms-client-request-id", str(correlation_id))
    options.headers = headers


def _record_llm_event(
    *,
    meta: LlmClientTelemetryMetadata,
    context: dict[str, Any],
    started_at: float,
    started_perf: float,
    request: httpx.Request | None,
    response: httpx.Response | None,
    result: Any,
    retries_taken: int,
    status: str,
    error: Exception | None,
    stream: bool,
    throttle_seen: bool,
) -> None:
    latency_ms = round((time.perf_counter() - started_perf) * 1000.0, 3)
    response_headers = _extract_safe_headers(response.headers if response is not None else None)
    usage = _extract_usage_metrics(result)
    payload = _compact_payload(
        {
            "event": "llm_call",
            "status": status,
            "provider": meta.provider,
            "profile": meta.profile,
            "request_target": meta.request_target,
            "response_model": _extract_result_attr(result, "model"),
            "response_id": _extract_result_attr(result, "id"),
            "timeout_s": meta.timeout_s,
            "configured_max_retries": meta.max_retries,
            "retries_taken": retries_taken,
            "latency_ms": latency_ms,
            "started_at": _iso_timestamp(started_at),
            "stream": bool(stream),
            "endpoint_host": meta.endpoint_host,
            "api_version": meta.api_version,
            "azure_resource_id": meta.resource_id if meta.provider == "azure" else None,
            "azure_subscription_id": meta.subscription_id if meta.provider == "azure" else None,
            "azure_resource_group": meta.resource_group if meta.provider == "azure" else None,
            "azure_resource_name": meta.resource_name if meta.provider == "azure" else None,
            "operation": _operation_name(request),
            "http_method": request.method if request is not None else None,
            "http_path": str(request.url.path) if request is not None else None,
            "http_status": response.status_code if response is not None else None,
            "provider_request_id": (
                response_headers.get("x-request-id")
                or response_headers.get("x-ms-request-id")
            ),
            "provider_client_request_id": response_headers.get("x-ms-client-request-id"),
            "rate_limit": _extract_rate_limit_metrics(response_headers),
            "usage": usage or None,
            "correlation_id": context.get("correlation_id") or context.get("request_id"),
            "request_id": context.get("request_id"),
            "execution_scope": context.get("execution_scope"),
            "job_id": context.get("job_id"),
            "management_command": context.get("management_command"),
            "throttled": throttle_seen or _is_throttled(response=response, error=error),
            "error": _extract_error_payload(error, response_headers) if error is not None else None,
        }
    )
    level = logging.INFO
    if status != "success":
        level = logging.WARNING if payload.get("throttled") else logging.ERROR
    _emit_log(level, payload)
    _AGGREGATES.record(payload)


def _emit_log(level: int, payload: dict[str, Any]) -> None:
    logger.log(level, "%s", json.dumps(payload, sort_keys=True, default=str))


def _operation_name(request: httpx.Request | None) -> str | None:
    if request is None:
        return None
    return f"{request.method.upper()} {request.url.path}"


def _extract_safe_headers(headers: Any) -> dict[str, str]:
    if headers is None:
        return {}
    selected: dict[str, str] = {}
    for key in _SAFE_RESPONSE_HEADERS:
        value = headers.get(key)
        if value not in (None, ""):
            selected[key] = str(value)
    return selected


def _extract_rate_limit_metrics(headers: dict[str, str]) -> dict[str, Any] | None:
    if not headers:
        return None
    keys = (
        "x-ratelimit-limit-requests",
        "x-ratelimit-limit-tokens",
        "x-ratelimit-remaining-requests",
        "x-ratelimit-remaining-tokens",
        "x-ratelimit-reset-requests",
        "x-ratelimit-reset-tokens",
        "retry-after",
        "retry-after-ms",
    )
    payload = {key: _coerce_number(headers.get(key)) for key in keys if headers.get(key) not in (None, "")}
    return payload or None


def _extract_usage_metrics(result: Any) -> dict[str, Any]:
    usage = None
    if result is None:
        return {}
    if isinstance(result, dict):
        usage = result.get("usage")
    else:
        usage = getattr(result, "usage", None)

    payload = _to_plain_data(usage)
    if not isinstance(payload, dict):
        return {}
    flattened: dict[str, Any] = {}
    _flatten_numeric_dict(payload, flattened)
    return flattened


def _flatten_numeric_dict(source: dict[str, Any], target: dict[str, Any], *, prefix: str = "") -> None:
    for key, value in source.items():
        key_name = f"{prefix}{key}" if not prefix else f"{prefix}_{key}"
        if isinstance(value, dict):
            _flatten_numeric_dict(value, target, prefix=key_name)
            continue
        numeric = _coerce_number(value)
        if numeric is not None:
            target[key_name] = numeric


def _extract_result_attr(result: Any, attr: str) -> Any:
    if result is None:
        return None
    if isinstance(result, dict):
        return result.get(attr)
    return getattr(result, attr, None)


def _extract_error_payload(error: Exception | None, headers: dict[str, str]) -> dict[str, Any] | None:
    if error is None:
        return None
    payload = {
        "type": error.__class__.__name__,
        "message": _truncate_message(str(error)),
    }
    if isinstance(error, APIStatusError):
        payload["status_code"] = getattr(error, "status_code", None)
        body = getattr(error, "body", None)
        if isinstance(body, dict):
            api_error = body.get("error")
            if isinstance(api_error, dict):
                payload["provider_code"] = api_error.get("code")
                payload["provider_type"] = api_error.get("type")
                if api_error.get("message"):
                    payload["provider_message"] = _truncate_message(str(api_error.get("message")))
    request_id = headers.get("x-request-id") or headers.get("x-ms-request-id")
    if request_id:
        payload["provider_request_id"] = request_id
    return _compact_payload(payload)


def _is_throttled(*, response: httpx.Response | None, error: Exception | None) -> bool:
    if response is not None and response.status_code == 429:
        return True
    return isinstance(error, RateLimitError) or getattr(error, "status_code", None) == 429


def _to_plain_data(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return {k: _to_plain_data(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_plain_data(item) for item in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump(exclude_none=True)
        except TypeError:
            return model_dump()
    dict_method = getattr(value, "dict", None)
    if callable(dict_method):
        try:
            return dict_method(exclude_none=True)
        except TypeError:
            return dict_method()
    return value


def _truncate_message(message: str, *, limit: int = 300) -> str:
    if len(message) <= limit:
        return message
    return f"{message[:limit]}..."


def _compact_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in payload.items()
        if value not in (None, "", [], {})
    }


def _coerce_number(value: Any) -> Any:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        try:
            if "." in stripped:
                return float(stripped)
            return int(stripped)
        except ValueError:
            return stripped
    return value


def _iso_timestamp(epoch_seconds: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch_seconds))


def endpoint_host_from_url(url: str | None) -> str | None:
    raw = (url or "").strip()
    if not raw:
        return None
    return urlparse(raw).hostname


atexit.register(flush_llm_observability_metrics, reason="atexit")
