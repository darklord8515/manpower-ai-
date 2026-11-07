"""`make eval`: run the golden cases against the configured model and the seeded demo.

Each case signs in as a seeded user, starts the Workforce agent through the same code the API uses,
and checks what happened: the outcome, the tools it called, and the checks listed in the case
(docs: the header of agents/evals/golden.yaml). A check this runner does not know fails the case
instead of passing it silently. Cases marked `phase: post_mvp` are skipped and reported.

It needs a model (the `mid` tier) and the demo data (`make seed`), and it changes nothing that
lasts: a case that edits the data puts it back.
"""

from __future__ import annotations

import json
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import yaml
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.ai.faithful import allowed_tokens, unfaithful
from app.ai.llm import LLMClient, LLMReply, Message, ToolSpec, client_for
from app.ai.runtime import open_run
from app.ai.workforce import EXPLAIN, RECOMMEND, execute_run, forecast_digest
from app.auth.deps import AuthUser, load_user
from app.config import REPO_ROOT, ConfigError, Settings, get_settings
from app.seed.load import SEED_TODAY, require_not_production
from app.services import allocation
from app.services.forecast import forecast_project

GOLDEN = REPO_ROOT / "apps" / "api" / "agents" / "evals" / "golden.yaml"
EMAILS = {
    "hr_mgr": "noura.demo@constructiq.test",
    "hr_exec": "priya.demo@constructiq.test",
    "ceo": "layla.demo@constructiq.test",
}
OUTCOMES = {"succeeded", "refused", "failed"}
KNOWN_CHECKS = frozenset(
    {
        "proposed_count",
        "proposed_at_most",
        "every_item_has_reason",
        "every_proposed_passes_rules",
        "excluded_rule_count",
        "refused_permission",
        "refused_reason",
        "no_fields_in_output",
        "mentions",
        "forecast_matches_service",
        "db_unchanged",
        "max_tool_rounds",
        "tool_call_refused",
    }
)
KNOWN_KEYS = frozenset(
    {
        "id",
        "title",
        "user",
        "kind",
        "request",
        "trade",
        "project",
        "setup",
        "expect",
        "note",
        "phase",
    }
)


class Recorder:
    """Wraps a model client and remembers every message sent to it and every call made."""

    def __init__(self, inner: LLMClient) -> None:
        self.model = inner.model
        self._inner = inner
        self.sent: list[list[Message]] = []

    def chat(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] = (),
        json_output: bool = False,
        max_tokens: int = 1024,
    ) -> LLMReply:
        self.sent.append(list(messages))
        return self._inner.chat(
            messages, tools=tools, json_output=json_output, max_tokens=max_tokens
        )


@dataclass
class Result:
    id: str
    title: str
    failures: list[str] = field(default_factory=list[str])
    skipped: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    seconds: float = 0.0

    @property
    def passed(self) -> bool:
        return self.skipped is None and not self.failures


