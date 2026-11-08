"""Two named providers per tier: the config that picks them, the retry on a busy provider, and the
fallback that answers when the primary cannot. No network: every reply is canned."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx2 as httpx
import pytest

from app.ai import llm
from app.ai.llm import (
    FallbackClient,
    LLMError,
    LLMRateLimited,
    OpenAICompatibleClient,
    client_for,
)
from app.config import AppEnv, production_problems
from tests.support import make_settings
from tests.test_config import prod_settings

GROQ_KEY = "gsk-test-groq-secret"
ROUTER_KEY = "sk-or-test-router-secret"
MESSAGES = [{"role": "user", "content": "hi"}]
OK: dict[str, Any] = {"choices": [{"message": {"content": "hello"}}], "usage": {}}


def reply(
    status: int, text: str = "", headers: dict[str, str] | None = None
) -> Callable[[httpx.Request], httpx.Response]:
    """A provider that always answers with this status."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=text, headers=headers)

    return handler


@pytest.fixture(autouse=True)
def calm(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[float]]:
    """No real waiting, and no failures remembered from another test."""
    waits: list[float] = []
    monkeypatch.setattr(llm, "_sleep", waits.append)
    llm.reset_breakers()
    yield waits
    llm.reset_breakers()


def two_providers(**more: object) -> Any:
    return make_settings(
        llm_tier_mid_primary="groq:llama-3.3-70b-versatile",
        llm_tier_mid_fallback="openrouter:openai/gpt-oss-120b:free",
        groq_api_key=GROQ_KEY,
        openrouter_api_key=ROUTER_KEY,
        **more,
    )


def router(handlers: dict[str, Any]) -> httpx.MockTransport:
    """Sends each request to the handler for its host and records the order they were asked."""

    def handle(request: httpx.Request) -> httpx.Response:
        return handlers[request.url.host](request)

    return httpx.MockTransport(handle)


def answer(_: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json=OK)


# ------------------------------------------------------------------------------------------ config


def test_primary_then_fallback_with_the_right_address_and_key() -> None:
    primary, fallback = two_providers().llm_tiers("mid")
    assert (primary.vendor, primary.model, primary.base_url, primary.api_key) == (
        "groq",
        "llama-3.3-70b-versatile",
        "https://api.groq.com/openai/v1",
        GROQ_KEY,
    )
    assert (fallback.vendor, fallback.model, fallback.base_url, fallback.api_key) == (
        "openrouter",
        "openai/gpt-oss-120b:free",
        "https://openrouter.ai/api/v1",
        ROUTER_KEY,
    )


def test_a_model_name_with_a_colon_is_kept_whole() -> None:
    (spec,) = make_settings(
        llm_tier_light_primary="openrouter:nvidia/nemotron-3.5-super-vl:free",
        openrouter_api_key="k",
    ).llm_specs("light")
    assert (spec.vendor, spec.model) == ("openrouter", "nvidia/nemotron-3.5-super-vl:free")


def test_a_provider_without_a_key_is_left_out_and_the_other_still_answers() -> None:
    settings = make_settings(
        llm_tier_mid_primary="groq:m",
        llm_tier_mid_fallback="openrouter:x/y:free",
        openrouter_api_key=ROUTER_KEY,
    )
    assert [t.vendor for t in settings.llm_tiers("mid")] == ["openrouter"]
    assert make_settings(llm_tier_mid_primary="groq:m").llm_tier("mid") is None


def test_an_unknown_provider_switches_nothing_on() -> None:
    settings = make_settings(llm_tier_mid_primary="groqq:m", groq_api_key=GROQ_KEY)
    assert settings.llm_tier("mid") is None
    assert client_for(settings, "mid") is None


def test_free_is_worked_out_from_the_provider_and_the_model() -> None:
    free = {
        (s.vendor, s.model): s.free
        for s in make_settings(
            llm_tier_mid_primary="groq:a", llm_tier_mid_fallback="openrouter:b"
        ).llm_specs("mid")
    }
    assert free == {("groq", "a"): True, ("openrouter", "b"): False}
    paid = make_settings(llm_tier_mid_primary="groq:a", llm_paid_providers="Groq")
    assert not paid.llm_specs("mid")[0].free
    assert make_settings(llm_tier_mid_primary="openrouter:b:free").llm_specs("mid")[0].free


def test_the_older_single_provider_lines_still_work_and_lose_to_a_primary() -> None:
    flat = {
        "llm_tier_light_model": "m",
        "llm_tier_light_base_url": "https://x.test/v1",
        "llm_tier_light_api_key": "k",
    }
    assert make_settings(**flat).llm_tier("light") is not None
    named = make_settings(llm_tier_light_primary="groq:g", groq_api_key=GROQ_KEY, **flat)
    assert [t.model for t in named.llm_tiers("light")] == ["g"]


