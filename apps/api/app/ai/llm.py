"""One interface to every model provider (CLAUDE.md: `LLMClient`).

Agents ask for a tier (`light` or `mid`), never a model. Config maps the tier to a provider and a
model, so changing provider is a settings change. A tier with no model is off and `client_for`
returns None; callers then fall back to Python wording.
"""

from __future__ import annotations

import json
import re
import threading
import time
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

# A busy provider (429, 5xx, a dropped connection) is retried a little, then given up on so the
# fallback can answer. A provider that asks us to wait longer than the budget is not waited for.
MAX_ATTEMPTS = 3
RETRY_BUDGET_SECONDS = 8.0
BACKOFF_SECONDS = 0.5
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
# A model that failed this many times within the window is skipped for that long.
BREAKER_FAILURES = 3
BREAKER_WINDOW_SECONDS = 60.0


class LLMError(RuntimeError):
    """The provider could not answer (network, rate limit, bad reply). Never holds a key."""


class LLMRateLimited(LLMError):
    """The provider answered 429: too many requests (or the free allowance is used up)."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


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


def _retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("retry-after")
    try:
        return max(0.0, float(raw)) if raw else None
    except ValueError:
        return None


def _fail(provider: str, response: httpx.Response) -> LLMError:
    body = response.text.replace("\n", " ")[:ERROR_BODY_CHARS]
    message = f"{provider} answered {response.status_code}: {body}"
    if response.status_code == 429:
        return LLMRateLimited(message, _retry_after(response))
    return LLMError(message)


def _sleep(seconds: float) -> None:  # its own function so tests can skip the waiting
    time.sleep(seconds)


def _post(
    provider: str,
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    timeout: float,
    transport: httpx.BaseTransport | None,
) -> httpx.Response:
    """POST with a short, bounded retry on busy / unreachable providers. Returns the last answer
    for a non-retryable status; the caller turns a 4xx into an error."""
    waited = 0.0
    for attempt in range(MAX_ATTEMPTS):
        cause: Exception | None = None
        try:
            with httpx.Client(timeout=timeout, transport=transport) as client:
                response = client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as error:
            cause = error
            failure: LLMError = LLMError(
                f"{provider} could not be reached ({type(error).__name__})"
            )
            wait = BACKOFF_SECONDS * 2**attempt
        else:
            if response.status_code not in RETRYABLE_STATUS:
                return response
            failure = _fail(provider, response)
            wait = _retry_after(response) or BACKOFF_SECONDS * 2**attempt
        if attempt == MAX_ATTEMPTS - 1 or waited + wait > RETRY_BUDGET_SECONDS:
            raise failure from cause
        _sleep(wait)
        waited += wait
    raise LLMError(f"{provider} could not be reached")  # unreachable; keeps the types honest


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
        self,
        tier: LLMTier,
        timeout: float,
        transport: httpx.BaseTransport | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.model = tier.model
        self.label = f"{tier.vendor or 'provider'}:{tier.model}"
        self._base = tier.base_url
        self._key = tier.api_key
        self._timeout = timeout
        self._transport = transport
        self._extra_headers = extra_headers or {}

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
        headers = dict(self._extra_headers)
        if self._key:
            headers["Authorization"] = f"Bearer {self._key}"
        url = f"{self._base}/chat/completions"
        response = _post(
            "The model provider", url, payload, headers, self._timeout, self._transport
        )
        if json_output and response.status_code == 400 and "json" in response.text.lower():
            # JSON mode makes some providers refuse a reply that is not clean JSON (a model that
            # thinks aloud first). Ask again without it: the reply is parsed and checked here.
            payload.pop("response_format", None)
            response = _post(
                "The model provider", url, payload, headers, self._timeout, self._transport
            )
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
        self.label = f"anthropic:{tier.model}"
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
        response = _post(
            "Anthropic",
            f"{self._base}/v1/messages",
            payload,
            headers,
            self._timeout,
            self._transport,
        )
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


# Which models have failed lately, shared by every request in this process (clients are made per
# request, so the memory cannot live on them).
_failures: dict[str, list[float]] = {}
_failures_lock = threading.Lock()


def _now() -> float:  # its own function so tests can move the clock
    return time.monotonic()


def _recent_failures(label: str) -> list[float]:
    cutoff = _now() - BREAKER_WINDOW_SECONDS
    return [t for t in _failures.get(label, []) if t > cutoff]


def breaker_open(label: str) -> bool:
    """True while a model has failed too often to be worth asking."""
    with _failures_lock:
        return len(_recent_failures(label)) >= BREAKER_FAILURES


def _record_failure(label: str) -> None:
    with _failures_lock:
        _failures[label] = [*_recent_failures(label), _now()]


def _record_success(label: str) -> None:
    with _failures_lock:
        _failures.pop(label, None)


def reset_breakers() -> None:
    with _failures_lock:
        _failures.clear()


def _label_of(client: LLMClient) -> str:
    return str(getattr(client, "label", client.model))


class FallbackClient:
    """Asks the primary model, and the next one when it is rate-limited, down or refuses the key.

    A model that keeps failing is skipped for a minute so every message does not wait for it.
    `answered_by` is the label of the model that gave the last reply.
    """

    def __init__(self, clients: Sequence[LLMClient]) -> None:
        if not clients:
            raise ValueError("FallbackClient needs at least one client")
        self._clients = list(clients)
        self.model = clients[0].model
        self.label = _label_of(clients[0])
        self.answered_by = self.label

    def chat(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] = (),
        json_output: bool = False,
        max_tokens: int = 1024,
    ) -> LLMReply:
        candidates = [c for c in self._clients if not breaker_open(_label_of(c))] or self._clients
        problems: list[str] = []
        for client in candidates:
            label = _label_of(client)
            try:
                reply = client.chat(
                    messages, tools=tools, json_output=json_output, max_tokens=max_tokens
                )
            except LLMError as error:
                _record_failure(label)
                problems.append(f"{label}: {error}")
                continue
            _record_success(label)
            self.answered_by = label
            return reply
        raise LLMError("No model provider could answer. " + " | ".join(problems))


def client_for(
    settings: Settings,
    tier: Literal["light", "mid"],
    transport: httpx.BaseTransport | None = None,
) -> LLMClient | None:
    """The model client for a tier (its fallbacks included), or None when the tier is off."""
    clients: list[LLMClient] = []
    for config in settings.llm_tiers(tier):
        if config.provider == "anthropic":
            clients.append(AnthropicClient(config, settings.llm_timeout_seconds, transport))
            continue
        headers = (
            {"HTTP-Referer": settings.web_base_url, "X-Title": "CONSTRUCTIQ"}
            if config.vendor == "openrouter"
            else None
        )
        clients.append(
            OpenAICompatibleClient(config, settings.llm_timeout_seconds, transport, headers)
        )
    if not clients:
        return None
    return clients[0] if len(clients) == 1 else FallbackClient(clients)
