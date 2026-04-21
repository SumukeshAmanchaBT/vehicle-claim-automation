"""
Azure Monitor metrics client for Azure OpenAI observability enrichment.

Fetches cloud-truth metrics from Azure Monitor where Azure exposes them:
- Token consumption (PTU for provisioned deployments)
- Request counts and latency percentiles
- Throttling and error rates
- Azure-side request correlation

Does NOT fabricate or estimate costs; only surfaces what Azure provides.

Usage:
    from claim_automation.azure_monitor_client import get_azure_metrics_snapshot

    snapshot = get_azure_metrics_snapshot(
        resource_id="/subscriptions/.../Microsoft.CognitiveServices/accounts/...",
        time_window_minutes=5
    )
    if snapshot:
        print(snapshot["metrics"])
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger("claim_automation.azure_monitor")

# Cache duration in seconds (avoid excessive Azure Monitor API calls)
_METRICS_CACHE_TTL_S = max(30, int((os.getenv("AZURE_MONITOR_CACHE_TTL_S") or "60").strip() or 60))

# Global cache: keyed by (resource_id, time_window_minutes)
_METRICS_CACHE: dict[tuple[str, int], tuple[float, dict[str, Any]]] = {}


@dataclass(frozen=True)
class AzureResourceContext:
    """Parsed Azure OpenAI resource identifiers."""

    subscription_id: str
    resource_group: str
    resource_name: str
    resource_id: str


def parse_azure_resource_id(resource_id: str) -> AzureResourceContext | None:
    """
    Parse an Azure resource ID into components.

    Expected format:
    /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{name}
    """
    if not resource_id:
        return None

    parts = resource_id.strip("/").split("/")
    if len(parts) < 8:
        return None

    try:
        sub_idx = parts.index("subscriptions")
        rg_idx = parts.index("resourceGroups")
        providers_idx = parts.index("providers")

        subscription_id = parts[sub_idx + 1]
        resource_group = parts[rg_idx + 1]
        resource_name = parts[-1]

        return AzureResourceContext(
            subscription_id=subscription_id,
            resource_group=resource_group,
            resource_name=resource_name,
            resource_id=resource_id,
        )
    except (ValueError, IndexError):
        logger.warning("Failed to parse Azure resource ID: %r", resource_id)
        return None


def get_azure_metrics_snapshot(
    resource_id: str | None,
    *,
    time_window_minutes: int = 5,
    use_cache: bool = True,
) -> dict[str, Any] | None:
    """
    Fetch Azure Monitor metrics for an Azure OpenAI resource.

    Returns aggregated metrics from Azure Monitor for the specified time window.
    Uses cached data if available and fresh (< AZURE_MONITOR_CACHE_TTL_S).

    Args:
        resource_id: Full ARM resource ID for the Azure OpenAI account
        time_window_minutes: Time window for metric aggregation (default 5)
        use_cache: Whether to use cached metrics (default True)

    Returns:
        Dictionary with Azure-side metrics, or None if unavailable/disabled
    """
    if not resource_id:
        return None

    # Check environment flag
    if (os.getenv("AZURE_MONITOR_METRICS_ENABLED") or "1").strip().lower() in {
        "0",
        "false",
        "no",
        "off",
    }:
        return None

    # Validate resource ID format
    ctx = parse_azure_resource_id(resource_id)
    if ctx is None:
        return None

    # Check cache
    cache_key = (resource_id, time_window_minutes)
    if use_cache and cache_key in _METRICS_CACHE:
        cached_at, cached_data = _METRICS_CACHE[cache_key]
        age_s = time.time() - cached_at
        if age_s < _METRICS_CACHE_TTL_S:
            logger.debug(
                "Using cached Azure metrics (age=%.1fs, resource=%s)",
                age_s,
                ctx.resource_name,
            )
            return cached_data

    # Attempt to fetch live metrics
    metrics = _fetch_azure_monitor_metrics(ctx, time_window_minutes=time_window_minutes)

    # Update cache on success
    if metrics is not None:
        _METRICS_CACHE[cache_key] = (time.time(), metrics)

    return metrics


def _fetch_azure_monitor_metrics(
    ctx: AzureResourceContext,
    *,
    time_window_minutes: int,
) -> dict[str, Any] | None:
    """
    Fetch Azure Monitor metrics using the Azure SDK.

    This function uses DefaultAzureCredential for authentication, which supports:
    - Environment variables (AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID)
    - Managed identity (when running in Azure)
    - Azure CLI credentials (for local dev)
    - Visual Studio Code credentials
    """
    try:
        from azure.identity import DefaultAzureCredential
        from azure.monitor.query import MetricsQueryClient
    except ImportError:
        logger.debug(
            "Azure SDK not available (pip install azure-identity azure-monitor-query). "
            "Skipping Azure Monitor metrics fetch."
        )
        return None

    try:
        # Authenticate using default credential chain
        credential = DefaultAzureCredential()

        # Create metrics client
        client = MetricsQueryClient(credential)

        # Define time range
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(minutes=time_window_minutes)

        # Azure OpenAI metrics available through Azure Monitor
        # See: https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/monitoring
        metric_names = [
            "Requests",  # Total request count
            "TokenTransaction",  # Token consumption (PTU for provisioned)
            "ProcessedPromptTokens",  # Prompt tokens processed
            "GeneratedCompletionTokens",  # Completion tokens generated
            "ActiveTokens",  # Active tokens (provisioned deployments)
            "ProvisionedManagedUtilizationV2",  # PTU utilization %
            "ServerErrors",  # 5xx errors
            "ClientErrors",  # 4xx errors
            "DataIn",  # Ingress bytes
            "DataOut",  # Egress bytes
            "Latency",  # Request latency
        ]

        # Query metrics with appropriate aggregations
        metrics_response = client.query_resource(
            resource_uri=ctx.resource_id,
            metric_names=metric_names,
            timespan=(start_time, end_time),
            granularity=timedelta(minutes=1),  # 1-minute granularity
            aggregations=["Total", "Average", "Count", "Maximum", "Minimum"],
        )

        # Parse metrics into structured format
        parsed_metrics: dict[str, Any] = {
            "resource_name": ctx.resource_name,
            "resource_id": ctx.resource_id,
            "time_window_minutes": time_window_minutes,
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "metrics": {},
        }

        for metric in metrics_response.metrics:
            metric_name = metric.name
            if not metric.timeseries:
                continue

            # Aggregate across all time series (handles multi-deployment resources)
            aggregated = {
                "total": 0,
                "average": 0,
                "count": 0,
                "maximum": None,
                "minimum": None,
            }

            point_count = 0
            for timeseries in metric.timeseries:
                for point in timeseries.data:
                    point_count += 1
                    if point.total is not None:
                        aggregated["total"] += point.total
                    if point.average is not None:
                        aggregated["average"] += point.average
                    if point.count is not None:
                        aggregated["count"] += point.count
                    if point.maximum is not None:
                        if aggregated["maximum"] is None:
                            aggregated["maximum"] = point.maximum
                        else:
                            aggregated["maximum"] = max(aggregated["maximum"], point.maximum)
                    if point.minimum is not None:
                        if aggregated["minimum"] is None:
                            aggregated["minimum"] = point.minimum
                        else:
                            aggregated["minimum"] = min(aggregated["minimum"], point.minimum)

            # Compute proper average across points
            if point_count > 0 and aggregated["average"] > 0:
                aggregated["average"] = round(aggregated["average"] / point_count, 3)

            # Store only non-null aggregations
            parsed_metrics["metrics"][metric_name] = {
                k: v for k, v in aggregated.items() if v is not None
            }

        logger.info(
            "Fetched Azure Monitor metrics for %s (window=%dm, metrics=%d)",
            ctx.resource_name,
            time_window_minutes,
            len(parsed_metrics["metrics"]),
        )

        return parsed_metrics

    except Exception as e:
        logger.warning(
            "Failed to fetch Azure Monitor metrics for %s: %s",
            ctx.resource_name,
            str(e),
            exc_info=True,
        )
        return None


def clear_metrics_cache() -> None:
    """Clear the Azure Monitor metrics cache."""
    global _METRICS_CACHE
    _METRICS_CACHE.clear()
    logger.debug("Cleared Azure Monitor metrics cache")


def get_cache_stats() -> dict[str, Any]:
    """Return statistics about the metrics cache."""
    return {
        "entries": len(_METRICS_CACHE),
        "ttl_seconds": _METRICS_CACHE_TTL_S,
        "cache_keys": [
            {"resource_id": k[0], "window_minutes": k[1], "age_s": round(time.time() - v[0], 1)}
            for k, v in _METRICS_CACHE.items()
        ],
    }
