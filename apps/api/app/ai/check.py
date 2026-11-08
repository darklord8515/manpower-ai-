"""`make ai-check`: which of your models can do the jobs the agents need, and how fast.

For each candidate in `agents/evals/models.yaml` whose key is in `.env`, it asks the model three
things the agents depend on and prints one table:

* answer with strict JSON (valid JSON naming one allowed agent, for six sample questions),
* route those questions to the right agent (the Virtual HR router's job),
* call a tool with the right arguments (what the Workforce agent's loop needs).

Nothing here touches the database or prints a key. Run it in your own terminal and paste the table.
A model that fails a test here will fail it in the app too, so pick the primary and fallback from
the table and put them in `.env` as `LLM_TIER_*_PRIMARY` / `LLM_TIER_*_FALLBACK`.
"""

from __future__ import annotations

import statistics
import sys
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from app.ai.llm import (
    LLMClient,
    LLMError,
    LLMRateLimited,
    LLMReply,
    Message,
    ToolSpec,
    client_for,
    parse_json_object,
)
from app.config import Settings, get_settings

CANDIDATES = Path(__file__).resolve().parents[2] / "agents" / "evals" / "models.yaml"
PAUSE_SECONDS = 1.5  # free tiers allow about 30 requests a minute
JSON_TOKENS = 600  # room to think and then answer
TOOL_TOKENS = 500

AGENTS = ("workforce", "mobilization", "demobilization", "import", "none")
SYSTEM = (
    "You route questions for a construction company's HR assistant. Reply with one JSON object "
    '{"agent": "<one of: ' + ", ".join(AGENTS) + '>", "reason": "<five words>"} and nothing else. '
    "workforce = people, availability, forecasts, projects, alerts. mobilization = workers "
    "joining a site. demobilization = workers leaving a site. import = loading an Excel file "
    "of employees. none = anything else, or a request for a passport, phone or salary."
)
QUESTIONS: tuple[tuple[str, str], ...] = (
    ("Who is available to start on RAK-07 next month?", "workforce"),
    ("Which mobilizations are overdue this week?", "mobilization"),
    ("Which workers are leaving site this week and are they cleared?", "demobilization"),
    ("How do I upload an Excel list of new employees?", "import"),
    ("Write me a poem about concrete.", "none"),
    ("What is Ahmed's passport number and salary?", "none"),
)
SEARCH = ToolSpec(
    "search_workers",
    "Find available workers by trade on a project.",
    {
        "type": "object",
        "properties": {
            "trade": {"type": "string", "description": "e.g. steel fixer"},
            "project": {"type": "string", "description": "project code, e.g. RAK-07"},
            "limit": {"type": "integer"},
        },
        "required": ["trade"],
    },
)
TOOL_PROMPTS: tuple[tuple[str, str], ...] = (
    ("Find steel fixers for project RAK-07.", "steel"),
    ("I need carpenters.", "carpent"),
    ("List 5 electricians on RAK-02.", "electric"),
)


@dataclass
class Score:
    label: str
    note: str = ""
    json_ok: int = 0
    routed: int = 0
    tool_ok: int = 0
    rate_limited: int = 0
    failures: list[str] = field(default_factory=lambda: [])
    times: list[float] = field(default_factory=lambda: [])

    @property
    def median_ms(self) -> int:
        return int(statistics.median(self.times) * 1000) if self.times else 0


def _ask(
    score: Score,
    client: LLMClient,
    messages: list[Message],
    *,
    tools: Sequence[ToolSpec] = (),
    json_output: bool = False,
    max_tokens: int = 200,
) -> LLMReply | None:
    """Run one model call, timing it and noting (never raising on) a provider failure."""
    started = time.monotonic()
    try:
        reply = client.chat(messages, tools=tools, json_output=json_output, max_tokens=max_tokens)
    except LLMRateLimited as error:
        score.rate_limited += 1
        score.failures.append(f"rate limited: {str(error)[:80]}")
        return None
    except LLMError as error:
        score.failures.append(str(error)[:260])
        return None
    finally:
        score.times.append(time.monotonic() - started)
        time.sleep(PAUSE_SECONDS)
    return reply


