"""One interface to every model provider (CLAUDE.md: `LLMClient`).

Agents ask for a tier (`light` or `mid`), never a model. Config maps the tier to a provider and a
model, so changing provider is a settings change. A tier with no model is off and `client_for`
returns None; callers then fall back to Python wording.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

import httpx2 as httpx

from app.config import LLMTier, Settings

# The neutral message shape both adapters translate to and from:
#   {"role": "system" | "user" | "assistant" | "tool", "content": str,
#    "tool_calls": [ToolCall, ...]   (assistant only),
#    "tool_call_id": str             (tool only)}
Message = dict[str, Any]

ERROR_BODY_CHARS = 200


class LLMError(RuntimeError):
    """The provider could not answer (network, rate limit, bad reply). Never holds a key."""


@dataclass(frozen=True)
class ToolSpec:
    """A tool the model may call: its name, what it does, and a JSON schema for its arguments."""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class LLMReply:
    content: str
    tool_calls: tuple[ToolCall, ...] = ()
    input_tokens: int = 0
    output_tokens: int = 0


class LLMClient(Protocol):
    model: str

    def chat(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] = (),
        json_output: bool = False,
        max_tokens: int = 1024,
    ) -> LLMReply: ...


def _obj(value: Any) -> dict[str, Any]:
    """A JSON object, or an empty one when the value is anything else."""
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _objects(value: Any) -> list[dict[str, Any]]:
    """The JSON objects in a JSON array (anything else in it is ignored)."""
    if not isinstance(value, list):
        return []
    return [cast("dict[str, Any]", v) for v in cast("list[Any]", value) if isinstance(v, dict)]


def _count(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def parse_json_object(text: str) -> dict[str, Any]:
    """The JSON object in a model's reply, tolerating a code fence or a sentence around it."""
    cleaned = _FENCE.sub("", text.strip())
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("The reply is not a JSON object")
    value: Any = json.loads(cleaned[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("The reply is not a JSON object")
    return cast("dict[str, Any]", value)


def _fail(provider: str, response: httpx.Response) -> LLMError:
    body = response.text.replace("\n", " ")[:ERROR_BODY_CHARS]
    return LLMError(f"{provider} answered {response.status_code}: {body}")


def _json_of(provider: str, response: httpx.Response) -> dict[str, Any]:
    if response.status_code >= 400:
        raise _fail(provider, response)
    try:
        data: Any = response.json()
    except ValueError as error:
        raise LLMError(f"{provider} sent a reply that is not JSON") from error
    if not isinstance(data, dict):
        raise LLMError(f"{provider} sent an unexpected reply")
    return cast("dict[str, Any]", data)


def _arguments(raw: Any) -> dict[str, Any]:
    """Tool arguments arrive as a JSON string (OpenAI) or an object (Anthropic)."""
    if isinstance(raw, dict):
        return cast("dict[str, Any]", raw)
    try:
        value: Any = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {"_invalid": str(raw)[:ERROR_BODY_CHARS]}
    if isinstance(value, dict):
        return cast("dict[str, Any]", value)
    return {"_invalid": str(raw)[:ERROR_BODY_CHARS]}


class OpenAICompatibleClient:
    """Groq, OpenRouter, Ollama and anything else that speaks `/chat/completions`."""

    def __init__(
        self, tier: LLMTier, timeout: float, transport: httpx.BaseTransport | None = None
    ) -> None:
        self.model = tier.model
        self._base = tier.base_url
        self._key = tier.api_key
        self._timeout = timeout
        self._transport = transport

    def chat(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] = (),
        json_output: bool = False,
        max_tokens: int = 1024,
    ) -> LLMReply:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [self._message(m) for m in messages],
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
        if tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ]
            payload["tool_choice"] = "auto"
        if json_output:
            payload["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {self._key}"} if self._key else {}
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.post(
                    f"{self._base}/chat/completions", json=payload, headers=headers
                )
        except httpx.HTTPError as error:
            raise LLMError(
                f"The model provider could not be reached ({type(error).__name__})"
            ) from error
        data = _json_of("The model provider", response)
        choices = _objects(data.get("choices"))
        message = _obj(choices[0].get("message")) if choices else {}
        if not message:
            raise LLMError("The model provider sent a reply with no message")
        calls = tuple(
            ToolCall(
                id=str(c.get("id") or f"call_{i}"),
                name=str(_obj(c.get("function")).get("name", "")),
                arguments=_arguments(_obj(c.get("function")).get("arguments")),
            )
            for i, c in enumerate(_objects(message.get("tool_calls")))
        )
        usage = _obj(data.get("usage"))
        return LLMReply(
            content=str(message.get("content") or ""),
            tool_calls=calls,
            input_tokens=_count(usage.get("prompt_tokens")),
            output_tokens=_count(usage.get("completion_tokens")),
        )

    @staticmethod
    def _message(m: Message) -> dict[str, Any]:
        if m["role"] == "tool":
            return {"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]}
        if m["role"] == "assistant" and m.get("tool_calls"):
            return {
                "role": "assistant",
                "content": m.get("content") or None,
                "tool_calls": [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.name, "arguments": json.dumps(c.arguments)},
                    }
                    for c in cast("list[ToolCall]", m["tool_calls"])
                ],
            }
        return {"role": m["role"], "content": m["content"]}


