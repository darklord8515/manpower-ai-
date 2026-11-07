"""`make eval-chat`: ask the Virtual HR the golden questions and check how it understood them.

Each case in agents/evals/chat.yaml is one question, asked as a seeded user, answered through the
same pipeline as the chat screen (`answer_message`) with the configured light model. It checks the
things a model could get wrong and Python must catch: the intent it chose, that restricted
questions never reach it, that a wrong word is asked about and not guessed, that the answer's
numbers are the ones the screens show, and that nothing is written. A check this runner does not
know fails the case. Needs the light tier and the demo data (`make seed`); changes nothing.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any, cast

import yaml
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.ai.assistant.supervisor import answer_message
from app.ai.evals import EMAILS, Recorder, Result, report
from app.ai.llm import LLMClient, client_for
from app.ai.runtime import open_run
from app.auth.deps import load_user
from app.clock import SimulatedClock
from app.config import REPO_ROOT, ConfigError, Settings, get_settings
from app.seed.load import SEED_TODAY, require_not_production

CASES = REPO_ROOT / "apps" / "api" / "agents" / "evals" / "chat.yaml"
KNOWN_KEYS = frozenset({"id", "title", "user", "ask", "history", "expect", "note", "phase"})
KNOWN_CHECKS = frozenset(
    {
        "intent",
        "kind",
        "status",
        "agent",
        "no_model_call",
        "blocks_include",
        "blocks_exclude",
        "why_mentions",
        "summary_mentions",
        "summary_excludes",
        "tool_called",
        "tool_not_called",
        "no_fields_in_output",
        "db_unchanged",
    }
)
WATCHED = ("staffing_requests", "employee_assignments", "alerts", "employees", "mobilizations")


def load_cases(path: Any = CASES) -> list[dict[str, Any]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return list(cast("dict[str, Any]", data)["cases"])


def problems_in(case: dict[str, Any]) -> list[str]:
    found = [f"unknown key '{k}'" for k in case if k not in KNOWN_KEYS]
    found += [f"missing '{k}'" for k in ("id", "title", "user", "ask", "expect") if k not in case]
    if case.get("user") not in EMAILS:
        found.append(f"unknown user '{case.get('user')}'")
    expect = cast("dict[str, Any]", case.get("expect") or {})
    found += [f"unsupported check '{c}'" for c in expect if c not in KNOWN_CHECKS]
    if "kind" not in expect:
        found.append("expect.kind is required")
    return found


def _count(session: Session, table: str) -> int:
    return int(session.execute(text(f"SELECT count(*) FROM {table}")).scalar_one())  # noqa: S608


def _evaluate(
    case: dict[str, Any], out: Any, called: list[tuple[str, bool]], sent: list[Any],
    before: dict[str, int], session: Session,
) -> list[str]:  # fmt: skip
    expect = cast("dict[str, Any]", case["expect"])
    answer = out.answer
    wrong: list[str] = []
    names = [n for n, ok in called if ok]
    summary = answer.summary.lower()
    for check, value in expect.items():
        match check:
            case "kind":
                allowed_kinds: list[Any] = (
                    cast("list[Any]", value) if isinstance(value, list) else [value]
                )
                if answer.kind not in allowed_kinds:
                    wrong.append(f"answer was {answer.kind}, expected {value}")
            case "status":
                if out.status != value:
                    wrong.append(f"run was {out.status}, expected {value}")
            case "intent":
                if out.intent != value:
                    wrong.append(f"understood as {out.intent}, expected {value}")
            case "agent":
                if answer.agent != value:
                    wrong.append(f"answered by {answer.agent}, expected {value}")
            case "no_model_call":
                if value and sent:
                    wrong.append(f"the model was asked {len(sent)} time(s)")
            case "blocks_include":
                have = [b.type for b in answer.blocks]
                wrong += [f"no {t} block" for t in value if t not in have]
            case "blocks_exclude":
                have = [b.type for b in answer.blocks]
                wrong += [f"a {t} block was drawn" for t in value if t in have]
            case "why_mentions":
                why = (answer.why or "").lower()
                wrong += [f"the why line lacks '{t}'" for t in value if str(t).lower() not in why]
            case "summary_mentions":
                wrong += [f"summary lacks '{t}'" for t in value if str(t).lower() not in summary]
            case "summary_excludes":
                wrong += [f"summary has '{t}'" for t in value if str(t).lower() in summary]
            case "tool_called":
                if value not in names:
                    wrong.append(f"did not call {value}")
            case "tool_not_called":
                if value in names:
                    wrong.append(f"called {value}, which it must not")
            case "no_fields_in_output":
                seen = (answer.model_dump_json() + json.dumps(sent, default=str)).lower()
                wrong += [
                    f"'{t}' reached the answer or the model"
                    for t in value
                    if str(t).lower() in seen
                ]
            case "db_unchanged":
                wrong += [f"{t} changed" for t in value if _count(session, t) != before[t]]
            case _:
                wrong.append(f"unsupported check '{check}'")
    return wrong


def run_case(
    factory: sessionmaker[Session], settings: Settings, model: LLMClient, case: dict[str, Any]
) -> Result:
    result = Result(str(case.get("id", "?")), str(case.get("title", "")))
    if case.get("phase") == "post_mvp":
        result.skipped = str(case.get("note") or "not part of the MVP")
        return result
    found = problems_in(case)
    if found:
        result.failures = [f"the case itself: {p}" for p in found]
        return result
    recorder = Recorder(model)
    started = time.monotonic()
    with factory() as session:
        user = load_user(
            session,
            session.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": EMAILS[case["user"]]}
            ).scalar_one(),
        )
        assert user is not None
        before = {t: _count(session, t) for t in WATCHED}
        run_id = open_run(
            session, agent_code="supervisor", user_id=user.id, user_input=str(case["ask"]),
            intent="chat", model=model.model,
        )  # fmt: skip
        session.commit()
        out = answer_message(
            session, settings, SimulatedClock(SEED_TODAY), user, run_id, str(case["ask"]),
            list(case.get("history") or []), recorder,
        )  # fmt: skip
        calls = session.execute(
            text("SELECT tool_name, allowed FROM agent_tool_calls WHERE run_id = :id ORDER BY id"),
            {"id": run_id},
        ).all()
        result.tokens_in, result.tokens_out = out.input_tokens, out.output_tokens
        result.failures = _evaluate(
            case, out, [(c.tool_name, c.allowed) for c in calls], recorder.sent, before, session
        )
    result.seconds = time.monotonic() - started
    return result


def main(argv: list[str]) -> int:
    settings = get_settings()
    try:
        require_not_production(settings)
    except ConfigError as error:
        print(f"Refused: {error}")  # noqa: T201
        return 1
    model = client_for(settings, "light")
    if model is None:
        print(  # noqa: T201
            "The light tier is off. Put your keys and LLM_TIER_LIGHT_PRIMARY in .env "
            "(run `make ai-check` to choose), then `make seed` and `make eval-chat`."
        )
        return 2
    only = argv[1] if len(argv) > 1 else None
    cases = [c for c in load_cases() if only in (None, c.get("id"))]
    factory = sessionmaker(bind=create_engine(settings.migration_url), expire_on_commit=False)
    print(f"Model {model.model} · {len(cases)} chat cases · demo date {SEED_TODAY:%d %b %Y}\n")  # noqa: T201
    results = [run_case(factory, settings, model, case) for case in cases]
    return 0 if report(results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
