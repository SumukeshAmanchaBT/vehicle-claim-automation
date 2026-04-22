"""
OpenAI or Azure OpenAI chat-completions client selection.

Configure via environment variables — see vca-python/.env.example.
Azure is preferred when endpoint + key + a deployment are configured.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from claim_automation.azure_monitor_client import parse_azure_resource_id
from claim_automation.llm_observability import (
    endpoint_host_from_url,
    instrument_openai_client,
)
from claim_automation.vca_config import cfg

__all__ = [
    "ChatCompletionTarget",
    "get_chat_completion_client_and_model",
    "get_chat_completion_target",
    "llm_configured",
]


@dataclass(frozen=True)
class ChatCompletionTarget:
    client: Any
    model: str
    provider: str
    profile: str
    timeout_s: int
    max_retries: int
    endpoint_host: str | None = None
    api_version: str | None = None
    resource_id: str | None = None
    subscription_id: str | None = None
    resource_group: str | None = None
    resource_name: str | None = None


def _env(name: str, default: str = "") -> str:
    """Read env with trim; strip BOM from pasted .env values."""
    raw = (os.getenv(name) or default).strip()
    if raw.startswith("\ufeff"):
        raw = raw.lstrip("\ufeff").strip()
    return raw


def _env_primary_or_backup(primary: str, backup: str, default: str = "") -> str:
    """Use primary env; if empty, use *_BACKUP (for .env redundancy / manual failover)."""
    return _env(primary) or _env(backup) or default


def _resolve_azure_deployment(profile: str) -> str:
    # Support both legacy AZURE_OPENAI_DEPLOYMENT and explicit chat naming.
    default_deployment = (
        _env_primary_or_backup(
            "AZURE_OPENAI_CHAT_DEPLOYMENT", "AZURE_OPENAI_CHAT_DEPLOYMENT_BACKUP"
        )
        or _env_primary_or_backup(
            "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_DEPLOYMENT_BACKUP"
        )
    )
    mini_deployment = _env_primary_or_backup(
        "AZURE_OPENAI_MINI_DEPLOYMENT", "AZURE_OPENAI_MINI_DEPLOYMENT_BACKUP"
    )
    if profile == "light":
        return mini_deployment or default_deployment
    if profile == "rich":
        return default_deployment or mini_deployment
    return default_deployment or mini_deployment


def _resolve_openai_model(profile: str) -> str:
    default_model = _env("OPENAI_VISION_MODEL", "gpt-4o-mini")
    mini_model = _env("OPENAI_MINI_MODEL", default_model or "gpt-4o-mini")
    rich_model = _env("OPENAI_RICH_MODEL", default_model or "gpt-4o")
    if profile == "light":
        return mini_model or default_model or "gpt-4o-mini"
    if profile == "rich":
        return rich_model or default_model or "gpt-4o"
    return default_model or mini_model or rich_model or "gpt-4o-mini"


def _resolve_timeout(profile: str) -> int:
    if profile == "light":
        return int(cfg.llm_light_request_timeout_s)
    if profile == "rich":
        return int(cfg.llm_rich_request_timeout_s)
    return int(cfg.llm_request_timeout_s)


def _build_resource_id_from_parts(prefix: str = "") -> str | None:
    sub_id = _env(f"AZURE_SUBSCRIPTION_ID{prefix}")
    rg = _env(f"AZURE_OPENAI_RESOURCE_GROUP{prefix}")
    name = _env(f"AZURE_OPENAI_RESOURCE_NAME{prefix}")
    if sub_id and rg and name:
        return (
            f"/subscriptions/{sub_id}/resourceGroups/{rg}/"
            f"providers/Microsoft.CognitiveServices/accounts/{name}"
        )
    return None


def _resolve_resource_id() -> str | None:
    explicit = _env_primary_or_backup(
        "AZURE_OPENAI_RESOURCE_ID", "AZURE_OPENAI_RESOURCE_ID_BACKUP"
    )
    if explicit:
        return explicit
    return _build_resource_id_from_parts() or _build_resource_id_from_parts("_BACKUP")


def _build_openai_platform_target(
    *,
    api_key: str,
    profile: str,
    timeout_s: int,
    max_retries: int,
) -> ChatCompletionTarget:
    from openai import OpenAI

    return ChatCompletionTarget(
        client=instrument_openai_client(
            OpenAI(
                api_key=api_key,
                timeout=timeout_s,
                max_retries=max_retries,
            ),
            provider="openai",
            profile=profile,
            request_target=_resolve_openai_model(profile),
            timeout_s=timeout_s,
            max_retries=max_retries,
        ),
        model=_resolve_openai_model(profile),
        provider="openai",
        profile=profile,
        timeout_s=timeout_s,
        max_retries=max_retries,
    )


def _build_azure_target(
    *,
    profile: str,
    endpoint: str,
    azure_key: str,
    deployment: str,
    api_version: str,
    timeout_s: int,
    max_retries: int,
) -> ChatCompletionTarget:
    from openai import AzureOpenAI

    ep = endpoint if endpoint.endswith("/") else f"{endpoint}/"
    resource_id = _resolve_resource_id()
    resource_ctx = parse_azure_resource_id(resource_id) if resource_id else None

    client = instrument_openai_client(
        AzureOpenAI(
            api_version=api_version,
            azure_endpoint=ep,
            api_key=azure_key,
            timeout=timeout_s,
            max_retries=max_retries,
        ),
        provider="azure",
        profile=profile,
        request_target=deployment,
        timeout_s=timeout_s,
        max_retries=max_retries,
        endpoint_host=endpoint_host_from_url(ep),
        api_version=api_version,
        resource_id=resource_id,
        subscription_id=resource_ctx.subscription_id if resource_ctx else None,
        resource_group=resource_ctx.resource_group if resource_ctx else None,
        resource_name=resource_ctx.resource_name if resource_ctx else None,
    )
    return ChatCompletionTarget(
        client=client,
        model=deployment,
        provider="azure",
        profile=profile,
        timeout_s=timeout_s,
        max_retries=max_retries,
        endpoint_host=endpoint_host_from_url(ep),
        api_version=api_version,
        resource_id=resource_id,
        subscription_id=resource_ctx.subscription_id if resource_ctx else None,
        resource_group=resource_ctx.resource_group if resource_ctx else None,
        resource_name=resource_ctx.resource_name if resource_ctx else None,
    )


def get_chat_completion_target(profile: str = "default") -> ChatCompletionTarget | None:
    """
    Return the configured chat-completions target for a workload profile.

    Profiles:
    - default: existing repo behavior
    - light: cheap structured classification/summarization
    - rich: heavier multimodal reasoning

    LLM_PROVIDER_PRIORITY (default ``azure_first``):
    - ``azure_first``: Azure OpenAI when endpoint+key+deployment resolve; else OpenAI platform.
    - ``openai_first``: OpenAI platform when OPENAI_API_KEY (or OPENAI_API_KEY_BACKUP) is set;
      else Azure. Use when Azure keys fail but platform key works.

    Primary env vars may be empty; ``*_BACKUP`` values are merged in (see _env_primary_or_backup).
    """
    timeout_s = _resolve_timeout(profile)
    max_retries = int(cfg.llm_request_max_retries)

    endpoint = _env_primary_or_backup(
        "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_ENDPOINT_BACKUP"
    ).rstrip("/")
    azure_key = _env_primary_or_backup("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_API_KEY_BACKUP")
    deployment = _resolve_azure_deployment(profile)
    api_version = _env_primary_or_backup(
        "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_API_VERSION_BACKUP"
    ) or "2024-12-01-preview"

    openai_key = _env("OPENAI_API_KEY") or _env("OPENAI_API_KEY_BACKUP")
    priority = _env("LLM_PROVIDER_PRIORITY", "azure_first").lower().replace("-", "_")

    azure_ready = bool(endpoint and azure_key and deployment)

    if priority in {"openai_first", "openai"} and openai_key:
        return _build_openai_platform_target(
            api_key=openai_key,
            profile=profile,
            timeout_s=timeout_s,
            max_retries=max_retries,
        )
    if azure_ready:
        return _build_azure_target(
            profile=profile,
            endpoint=endpoint,
            azure_key=azure_key,
            deployment=deployment,
            api_version=api_version,
            timeout_s=timeout_s,
            max_retries=max_retries,
        )
    if openai_key:
        return _build_openai_platform_target(
            api_key=openai_key,
            profile=profile,
            timeout_s=timeout_s,
            max_retries=max_retries,
        )

    return None


def get_chat_completion_client_and_model(
    profile: str = "default",
) -> tuple[Any, str] | tuple[None, None]:
    """
    Return (client, model) suitable for client.chat.completions.create(..., model=model).

    Azure: model must be the deployment name (for example `gpt-4o`).
    """
    target = get_chat_completion_target(profile=profile)
    if target is None:
        return None, None
    return target.client, target.model


def llm_configured(profile: str = "default") -> bool:
    return get_chat_completion_target(profile=profile) is not None