def test_production_refuses_a_free_or_unkeyed_provider_but_accepts_paid_ones() -> None:
    free = prod_settings(llm_tier_mid_primary="groq:g", groq_api_key=GROQ_KEY)
    assert any("free-tier" in p and "mid" in p for p in production_problems(free))
    unkeyed = prod_settings(llm_tier_mid_primary="groq:g", llm_paid_providers="groq")
    assert any("no API key" in p for p in production_problems(unkeyed))
    unknown = prod_settings(llm_tier_light_primary="groqq:g")
    assert any("not a known provider" in p for p in production_problems(unknown))
    paid = prod_settings(
        llm_tier_mid_primary="groq:g", llm_paid_providers="groq", groq_api_key=GROQ_KEY
    )
    assert production_problems(paid) == []
    assert paid.app_env is AppEnv.PRODUCTION


# ------------------------------------------------------------------------------------------ retry


def test_a_rate_limit_is_retried_and_the_answer_used(calm: list[float]) -> None:
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, text="slow down")
        return httpx.Response(200, json=OK)

    client = client_for(
        make_settings(llm_tier_mid_primary="groq:g", groq_api_key=GROQ_KEY),
        "mid",
        httpx.MockTransport(handler),
    )
    assert client is not None
    assert client.chat(MESSAGES).content == "hello"
    assert calls["n"] == 3
    assert calm == [0.5, 1.0]  # waited a little, twice


def test_a_provider_that_asks_for_a_long_wait_is_not_waited_for(calm: list[float]) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="daily limit", headers={"retry-after": "30"})

    client = client_for(
        make_settings(llm_tier_mid_primary="groq:g", groq_api_key=GROQ_KEY),
        "mid",
        httpx.MockTransport(handler),
    )
    assert client is not None
    with pytest.raises(LLMRateLimited) as caught:
        client.chat(MESSAGES)
    assert caught.value.retry_after == 30
    assert calm == []


def test_a_server_error_is_retried_up_to_three_times_then_reported(calm: list[float]) -> None:
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503, text="overloaded")

    client = client_for(
        make_settings(llm_tier_mid_primary="groq:g", groq_api_key=GROQ_KEY),
        "mid",
        httpx.MockTransport(handler),
    )
    assert client is not None
    with pytest.raises(LLMError, match="503"):
        client.chat(MESSAGES)
    assert calls["n"] == 3


def test_a_provider_that_refuses_json_mode_is_asked_again_without_it() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        bodies.append(body)
        if "response_format" in body:
            return httpx.Response(400, text='{"error":{"message":"Failed to validate JSON."}}')
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"a": 1}'}}]})

    client = client_for(
        make_settings(llm_tier_mid_primary="groq:g", groq_api_key=GROQ_KEY),
        "mid",
        httpx.MockTransport(handler),
    )
    assert client is not None
    assert client.chat(MESSAGES, json_output=True).content == '{"a": 1}'
    assert ["response_format" in b for b in bodies] == [True, False]


def test_a_400_that_is_not_about_json_is_not_asked_again() -> None:
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, text='{"error":{"message":"The model does not exist"}}')

    client = client_for(
        make_settings(llm_tier_mid_primary="groq:g", groq_api_key=GROQ_KEY),
        "mid",
        httpx.MockTransport(handler),
    )
    assert client is not None
    with pytest.raises(LLMError, match="400"):
        client.chat(MESSAGES, json_output=True)
    assert calls["n"] == 1


def test_a_refused_key_is_not_retried(calm: list[float]) -> None:
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, text="bad key")

    client = client_for(
        make_settings(llm_tier_mid_primary="groq:g", groq_api_key=GROQ_KEY),
        "mid",
        httpx.MockTransport(handler),
    )
    assert client is not None
    with pytest.raises(LLMError, match="401"):
        client.chat(MESSAGES)
    assert calls["n"] == 1
    assert calm == []


def test_an_unreachable_provider_is_retried_then_reported_without_the_key() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route")

    client = client_for(
        make_settings(llm_tier_mid_primary="groq:g", groq_api_key=GROQ_KEY),
        "mid",
        httpx.MockTransport(handler),
    )
    assert client is not None
    with pytest.raises(LLMError) as caught:
        client.chat(MESSAGES)
    assert "could not be reached" in str(caught.value)
    assert GROQ_KEY not in str(caught.value)


# --------------------------------------------------------------------------------------- fallback


