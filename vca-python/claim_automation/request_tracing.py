import logging
import time
import uuid

from django.conf import settings

from claim_automation.llm_observability import (
    bind_llm_observation_context,
    reset_llm_observation_context,
)
from claim_automation.vca_config import cfg as _vca_cfg

logger = logging.getLogger("claim_automation.request_tracing")


def _sanitize_request_id(raw_value: str | None) -> str:
    candidate = (raw_value or "").strip()
    if not candidate:
        return uuid.uuid4().hex[:16]
    cleaned = "".join(ch for ch in candidate if ch.isalnum() or ch in ("-", "_"))
    return cleaned[:64] or uuid.uuid4().hex[:16]


def _route_descriptor(request) -> str:
    match = getattr(request, "resolver_match", None)
    route = getattr(match, "route", None) or getattr(match, "view_name", None)
    if route:
        return str(route)
    return request.path.split("?", 1)[0]


def _principal_descriptor(request) -> str:
    user = getattr(request, "user", None)
    if getattr(user, "is_authenticated", False):
        return "authenticated"
    return "anonymous"


class RequestTracingMiddleware:
    """
    Adds request IDs / timing headers and logs slow or failing requests with enough
    context for developers to correlate frontend failures with backend activity.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        # Prefer settings.SLOW_REQUEST_MS (set from cfg in settings.py); fall back to
        # cfg directly so the tracing middleware stays correct even in test harnesses
        # that bypass the full settings module.
        self.slow_request_ms = int(
            getattr(settings, "SLOW_REQUEST_MS", _vca_cfg.slow_request_threshold_ms)
        )

    def __call__(self, request):
        request_id = _sanitize_request_id(request.headers.get("X-Client-Request-ID"))
        request.request_id = request_id
        request._trace_started_at = time.perf_counter()
        context_token = bind_llm_observation_context(
            correlation_id=request_id,
            request_id=request_id,
            execution_scope="http_request",
        )
        response = None

        try:
            response = self.get_response(request)
            return response
        except Exception:
            duration_ms = int(
                (time.perf_counter() - request._trace_started_at) * 1000
            )
            logger.exception(
                "[request-error] id=%s method=%s route=%s duration_ms=%s principal=%s",
                request_id,
                request.method,
                _route_descriptor(request),
                duration_ms,
                _principal_descriptor(request),
            )
            raise
        finally:
            try:
                if response is not None:
                    duration_ms = int(
                        (time.perf_counter() - request._trace_started_at) * 1000
                    )
                    response["X-Request-ID"] = request_id
                    response["X-Response-Time-Ms"] = str(duration_ms)

                    level = logging.INFO
                    if response.status_code >= 500:
                        level = logging.ERROR
                    elif response.status_code >= 400 or duration_ms >= self.slow_request_ms:
                        level = logging.WARNING

                    logger.log(
                        level,
                        "[request] id=%s method=%s route=%s status=%s duration_ms=%s principal=%s",
                        request_id,
                        request.method,
                        _route_descriptor(request),
                        response.status_code,
                        duration_ms,
                        _principal_descriptor(request),
                    )
            finally:
                reset_llm_observation_context(context_token)
