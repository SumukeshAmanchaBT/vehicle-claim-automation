"""
OpenAI or Azure OpenAI client for chat.completions (vision + text).

Configure via environment variables — see vca-python/.env.example.
Azure is used when endpoint, API key, and deployment are all set; otherwise OpenAI when OPENAI_API_KEY is set.
"""
from __future__ import annotations

import os
from typing import Any


def get_chat_completion_client_and_model() -> tuple[Any, str] | tuple[None, None]:
    """
    Return (client, model) suitable for client.chat.completions.create(..., model=model).

    Azure: model must be the deployment name (e.g. gpt-4o).
    """
    endpoint = (os.getenv("AZURE_OPENAI_ENDPOINT") or "").strip().rstrip("/")
    azure_key = (os.getenv("AZURE_OPENAI_API_KEY") or "").strip()
    deployment = (os.getenv("AZURE_OPENAI_DEPLOYMENT") or "").strip()
    api_version = (
        os.getenv("AZURE_OPENAI_API_VERSION") or "2024-12-01-preview"
    ).strip()

    if endpoint and azure_key and deployment:
        from openai import AzureOpenAI

        ep = endpoint if endpoint.endswith("/") else f"{endpoint}/"
        client = AzureOpenAI(
            api_version=api_version,
            azure_endpoint=ep,
            api_key=azure_key,
        )
        return client, deployment

    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if api_key:
        from openai import OpenAI

        model = (os.getenv("OPENAI_VISION_MODEL") or "gpt-4o-mini").strip()
        return OpenAI(api_key=api_key), model

    return None, None


def llm_configured() -> bool:
    client, _ = get_chat_completion_client_and_model()
    return client is not None
