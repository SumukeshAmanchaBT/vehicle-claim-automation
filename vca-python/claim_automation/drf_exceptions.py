"""
Global DRF exception handler: structured JSON, stable error codes, request_id for log correlation.
"""

import json
import logging

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger("claim_automation.api")


def _detail_to_developer_message(detail) -> str:
    if detail is None:
        return ""
    if isinstance(detail, str):
        return detail
    try:
        return json.dumps(detail, default=str)
    except TypeError:
        return str(detail)


def vca_exception_handler(exc, context):
    """
    Wrap DRF's handler; ensure JSON bodies include request_id where available.
    Normalize list-shaped validation payloads into objects the SPA can read.
    Map unhandled exceptions to a safe 500 payload (details only when DEBUG).
    """
    request = context.get("request")
    request_id = getattr(request, "request_id", None) if request else None

    response = drf_exception_handler(exc, context)

    if response is not None:
        data = response.data
        status_code = response.status_code

        if isinstance(data, list):
            payload = {
                "error": "validation_error",
                "message": "The request could not be processed.",
                "developer_message": _detail_to_developer_message(data),
            }
        elif isinstance(data, dict):
            payload = dict(data)
            if "detail" in payload and "message" not in payload:
                d = payload["detail"]
                payload["message"] = d if isinstance(d, str) else _detail_to_developer_message(d)
            if "developer_message" not in payload and "detail" in payload:
                d = payload["detail"]
                if not isinstance(d, str):
                    payload["developer_message"] = _detail_to_developer_message(d)
            if status_code >= 400 and "error" not in payload:
                if status_code == status.HTTP_401_UNAUTHORIZED:
                    payload["error"] = "unauthorized"
                elif status_code == status.HTTP_403_FORBIDDEN:
                    payload["error"] = "forbidden"
                elif status_code == status.HTTP_404_NOT_FOUND:
                    payload["error"] = "not_found"
                elif status_code == status.HTTP_400_BAD_REQUEST:
                    payload["error"] = "bad_request"
                else:
                    payload["error"] = "api_error"
        else:
            payload = {
                "error": "api_error",
                "message": str(data),
                "developer_message": str(data),
            }

        if request_id and "request_id" not in payload:
            payload["request_id"] = request_id
        response.data = payload
        return response

    logger.exception("Unhandled API exception path=%s", getattr(request, "path", ""))

    dev_msg = str(exc) if settings.DEBUG else "Internal server error"
    payload = {
        "error": "server_error",
        "message": "The server could not complete the request.",
        "developer_message": dev_msg,
    }
    if request_id:
        payload["request_id"] = request_id

    return Response(payload, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