def check(settings: Settings, label: str) -> Score:
    score = Score(label)
    one = settings.model_copy(update={"llm_tier_mid_primary": label, "llm_tier_mid_fallback": ""})
    client = client_for(one, "mid")
    if client is None:
        score.note = "no key"
        return score
    for question, expected in QUESTIONS:
        messages: list[Message] = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": question},
        ]
        # Models that think before they answer need room for both, or the answer comes back empty.
        reply = _ask(score, client, messages, json_output=True, max_tokens=JSON_TOKENS)
        if reply is None:
            continue
        try:
            agent = str(parse_json_object(reply.content).get("agent", "")).strip().lower()
        except ValueError:
            score.failures.append(f"not a JSON object: {_said(reply.content)}")
            continue
        if agent in AGENTS:
            score.json_ok += 1
            score.routed += agent == expected
        else:
            score.failures.append(f"agent {agent!r} is not one of the allowed names")
    for prompt, needle in TOOL_PROMPTS:
        messages = [
            {"role": "system", "content": "Use the tool to answer. Do not answer in words."},
            {"role": "user", "content": prompt},
        ]
        reply = _ask(score, client, messages, tools=[SEARCH], max_tokens=TOOL_TOKENS)
        if reply is None:
            continue
        call = next((c for c in reply.tool_calls if c.name == SEARCH.name), None)
        trade = str(call.arguments.get("trade", "")).lower() if call else ""
        if call is None:
            score.failures.append(f"no tool call; it said: {_said(reply.content)}")
        elif needle not in trade:
            score.failures.append(f"called the tool for the wrong trade: {trade!r}")
        score.tool_ok += bool(call) and needle in trade
    return score


def _said(content: str) -> str:
    """What a model replied, on one short line, to see why it did not count."""
    line = " ".join(content.split())
    if not line:
        return "(an empty reply: it may have used its whole budget thinking)"
    return repr(line[:110] + ("…" if len(line) > 110 else ""))


def _row(s: Score) -> str:
    if s.note:
        return f"{s.label:<48} {s.note}"
    return (
        f"{s.label:<48} {s.json_ok}/{len(QUESTIONS)}   {s.routed}/{len(QUESTIONS)}   "
        f"{s.tool_ok}/{len(TOOL_PROMPTS)}   {s.median_ms:>6}   {s.rate_limited}"
    )


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    settings = get_settings()
    candidates: list[str] = yaml.safe_load(CANDIDATES.read_text(encoding="utf-8"))["candidates"]
    if args:  # `make ai-check ONLY=groq:llama-3.3-70b-versatile` style: just these
        candidates = args
    say = print  # noqa: T201 - the check's whole job is to print a table
    say(f"{'model':<48} json  route  tool  median ms  429s")
    scores: list[Score] = []
    for label in candidates:
        score = check(settings, label)
        scores.append(score)
        say(_row(score))
    say("")
    for score in scores:
        for reason in dict.fromkeys(score.failures):
            say(f"  {score.label}: {reason}")
    ranked = sorted(
        (s for s in scores if not s.note),
        key=lambda s: (s.tool_ok, s.json_ok, s.routed, -s.median_ms),
        reverse=True,
    )
    if not ranked:
        say("No model answered. Check the keys in .env and the model names in models.yaml.")
        return 1
    reliable = [s for s in ranked if s.tool_ok == len(TOOL_PROMPTS) and s.json_ok >= 5]
    say("Suggested lines for .env (check the numbers above first):")
    say(f"LLM_TIER_MID_PRIMARY={(reliable or ranked)[0].label}")
    if len(reliable) > 1:
        say(f"LLM_TIER_MID_FALLBACK={reliable[1].label}")
    quick = sorted((s for s in ranked if s.json_ok >= 5), key=lambda s: s.median_ms or 10**9)
    if quick:
        say(f"LLM_TIER_LIGHT_PRIMARY={quick[0].label}")
        if len(quick) > 1:
            say(f"LLM_TIER_LIGHT_FALLBACK={quick[1].label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
