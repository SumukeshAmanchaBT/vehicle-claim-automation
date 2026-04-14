import logging
import time
import uuid

from django.conf import settings

from claim_automation.vca_config import cfg as _vca_cfg

logger = logging.getLogger("claim_automation.request_tracing")


def _sanitize_request_id(raw_value: str | None) -> str:
    candidate = (raw_value or "").strip()
    if not candidate:
        return uuid.uuid4().hex[:16]
    cleaned = "".join(ch for ch in candidate if ch.isalnum() or ch in ("-", "_"))
    return cleaned[:64] or uuid.uuid4().hex[:16]


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
        response = None

        try:
            response = self.get_response(request)
            return response
        except Exception:
            duration_ms = int(
                (time.perf_counter() - request._trace_started_at) * 1000
            )
            logger.exception(
                "[request-error] id=%s method=%s path=%s duration_ms=%s",
                request_id,
                request.method,
                request.get_full_path(),
                duration_ms,
            )
            raise
        finally:
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
                    "[request] id=%s method=%s path=%s status=%s duration_ms=%s user=%s",
                    request_id,
                    request.method,
                    request.get_full_path(),
                    response.status_code,
                    duration_ms,
                    getattr(getattr(request, "user", None), "username", "anonymous"),
                )
