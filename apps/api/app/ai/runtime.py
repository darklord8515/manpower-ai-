"""Running a model call the way every agent must: logged, redacted, validated, retried once.

Every call is recorded in `agent_runs` (who asked, which model, tokens, how long, how it ended).
Output is parsed into a Pydantic model; on invalid output the model is told what was wrong and
asked once more, then the run ends as `failed`. No guessing, no third try (docs/agents.md).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.llm import LLMClient, Message, parse_json_object
from app.ai.redact import check_messages


class InvalidOutput(RuntimeError):
    """The model's reply did not fit the schema, even after one retry."""

    def __init__(self, message: str, input_tokens: int, output_tokens: int) -> None:
        super().__init__(message)
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


@dataclass(frozen=True)
class Structured[T: BaseModel]:
    value: T
    input_tokens: int
    output_tokens: int


def structured_call[T: BaseModel](
    client: LLMClient, messages: Sequence[Message], schema: type[T], *, max_tokens: int = 800
) -> Structured[T]:
    """One model call whose reply must fit `schema`.

    Raises RedactionError, LLMError or InvalidOutput (after one retry).
    """
    check_messages(messages)
    sent = list(messages)
    tokens_in = tokens_out = 0
    problem = ""
    for _attempt in range(2):
        reply = client.chat(sent, json_output=True, max_tokens=max_tokens)
        tokens_in += reply.input_tokens
        tokens_out += reply.output_tokens
        try:
            value = schema.model_validate(parse_json_object(reply.content))
        except ValueError as error:  # bad JSON and pydantic's ValidationError are both ValueErrors
            problem = " ".join(str(error).split())[:300]
            sent = [
                *messages,
                {"role": "assistant", "content": reply.content},
                {
                    "role": "user",
                    "content": f"That reply was not valid ({problem}). "
                    "Reply again with one JSON object that fits the format.",
                },
            ]
            continue
        return Structured(value, tokens_in, tokens_out)
    raise InvalidOutput(problem, tokens_in, tokens_out)


def open_run(
    session: Session,
    *,
    agent_code: str,
    user_id: uuid.UUID,
    user_input: str,
    intent: str,
    model: str,
) -> uuid.UUID:
    """Write the `running` row before the model is called, so a crash still leaves a trace."""
    return session.execute(
        text(
            """INSERT INTO agent_runs (agent_id, user_id, user_input, intent, status, model)
               SELECT a.id, :user, :input, :intent, 'running', :model
               FROM agents a WHERE a.code = :agent RETURNING id"""
        ),
        {
            "agent": agent_code,
            "user": user_id,
            "input": user_input,
            "intent": intent,
            "model": model,
        },
    ).scalar_one()


def close_run(
    session: Session,
    run_id: uuid.UUID,
    *,
    status: str,
    latency_ms: int,
    output: dict[str, Any] | None = None,
    error: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    client: object | None = None,
) -> None:
    """Finish the run: `succeeded`, `failed` (provider or output problem) or `refused` (a guard).

    When the client fell back to another provider, `agent_runs.model` is updated to the one that
    actually answered (`provider:model`)."""
    answered = getattr(client, "answered_by", None)
    session.execute(
        text(
            """UPDATE agent_runs SET status = CAST(:status AS run_status),
                      output_json = CAST(:output AS jsonb), error = :error,
                      input_tokens = :tin, output_tokens = :tout, latency_ms = :ms,
                      model = COALESCE(:model, model), finished_at = now()
               WHERE id = :id"""
        ),
        {
            "id": run_id, "status": status, "error": error, "tin": input_tokens,
            "tout": output_tokens, "ms": latency_ms,
            "output": json.dumps(output, default=str) if output is not None else None,
            "model": answered if isinstance(answered, str) else None,
        },
    )  # fmt: skip