def load_cases(path: Path = GOLDEN) -> list[dict[str, Any]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return list(cast("dict[str, Any]", data)["cases"])


def problems_in(case: dict[str, Any]) -> list[str]:
    """What is wrong with a case itself (so a typo cannot make it pass)."""
    found: list[str] = []
    for key in case:
        if key not in KNOWN_KEYS:
            found.append(f"unknown key '{key}'")
    for key in ("id", "title", "user", "kind", "expect"):
        if key not in case:
            found.append(f"missing '{key}'")
    if case.get("user") not in EMAILS:
        found.append(f"unknown user '{case.get('user')}'")
    if case.get("kind") not in (RECOMMEND, EXPLAIN):
        found.append(f"unknown kind '{case.get('kind')}'")
    expect = cast("dict[str, Any]", case.get("expect") or {})
    if expect.get("outcome") not in OUTCOMES:
        found.append(f"expect.outcome must be one of {sorted(OUTCOMES)}")
    for check in cast("dict[str, Any]", expect.get("checks") or {}):
        if check not in KNOWN_CHECKS:
            found.append(f"unsupported check '{check}'")
    return found


def _count(session: Session, table: str) -> int:
    return int(session.execute(text(f"SELECT count(*) FROM {table}")).scalar_one())  # noqa: S608


def _text_of(run: dict[str, Any]) -> str:
    out = cast("dict[str, Any]", run["output"] or {})
    if run["kind"] == EXPLAIN:
        return str(out.get("summary", ""))
    parts = [str(out.get("note") or "")]
    parts += [str(s.get("reason", "")) for s in out.get("selections", [])]
    return " ".join(parts)


def _evaluate(
    session: Session, settings: Settings, user: AuthUser, case: dict[str, Any],
    run: dict[str, Any], called: list[tuple[str, bool]], sent: list[list[Message]],
    before: dict[str, int],
) -> list[str]:  # fmt: skip
    expect = cast("dict[str, Any]", case["expect"])
    checks = cast("dict[str, Any]", expect.get("checks") or {})
    out = cast("dict[str, Any]", run["output"] or {})
    selections = cast("list[dict[str, Any]]", out.get("selections", []))
    rejected = cast("list[dict[str, Any]]", out.get("rejected", []))
    names = [n for n, ok in called if ok]
    wrong: list[str] = []

    if run["status"] != expect["outcome"]:
        wrong.append(f"outcome was {run['status']} ({run['error']}), expected {expect['outcome']}")
    for tool in expect.get("tools_called", []):
        if tool not in names:
            wrong.append(f"did not call {tool}")
    for tool in expect.get("tools_not_called", []):
        if tool in names:
            wrong.append(f"called {tool}, which it must not")

    for check, value in checks.items():
        match check:
            case "proposed_count":
                if len(selections) != value:
                    wrong.append(f"proposed {len(selections)} people, expected {value}")
            case "proposed_at_most":
                if len(selections) > value:
                    wrong.append(f"proposed {len(selections)} people, at most {value}")
            case "every_item_has_reason":
                bare = [s["code"] for s in selections if not str(s.get("reason", "")).strip()]
                bare += [d["code"] for d in rejected if not str(d.get("message", "")).strip()]
                if value and bare:
                    wrong.append(f"no reason for {', '.join(bare)}")
            case "every_proposed_passes_rules":
                line = _line(session, case)
                pool = allocation.build_pool(session, settings, line, SEED_TODAY)
                for s in selections:
                    v = allocation.verdict(pool, s["code"])
                    if v.violations or v.group not in ("free", "finishing", "reserved"):
                        wrong.append(f"{s['code']} was proposed but fails the rules")
            case "excluded_rule_count":
                for rule, n in cast("dict[str, int]", value).items():
                    got = sum(1 for d in rejected if d["rule"] == rule)
                    if got != n:
                        wrong.append(f"{got} dropped for {rule}, expected {n}")
            case "refused_permission":
                if value not in str(run["error"]):
                    wrong.append(f"the refusal did not name {value} ({run['error']})")
            case "refused_reason":
                if not str(run["error"]).startswith(str(value)):
                    wrong.append(f"refused for '{run['error']}', expected {value}")
            case "tool_call_refused":
                if (value, False) not in called:
                    wrong.append(f"{value} was not refused")
            case "no_fields_in_output":
                seen = (
                    json.dumps(run["output"], default=str) + json.dumps(sent, default=str)
                ).lower()
                wrong += [
                    f"'{term}' reached the output or the model"
                    for term in value
                    if term.lower() in seen
                ]
            case "mentions":
                words = _text_of(run).lower()
                wrong += [
                    f"does not mention '{term}'" for term in value if term.lower() not in words
                ]
            case "forecast_matches_service":
                forecast = forecast_project(
                    session, user, settings, str(case["project"]), SEED_TODAY
                )
                if forecast is None:
                    wrong.append("the forecast was not available to compare with")
                elif value:
                    bad = unfaithful(_text_of(run), allowed_tokens(forecast_digest(forecast)))
                    if bad:
                        wrong.append(
                            "the answer states " + ", ".join(bad) + " that the forecast does not"
                        )
            case "db_unchanged":
                for table in value:
                    if _count(session, table) != before[table]:
                        wrong.append(f"{table} changed")
            case "max_tool_rounds":
                if len(sent) > value:
                    wrong.append(f"used {len(sent)} rounds, at most {value}")
            case _:  # problems_in() catches this first; this keeps a new check from passing quietly
                wrong.append(f"unsupported check '{check}'")
    return wrong


def _line(session: Session, case: dict[str, Any]) -> allocation.Line:
    lines = allocation.fetch_lines(session, str(case["request"]))
    return next(x for x in lines if x.trade.lower() == str(case["trade"]).lower())


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
    expect = cast("dict[str, Any]", case["expect"])
    watched = cast(
        "list[str]", cast("dict[str, Any]", expect.get("checks") or {}).get("db_unchanged", [])
    )
    note = cast("dict[str, Any]", case.get("setup") or {}).get("request_note")
    started = time.monotonic()
    with factory() as session:
        user = load_user(
            session,
            session.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": EMAILS[case["user"]]}
            ).scalar_one(),
        )
        assert user is not None
        original: str | None = None
        if case["kind"] == RECOMMEND:
            line = _line(session, case)
            params: dict[str, Any] = {"request_no": line.request_no, "line_id": str(line.line_id)}
            target = f"{line.request_no}:{line.line_id}"
            if note is not None:
                original = line.source_text
                session.execute(
                    text("UPDATE staffing_requests SET source_text = :t WHERE request_no = :n"),
                    {"t": note, "n": line.request_no},
                )
        else:
            params = {"project": str(case["project"]), "start": None}
            target = f"{case['project']}:"
        session.commit()
        before = {table: _count(session, table) for table in watched}
        run_id = open_run(
            session, agent_code="workforce", user_id=user.id, user_input=target,
            intent=str(case["kind"]), model=model.model,
        )  # fmt: skip
        session.commit()
        try:
            execute_run(
                factory, recorder, run_id, user.id, str(case["kind"]), params, settings, SEED_TODAY
            )
            session.expire_all()
            row = session.execute(
                text(
                    """SELECT status::text AS status, error, output_json, input_tokens,
                              output_tokens FROM agent_runs WHERE id = :id"""
                ),
                {"id": run_id},
            ).mappings().one()  # fmt: skip
            calls = session.execute(
                text(
                    "SELECT tool_name, allowed FROM agent_tool_calls WHERE run_id = :id ORDER BY id"
                ),
                {"id": run_id},
            ).all()
            run = {"status": row["status"], "error": row["error"], "output": row["output_json"],
                   "kind": case["kind"]}  # fmt: skip
            result.tokens_in, result.tokens_out = (
                int(row["input_tokens"] or 0),
                int(row["output_tokens"] or 0),
            )
            result.failures = _evaluate(
                session, settings, user, case, run, [(c.tool_name, c.allowed) for c in calls],
                recorder.sent, before,
            )  # fmt: skip
        finally:
            if note is not None and case["kind"] == RECOMMEND:
                session.rollback()
                session.execute(
                    text("UPDATE staffing_requests SET source_text = :t WHERE request_no = :n"),
                    {"t": original, "n": params["request_no"]},
                )
                session.commit()
    result.seconds = time.monotonic() - started
    return result


