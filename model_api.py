"""Client for Meta's Model API (OpenAI-compatible) to call Muse Spark models.

The API key is read from the ``MUSE_SPARK_API_KEY`` environment variable
first, falling back to the ``[model_api]`` config section. An empty key means
model features are disabled; the client raises if used without a key.

Get a key at https://dev.meta.ai (developer console, API keys).
"""

from __future__ import annotations

import os

ENV_VAR = "MUSE_SPARK_API_KEY"
DEFAULT_BASE_URL = "https://api.ai.meta.com/v1"
DEFAULT_MODEL = "muse-spark-1.3"


class ModelApiClient:
    """Thin wrapper around the OpenAI SDK pointed at Meta's Model API."""

    def __init__(
        self,
        api_key: str = "",
        model: str = DEFAULT_MODEL,
        base_url: str = DEFAULT_BASE_URL,
    ) -> None:
        self.api_key = api_key or os.environ.get(ENV_VAR, "")
        self.model = model
        self.base_url = base_url

    @property
    def enabled(self) -> bool:
        """Whether a key is configured and the client can be used."""
        return bool(self.api_key)

    def _client(self):  # type: ignore[no-untyped-def]
        if not self.enabled:
            raise RuntimeError(
                f"Model API key is not configured (set {ENV_VAR} "
                "or the model_api.api_key config value)"
            )
        from openai import OpenAI

        return OpenAI(api_key=self.api_key, base_url=self.base_url)

    def chat(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> str:
        """Send chat messages, return the assistant's text reply."""
        client = self._client()
        response = client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return response.choices[0].message.content or ""
