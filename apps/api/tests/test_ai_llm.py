"""The two model adapters, driven by canned provider replies (no network), and the tier config."""

from __future__ import annotations

import json
from typing import Any

import httpx2 as httpx
import pytest

from app.ai.llm import (
    AnthropicClient,
    LLMError,
    OpenAICompatibleClient,
    ToolCall,
    ToolSpec,
    client_for,
    parse_json_object,
)
from app.config import ConfigError, production_problems, validate_for_environment
from tests.support import make_settings

KEY = "sk-test-secret-key-0000"  # noqa: S105
SEARCH = ToolSpec(
    "search", "Find people", {"type": "object", "properties": {"trade": {"type": "string"}}}
)


def openai(handler: Any, key: str = KEY) -> OpenAICompatibleClient:
    settings = make_settings(
        llm_tier_light_model="llama-test",
        llm_tier_light_base_url="https://llm.example.test/v1/",
        llm_tier_light_api_key=key,
    )
    client = client_for(settings, "light", httpx.MockTransport(handler))
    assert isinstance(client, OpenAICompatibleClient)
    return client


def anthropic(handler: Any) -> AnthropicClient:
    settings = make_settings(
        llm_tier_mid_provider="anthropic",
        llm_tier_mid_model="claude-test",
        llm_tier_mid_api_key=KEY,
    )
    client = client_for(settings, "mid", httpx.MockTransport(handler))
    assert isinstance(client, AnthropicClient)
    return client


# ------------------------------------------------------------------------------- OpenAI-compatible


def test_openai_compatible_sends_the_chat_request_and_reads_the_reply() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"ok": true}'}}],
                "usage": {"prompt_tokens": 31, "completion_tokens": 7},
            },
        )

    reply = openai(handler).chat(
        [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}],
        json_output=True,
        max_tokens=300,
    )
    assert seen["url"] == "https://llm.example.test/v1/chat/completions"  # no double slash
    assert seen["auth"] == f"Bearer {KEY}"
    assert seen["body"]["model"] == "llama-test"
    assert seen["body"]["max_tokens"] == 300
    assert seen["body"]["response_format"] == {"type": "json_object"}
    assert reply.content == '{"ok": true}'
    assert (reply.input_tokens, reply.output_tokens) == (31, 7)


def test_a_provider_without_a_key_such_as_ollama_gets_no_authorization_header() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"choices": [{"message": {"content": "hi"}}]})

    openai(handler, key="").chat([{"role": "user", "content": "u"}])
    assert seen["auth"] is None


def test_tool_calls_are_sent_and_read_back() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "search",
                                        "arguments": '{"trade": "mason"}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        )

    history = [
        {"role": "user", "content": "find masons"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [ToolCall("c0", "search", {"trade": "x"})],
        },
        {"role": "tool", "tool_call_id": "c0", "content": '{"found": 0}'},
    ]
    reply = openai(handler).chat(history, tools=[SEARCH])
    assert reply.tool_calls == (ToolCall("call_1", "search", {"trade": "mason"}),)
    sent = seen["body"]
    assert sent["tools"][0]["function"]["name"] == "search"
    assert sent["messages"][1]["tool_calls"][0]["function"]["arguments"] == '{"trade": "x"}'
    assert sent["messages"][2] == {"role": "tool", "tool_call_id": "c0", "content": '{"found": 0}'}


def test_unreadable_tool_arguments_are_passed_on_as_invalid_not_guessed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        call = {"id": "c", "function": {"name": "search", "arguments": "{not json"}}
        return httpx.Response(200, json={"choices": [{"message": {"tool_calls": [call]}}]})

    reply = openai(handler).chat([{"role": "user", "content": "u"}], tools=[SEARCH])
    assert "_invalid" in reply.tool_calls[0].arguments


def test_a_provider_error_is_reported_without_the_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="rate limit reached for key " + KEY[:6])

    with pytest.raises(LLMError) as error:
        openai(handler).chat([{"role": "user", "content": "u"}])
    assert "429" in str(error.value)
    assert KEY not in str(error.value)