def report(results: list[Result], out: Callable[[str], None] = print) -> bool:
    """Print one line per case and a summary. True when nothing failed."""
    for r in results:
        if r.skipped is not None:
            out(f"SKIP  {r.id:<8} {r.title}  [{r.skipped}]")
        elif r.passed:
            used = f"{r.tokens_in}+{r.tokens_out} tokens, {r.seconds:.1f} s"
            out(f"PASS  {r.id:<8} {r.title}  ({used})")
        else:
            out(f"FAIL  {r.id:<8} {r.title}")
            for problem in r.failures:
                out(f"        - {problem}")
    ran = [r for r in results if r.skipped is None]
    passed = [r for r in ran if r.passed]
    out("")
    out(
        f"{len(passed)} passed, {len(ran) - len(passed)} failed, "
        f"{len(results) - len(ran)} skipped"
        + (f" · pass rate {100 * len(passed) // len(ran)}%" if ran else "")
    )
    if ran:
        out(
            f"average {sum(r.tokens_in + r.tokens_out for r in ran) // len(ran)} tokens and "
            f"{sum(r.seconds for r in ran) / len(ran):.1f} s a case · cost not tracked "
            "(free-tier models report none)"
        )
    return len(passed) == len(ran)


def main(argv: list[str]) -> int:
    settings = get_settings()
    try:
        require_not_production(settings)
    except ConfigError as error:
        print(f"Refused: {error}")  # noqa: T201
        return 1
    model = client_for(settings, "mid")
    if model is None:
        print(  # noqa: T201
            "The mid tier is off. Set LLM_TIER_MID_MODEL and LLM_TIER_MID_BASE_URL "
            "(and LLM_TIER_MID_API_KEY) in .env, then run `make seed` and `make eval`."
        )
        return 2
    only = argv[1] if len(argv) > 1 else None
    cases = [c for c in load_cases() if only in (None, c.get("id"))]
    factory = sessionmaker(bind=create_engine(settings.migration_url), expire_on_commit=False)
    print(f"Model {model.model} · {len(cases)} cases · demo date {SEED_TODAY:%d %b %Y}\n")  # noqa: T201
    results = [run_case(factory, settings, model, case) for case in cases]
    return 0 if report(results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
