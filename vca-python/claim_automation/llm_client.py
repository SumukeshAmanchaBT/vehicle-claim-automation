"""
OpenAI or Azure OpenAI chat-completions client selection.

Configure via environment variables — see vca-python/.env.example.
Azure is preferred when endpoint + key + a deployment are configured.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

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


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _resolve_azure_deployment(profile: str) -> str:
    default_deployment = _env("AZURE_OPENAI_DEPLOYMENT")
    mini_deployment = _env("AZURE_OPENAI_MINI_DEPLOYMENT")
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


def get_chat_completion_target(profile: str = "default") -> ChatCompletionTarget | None:
    """
    Return the configured chat-completions target for a workload profile.

    Profiles:
    - default: existing repo behavior
    - light: cheap structured classification/summarization
    - rich: heavier multimodal reasoning
    """
    endpoint = _env("AZURE_OPENAI_ENDPOINT").rstrip("/")
    azure_key = _env("AZURE_OPENAI_API_KEY")
    deployment = _resolve_azure_deployment(profile)
    api_version = _env("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")
    timeout_s = _resolve_timeout(profile)
    max_retries = int(cfg.llm_request_max_retries)

    if endpoint and azure_key and deployment:
        from openai import AzureOpenAI

        ep = endpoint if endpoint.endswith("/") else f"{endpoint}/"
        client = AzureOpenAI(
            api_version=api_version,
            azure_endpoint=ep,
            api_key=azure_key,
            timeout=timeout_s,
            max_retries=max_retries,
        )
        return ChatCompletionTarget(
            client=client,
            model=deployment,
            provider="azure",
            profile=profile,
            timeout_s=timeout_s,
            max_retries=max_retries,
        )

    api_key = _env("OPENAI_API_KEY")
    if api_key:
        from openai import OpenAI

        return ChatCompletionTarget(
            client=OpenAI(
                api_key=api_key,
                timeout=timeout_s,
                max_retries=max_retries,
            ),
            model=_resolve_openai_model(profile),
            provider="openai",
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