def test_a_network_failure_and_a_non_json_reply_both_become_llm_errors() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    with pytest.raises(LLMError, match="could not be reached"):
        openai(down).chat([{"role": "user", "content": "u"}])

    def html(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>oops</html>")

    with pytest.raises(LLMError, match="not JSON"):
        openai(html).chat([{"role": "user", "content": "u"}])


def test_a_reply_without_a_message_is_an_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    with pytest.raises(LLMError, match="no message"):
        openai(handler).chat([{"role": "user", "content": "u"}])


# ------------------------------------------------------------------------------------- Anthropic


def test_anthropic_gets_the_system_prompt_apart_and_tools_as_input_schemas() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-api-key")
        seen["version"] = request.headers.get("anthropic-version")
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "text", "text": "Looking."},
                    {
                        "type": "tool_use",
                        "id": "tu_1",
                        "name": "search",
                        "input": {"trade": "mason"},
                    },
                ],
                "usage": {"input_tokens": 50, "output_tokens": 12},
            },
        )

    reply = anthropic(handler).chat(
        [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "find masons"}],
        tools=[SEARCH],
        json_output=True,
    )
    body = seen["body"]
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["key"] == KEY and seen["version"] == "2023-06-01"
    assert body["system"].startswith("Be brief.") and "one JSON object" in body["system"]
    assert body["messages"] == [{"role": "user", "content": "find masons"}]  # no system message
    assert body["tools"][0]["input_schema"] == SEARCH.parameters
    assert reply.content == "Looking."
    assert reply.tool_calls == (ToolCall("tu_1", "search", {"trade": "mason"}),)
    assert (reply.input_tokens, reply.output_tokens) == (50, 12)


def test_anthropic_tool_results_of_one_round_share_one_user_message() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"content": [{"type": "text", "text": "done"}]})

    history = [
        {"role": "user", "content": "go"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [ToolCall("a", "search", {}), ToolCall("b", "search", {})],
        },
        {"role": "tool", "tool_call_id": "a", "content": "1"},
        {"role": "tool", "tool_call_id": "b", "content": "2"},
    ]
    anthropic(handler).chat(history, tools=[SEARCH])
    messages = seen["body"]["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    assert [b["tool_use_id"] for b in messages[2]["content"]] == ["a", "b"]


def test_anthropic_errors_are_reported_without_the_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "invalid x-api-key"}})

    with pytest.raises(LLMError) as error:
        anthropic(handler).chat([{"role": "user", "content": "u"}])
    assert "401" in str(error.value) and KEY not in str(error.value)


# ----------------------------------------------------------------------------- reading JSON replies


@pytest.mark.parametrize(
    "reply",
    [
        '{"a": 1}',
        '```json\n{"a": 1}\n```',
        'Here you go: {"a": 1} Hope that helps.',
        '  {"a": 1}  ',
    ],
)
def test_a_json_object_is_found_in_a_fenced_or_chatty_reply(reply: str) -> None:
    assert parse_json_object(reply) == {"a": 1}


@pytest.mark.parametrize("reply", ["no json here", "[1, 2]", '{"a": ', ""])
def test_a_reply_without_a_json_object_is_refused(reply: str) -> None:
    with pytest.raises(ValueError, match=r".*"):
        parse_json_object(reply)


# ------------------------------------------------------------------------------------- tier config


def test_a_tier_without_a_model_is_off() -> None:
    settings = make_settings()
    assert settings.llm_tier("light") is None and settings.llm_tier("mid") is None
    assert client_for(settings, "light") is None


def test_an_openai_compatible_tier_needs_a_base_url_but_not_a_key() -> None:
    assert make_settings(llm_tier_light_model="m").llm_tier("light") is None  # nowhere to send it
    ollama = make_settings(
        llm_tier_light_model="m", llm_tier_light_base_url="http://localhost:11434/v1"
    ).llm_tier("light")
    assert ollama is not None and ollama.api_key == ""


def test_an_anthropic_tier_needs_a_key_and_defaults_its_address() -> None:
    assert (
        make_settings(llm_tier_mid_provider="anthropic", llm_tier_mid_model="m").llm_tier("mid")
        is None
    )
    on = make_settings(
        llm_tier_mid_provider="anthropic", llm_tier_mid_model="m", llm_tier_mid_api_key="k"
    ).llm_tier("mid")
    assert on is not None and on.base_url == "https://api.anthropic.com"


def test_production_refuses_a_model_without_a_key() -> None:
    settings = make_settings(
        app_env="production",
        demo_mode=False,
        simulated_clock=False,
        demo_password="",
        storage_backend="s3",
        llm_tier_light_free=False,
        llm_tier_mid_free=False,
        n8n_hmac_secret="n" * 40,
        database_url="postgresql+psycopg://constructiq_app:real@db/constructiq",
        llm_tier_light_model="m",
    )
    assert any(
        "tier 'light' has a model but no API key" in p for p in production_problems(settings)
    )
    with pytest.raises(ConfigError):
        validate_for_environment(settings)
    ok = settings.model_copy(update={"llm_tier_light_api_key": "k"})
    assert production_problems(ok) == []