def test_each_provider_gets_its_own_key_and_openrouter_is_named() -> None:
    seen: dict[str, dict[str, str]] = {}

    def record(host: str) -> Any:
        def handler(request: httpx.Request) -> httpx.Response:
            seen[host] = dict(request.headers)
            return httpx.Response(429 if host == "api.groq.com" else 200, json=OK)

        return handler

    client = client_for(
        two_providers(web_base_url="https://hr.example.test"),
        "mid",
        router({"api.groq.com": record("api.groq.com"), "openrouter.ai": record("openrouter.ai")}),
    )
    assert isinstance(client, FallbackClient)
    client.chat(MESSAGES)
    assert seen["api.groq.com"]["authorization"] == f"Bearer {GROQ_KEY}"
    assert "http-referer" not in seen["api.groq.com"]
    assert seen["openrouter.ai"]["authorization"] == f"Bearer {ROUTER_KEY}"
    assert seen["openrouter.ai"]["http-referer"] == "https://hr.example.test"
    assert seen["openrouter.ai"]["x-title"] == "HAMRA AI"


def test_the_fallback_answers_when_the_primary_is_rate_limited() -> None:
    client = client_for(
        two_providers(),
        "mid",
        router(
            {
                "api.groq.com": reply(429, "limit", {"retry-after": "60"}),
                "openrouter.ai": answer,
            }
        ),
    )
    assert isinstance(client, FallbackClient)
    assert client.chat(MESSAGES).content == "hello"
    assert client.answered_by == "openrouter:openai/gpt-oss-120b:free"


def test_the_fallback_answers_when_the_primary_refuses_the_key() -> None:
    client = client_for(
        two_providers(),
        "mid",
        router({"api.groq.com": reply(401, "bad key"), "openrouter.ai": answer}),
    )
    assert client is not None
    assert client.chat(MESSAGES).content == "hello"


def test_the_primary_is_used_while_it_works() -> None:
    asked: list[str] = []

    def record(host: str) -> Any:
        def handler(request: httpx.Request) -> httpx.Response:
            asked.append(request.url.host)
            return httpx.Response(200, json=OK)

        return handler

    client = client_for(
        two_providers(),
        "mid",
        router({"api.groq.com": record("api.groq.com"), "openrouter.ai": record("openrouter.ai")}),
    )
    assert isinstance(client, FallbackClient)
    client.chat(MESSAGES)
    assert asked == ["api.groq.com"]
    assert client.answered_by == "groq:llama-3.3-70b-versatile"


def test_a_model_that_keeps_failing_is_skipped_for_a_minute(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = {"now": 1000.0}
    monkeypatch.setattr(llm, "_now", lambda: clock["now"])
    asked: list[str] = []

    def groq(request: httpx.Request) -> httpx.Response:
        asked.append("groq")
        return httpx.Response(401, text="bad key")

    def open_router(request: httpx.Request) -> httpx.Response:
        asked.append("openrouter")
        return httpx.Response(200, json=OK)

    client = client_for(
        two_providers(), "mid", router({"api.groq.com": groq, "openrouter.ai": open_router})
    )
    assert client is not None
    for _ in range(3):
        client.chat(MESSAGES)
    assert asked.count("groq") == 3
    client.chat(MESSAGES)  # the breaker is open: straight to the fallback
    assert asked.count("groq") == 3
    assert llm.breaker_open("groq:llama-3.3-70b-versatile")
    clock["now"] += 61
    client.chat(MESSAGES)  # a minute later it is asked again
    assert asked.count("groq") == 4


def test_when_every_provider_fails_the_error_names_each_without_keys() -> None:
    client = client_for(
        two_providers(),
        "mid",
        router(
            {
                "api.groq.com": reply(401, "bad key"),
                "openrouter.ai": reply(402, "no credits"),
            }
        ),
    )
    assert client is not None
    with pytest.raises(LLMError) as caught:
        client.chat(MESSAGES)
    text = str(caught.value)
    assert "groq:llama-3.3-70b-versatile" in text and "openrouter:openai/gpt-oss-120b:free" in text
    assert GROQ_KEY not in text and ROUTER_KEY not in text


def test_one_provider_gives_a_plain_client_and_the_request_body_is_unchanged() -> None:
    body: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body.update(json.loads(request.content))
        return httpx.Response(200, json=OK)

    client = client_for(
        make_settings(llm_tier_light_primary="groq:small", groq_api_key=GROQ_KEY),
        "light",
        httpx.MockTransport(handler),
    )
    assert isinstance(client, OpenAICompatibleClient)
    client.chat(MESSAGES)
    assert body["model"] == "small"
