"""Tools an agent may call, and the loop that lets a model call them.

A tool is a Pydantic input model, the permission its caller needs, and a function over the service
layer. The loop gives a model the tools it is allowed, runs the ones it asks for, and stops when the
finishing tool has run. Rules it enforces (docs/rules.md, AI_*; docs/agents.md, shared contract):

- a tool the agent is not allowed (`agents.allowed_tools`) does not exist for it;
- the caller's permission is checked before the tool runs, and a refusal is logged with
  `allowed = false` and ends the run as `refused`: the agent does not try another way in;
- every call is logged to `agent_tool_calls` as it happens, with counts but no personal data, so a
  screen can show the steps while the run is still going;
- at most `max_rounds` rounds and the agent's token budget, then the run ends `failed`.

Tools only read. The one thing an agent produces is a recommendation that a person applies.
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.llm import LLMClient, LLMError, Message, ToolSpec
from app.ai.redact import RedactionError, check_messages
from app.auth.deps import AuthUser
from app.config import Settings

MAX_ROUNDS = 6
RESULT_CHARS = 12_000  # what one tool result may weigh in the conversation


class ToolFailure(Exception):
    """A tool's own "no": wrong input, or a rule says so. The model reads it and may adapt."""


@dataclass
class ToolContext:
    session: Session
    settings: Settings
    user: AuthUser
    today: date
    scratch: dict[str, Any] = field(default_factory=dict[str, Any])  # shared within one run


@dataclass(frozen=True)
class ToolOutput:
    result: dict[str, Any]  # what the model reads
    summary: dict[str, Any]  # counts for the log and the visible step: no personal data
    finished: bool = False  # this tool produced the final answer


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    permission: str
    inputs: type[BaseModel]
    run: Callable[[ToolContext, Any], ToolOutput]

    def spec(self) -> ToolSpec:
        schema = self.inputs.model_json_schema()
        schema.pop("title", None)
        return ToolSpec(self.name, self.description, schema)


@dataclass(frozen=True)
class AgentResult:
    status: str  # succeeded | failed | refused
    error: str | None
    output: dict[str, Any] | None
    input_tokens: int
    output_tokens: int


def log_tool_call(
    session: Session,
    run_id: uuid.UUID,
    tool: str,
    permission: str,
    allowed: bool,
    args: dict[str, Any],
    summary: dict[str, Any],
    started: float,
) -> None:
    session.execute(
        text(
            """INSERT INTO agent_tool_calls
                   (run_id, tool_name, required_permission, allowed, args_json, result_summary,
                    duration_ms)
               VALUES (:run, :tool, :perm, :allowed, CAST(:args AS jsonb), CAST(:summary AS jsonb),
                       :ms)"""
        ),
        {
            "run": run_id, "tool": tool, "perm": permission, "allowed": allowed,
            "args": json.dumps(args, default=str), "summary": json.dumps(summary, default=str),
            "ms": int((time.monotonic() - started) * 1000),
        },
    )  # fmt: skip
    session.commit()  # a screen watching the run sees this step at once


def _read(result: dict[str, Any]) -> str:
    blob = json.dumps(result, default=str)
    return blob if len(blob) <= RESULT_CHARS else blob[:RESULT_CHARS] + '..."truncated"'


def run_agent(
    session: Session,
    ctx: ToolContext,
    client: LLMClient,
    run_id: uuid.UUID,
    *,
    system: str,
    task: str,
    tools: Sequence[Tool],
    allowed: Sequence[str],
    finish: str,
    token_budget: int,
    max_rounds: int = MAX_ROUNDS,
) -> AgentResult:
    """Let the model work with its tools until `finish` has run; a model problem never raises."""
    by_name = {t.name: t for t in tools if t.name in allowed}
    specs = [t.spec() for t in by_name.values()]
    messages: list[Message] = [
        {"role": "system", "content": system},
        {"role": "user", "content": task},
    ]
    tokens_in = tokens_out = 0

    def end(
        status: str, error: str | None = None, output: dict[str, Any] | None = None
    ) -> AgentResult:
        return AgentResult(status, error, output, tokens_in, tokens_out)

    nudged = False
    for _round in range(max_rounds):
        try:
            check_messages(messages)
            reply = client.chat(messages, tools=specs, max_tokens=1200)
        except RedactionError as error:
            return end("refused", f"LLM_REDACT: {error}")
        except LLMError as error:
            return end("failed", f"provider: {error}")
        tokens_in += reply.input_tokens
        tokens_out += reply.output_tokens
        if tokens_in + tokens_out > token_budget:
            return end("failed", f"budget: the run used more than {token_budget} tokens")

        if not reply.tool_calls:
            if nudged:
                return end("failed", f"unfinished: the model never called {finish}")
            nudged = True
            messages += [
                {"role": "assistant", "content": reply.content},
                {"role": "user", "content": f"Use your tools. Finish by calling {finish}."},
            ]
            continue

        messages.append(
            {"role": "assistant", "content": reply.content, "tool_calls": list(reply.tool_calls)}
        )
        for call in reply.tool_calls:
            started = time.monotonic()
            tool = by_name.get(call.name)
            if tool is None:
                log_tool_call(session, run_id, call.name, "none", False, call.arguments,
                              {"error": "not an allowed tool"}, started)  # fmt: skip
                result: dict[str, Any] = {"error": f"There is no tool called {call.name}."}
                messages.append({"role": "tool", "tool_call_id": call.id, "content": _read(result)})
                continue
            if not ctx.user.can(tool.permission):
                log_tool_call(session, run_id, tool.name, tool.permission, False, call.arguments,
                              {"error": "permission"}, started)  # fmt: skip
                return end(
                    "refused",
                    f"permission: {tool.name} needs {tool.permission}, which you do not have",
                )
            try:
                args = tool.inputs.model_validate(call.arguments)
            except ValidationError as error:
                problem = " ".join(str(error).split())[:300]
                log_tool_call(session, run_id, tool.name, tool.permission, True, call.arguments,
                              {"error": "invalid arguments"}, started)  # fmt: skip
                result = {"error": f"Invalid arguments: {problem}"}
                messages.append({"role": "tool", "tool_call_id": call.id, "content": _read(result)})
                continue
            try:
                out = tool.run(ctx, args)
            except ToolFailure as failure:
                log_tool_call(session, run_id, tool.name, tool.permission, True, call.arguments,
                              {"error": str(failure)}, started)  # fmt: skip
                result = {"error": str(failure)}
                messages.append({"role": "tool", "tool_call_id": call.id, "content": _read(result)})
                continue
            log_tool_call(session, run_id, tool.name, tool.permission, True,
                          args.model_dump(mode="json"), out.summary, started)  # fmt: skip
            messages.append({"role": "tool", "tool_call_id": call.id, "content": _read(out.result)})
            if out.finished:
                return end("succeeded", None, ctx.scratch.get("final"))
    return end("failed", f"rounds: the model did not finish in {max_rounds} rounds")