class AnthropicClient:
    """The Anthropic Messages API (production tiers). Same neutral messages in and out."""

    VERSION = "2023-06-01"

    def __init__(
        self, tier: LLMTier, timeout: float, transport: httpx.BaseTransport | None = None
    ) -> None:
        self.model = tier.model
        self._base = tier.base_url
        self._key = tier.api_key
        self._timeout = timeout
        self._transport = transport

    def chat(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] = (),
        json_output: bool = False,
        max_tokens: int = 1024,
    ) -> LLMReply:
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        if json_output:
            system += "\n\nReply with one JSON object and nothing else."
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": 0.2,
            "messages": self._messages([m for m in messages if m["role"] != "system"]),
        }
        if system.strip():
            payload["system"] = system.strip()
        if tools:
            payload["tools"] = [
                {"name": t.name, "description": t.description, "input_schema": t.parameters}
                for t in tools
            ]
        headers = {"x-api-key": self._key, "anthropic-version": self.VERSION}
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.post(f"{self._base}/v1/messages", json=payload, headers=headers)
        except httpx.HTTPError as error:
            raise LLMError(f"Anthropic could not be reached ({type(error).__name__})") from error
        data = _json_of("Anthropic", response)
        if not isinstance(data.get("content"), list):
            raise LLMError("Anthropic sent a reply with no content")
        blocks = _objects(data["content"])
        text = "".join(str(b.get("text", "")) for b in blocks if b.get("type") == "text")
        calls = tuple(
            ToolCall(id=str(b["id"]), name=str(b["name"]), arguments=_arguments(b.get("input")))
            for b in blocks
            if b.get("type") == "tool_use"
        )
        usage = _obj(data.get("usage"))
        return LLMReply(
            content=text,
            tool_calls=calls,
            input_tokens=_count(usage.get("input_tokens")),
            output_tokens=_count(usage.get("output_tokens")),
        )

    @staticmethod
    def _messages(messages: Sequence[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for m in messages:
            if m["role"] == "tool":
                block: dict[str, Any] = {
                    "type": "tool_result",
                    "tool_use_id": m["tool_call_id"],
                    "content": m["content"],
                }
                last = out[-1] if out else None
                if (
                    last is not None
                    and last["role"] == "user"
                    and isinstance(last["content"], list)
                ):
                    cast("list[dict[str, Any]]", last["content"]).append(block)
                else:  # the results of one round share one user message
                    out.append({"role": "user", "content": [block]})
            elif m["role"] == "assistant" and m.get("tool_calls"):
                content: list[dict[str, Any]] = []
                if m.get("content"):
                    content.append({"type": "text", "text": m["content"]})
                content += [
                    {"type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments}
                    for c in cast("list[ToolCall]", m["tool_calls"])
                ]
                out.append({"role": "assistant", "content": content})
            else:
                out.append({"role": m["role"], "content": m["content"]})
        return out


def client_for(
    settings: Settings,
    tier: Literal["light", "mid"],
    transport: httpx.BaseTransport | None = None,
) -> LLMClient | None:
    """The model client for a tier, or None when the tier is off."""
    config = settings.llm_tier(tier)
    if config is None:
        return None
    adapter = AnthropicClient if config.provider == "anthropic" else OpenAICompatibleClient
    return adapter(config, settings.llm_timeout_seconds, transport)
