"""`make ai-check` scores a model fairly: a good one scores full marks, a broken one scores zero and
the check carries on rather than stopping."""

from __future__ import annotations

import json
from collections.abc import Sequence

import pytest

from app.ai import check
from app.ai.llm import LLMError, LLMRateLimited, LLMReply, Message, ToolCall
from app.config import Settings
from tests.support import ScriptedLLM, make_settings

TOOL_ARGS = {"Find steel": "steel fixer", "I need carp": "carpenter", "List 5 elec": "electrician"}


def good(messages: Sequence[Message]) -> str | LLMReply:
    asked = str(messages[-1]["content"])
    if "route questions" in str(messages[0]["content"]):
        expected = dict(check.QUESTIONS)[asked]
        return json.dumps({"agent": expected, "reason": "matches"})
    trade = next(v for k, v in TOOL_ARGS.items() if asked.startswith(k))
    return LLMReply("", (ToolCall("c1", "search_workers", {"trade": trade}),))


@pytest.fixture(autouse=True)
def fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(check, "PAUSE_SECONDS", 0)


def run(monkeypatch: pytest.MonkeyPatch, model: ScriptedLLM | None) -> check.Score:
    def pick(_settings: Settings, _tier: str) -> ScriptedLLM | None:
        return model

    monkeypatch.setattr(check, "client_for", pick)
    return check.check(make_settings(), "groq:fake")


def test_a_model_that_does_everything_right_scores_full_marks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    score = run(monkeypatch, ScriptedLLM(good))
    assert (score.json_ok, score.routed, score.tool_ok) == (6, 6, 3)
    assert score.failures == [] and score.rate_limited == 0


def test_wrong_routes_and_a_missing_tool_call_are_counted_not_hidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def poor(messages: Sequence[Message]) -> str | LLMReply:
        if "route questions" in str(messages[0]["content"]):
            return json.dumps({"agent": "workforce", "reason": "always"})  # right once in six
        return "I would look for steel fixers."  # words instead of a tool call

    score = run(monkeypatch, ScriptedLLM(poor))
    assert (score.json_ok, score.routed, score.tool_ok) == (6, 1, 0)


def test_replies_that_are_not_json_or_name_no_agent_do_not_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def odd(messages: Sequence[Message]) -> str | LLMReply:
        if "route questions" in str(messages[0]["content"]):
            return "not json" if "Excel" in str(messages[-1]["content"]) else '{"agent": "hr"}'
        return LLMReply("", (ToolCall("c1", "other_tool", {}),))

    score = run(monkeypatch, ScriptedLLM(odd))
    assert (score.json_ok, score.routed, score.tool_ok) == (0, 0, 0)
    # the table says why, with what the model actually said, so a bad column can be understood
    why = " ".join(score.failures)
    assert "not a JSON object: 'not json'" in why
    assert "agent 'hr' is not one of the allowed names" in why
    assert "no tool call; it said: (an empty reply" in why


def test_provider_failures_are_noted_and_rate_limits_counted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    replies: list[str | LLMReply | Exception] = [LLMRateLimited("429 slow", 5.0)] * 2
    replies += [LLMError("answered 401: bad key")] * 7
    score = run(monkeypatch, ScriptedLLM(replies))
    assert score.json_ok == score.tool_ok == 0
    assert score.rate_limited == 2
    assert any("401" in f for f in score.failures)
    assert len(score.times) == 9  # it tried every question, not just the first


def test_a_candidate_with_no_key_is_reported_and_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    score = run(monkeypatch, None)
    assert score.note == "no key"
    assert "no key" in check._row(score)  # pyright: ignore[reportPrivateUsage]


def test_the_candidate_list_is_valid_and_names_provider_and_model() -> None:
    import yaml

    listed: list[str] = yaml.safe_load(check.CANDIDATES.read_text(encoding="utf-8"))["candidates"]
    assert listed
    assert all(
        ":" in c
        and c.split(":", 1)[0] in {"groq", "openrouter", "huggingface", "ollama", "anthropic"}
        for c in listed
    )
