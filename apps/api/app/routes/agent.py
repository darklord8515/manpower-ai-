"""Asking the Workforce agent, and watching it work.

A run is started and answered at once with its id; the agent works in the background and the screen
polls `GET /agent/runs/{id}` to show its steps as they happen. Only the person who asked can read a
run. The agent only reads: its recommendation is applied by a person, through the Allocation
Board's own route.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, cast

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.ai.deps import mid_client
from app.ai.llm import LLMClient
from app.ai.runtime import open_run
from app.ai.workforce import (
    AGENT,
    EXPLAIN,
    RECOMMEND,
    STALE_AFTER_SECONDS,
    execute_run,
    steps_of,
)
from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session, get_session_factory
from app.schemas import (
    AgentDropped,
    AgentRecommendation,
    AgentRunBody,
    AgentRunStarted,
    AgentRunView,
    AgentSelection,
    AgentStep,
    AiStatus,
    RecommendRun,
)
from app.services import allocation
from app.services.allocation import AllocationError
from app.services.forecast import project_is_visible

router = APIRouter(tags=["ai"])

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Asker = Annotated[AuthUser, Depends(require("ai:use"))]

NEEDS = {RECOMMEND: "staffing:create", EXPLAIN: "forecast:read"}


def friendly_error(error: str | None) -> str | None:
    """What a person should read when a run did not work. The raw reason stays in `agent_runs`."""
    if not error:
        return None
    kind = error.split(":", 1)[0]
    return {
        "LLM_REDACT": "The request was stopped: it would have sent restricted data to the model.",
        "provider": "The AI service could not be reached. Try again in a moment.",
        "permission": "You do not have permission for something the agent needed to do.",
        "budget": "The AI model did not give a usable answer. Try again.",
        "rounds": "The AI model did not give a usable answer. Try again.",
        "unfinished": "The AI model did not give a usable answer. Try again.",
        "invalid": "The AI model did not give a usable answer. Try again.",
        "rejected": "The AI’s wording did not match the numbers, so it was not used.",
        "internal": "Something went wrong on the server. Try again.",
    }.get(kind, error)


@router.get("/ai/status")
def ai_status(settings: SettingsDep, user: Asker) -> AiStatus:
    return AiStatus(
        light=settings.llm_tier("light") is not None, mid=settings.llm_tier("mid") is not None
    )


@router.post("/agent/runs", status_code=status.HTTP_202_ACCEPTED)
def start_run(
    body: AgentRunBody,
    request: Request,
    background: BackgroundTasks,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    factory: Annotated[sessionmaker[Session], Depends(get_session_factory)],
    client: Annotated[LLMClient | None, Depends(mid_client)],
    user: Asker,
) -> AgentRunStarted:
    """Start a run. It answers at once; the work happens after, and `GET` shows the steps."""
    if not user.can(NEEDS[body.kind]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this")
    if client is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The AI model is not set up on this server."
        )
    params: dict[str, Any]
    if isinstance(body, RecommendRun):
        lines = allocation.fetch_lines(session, body.request_no)
        line = next((x for x in lines if x.line_id == body.line_id), None)
        if line is None or not allocation.visible(user, line.project_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Request line not found")
        try:
            allocation.require_open(line)
        except AllocationError as error:
            raise HTTPException(error.status, error.message) from error
        params = {"request_no": body.request_no, "line_id": str(body.line_id)}
        target = f"{body.request_no}:{body.line_id}"
    else:
        project = session.execute(
            text("SELECT id FROM projects WHERE code = :c"), {"c": body.project}
        ).first()
        if project is None or not project_is_visible(user, project.id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
        params = {"project": body.project, "start": body.start.isoformat() if body.start else None}
        target = f"{body.project}:{params['start'] or ''}"

    running = session.execute(
        text(
            """SELECT r.id FROM agent_runs r JOIN agents a ON a.id = r.agent_id
               WHERE a.code = :agent AND r.user_id = :user AND r.intent = :kind
                 AND r.user_input = :target AND r.status = 'running'
                 AND r.started_at > now() - interval '3 minutes'
               ORDER BY r.started_at DESC LIMIT 1"""
        ),
        {"agent": AGENT, "user": user.id, "kind": body.kind, "target": target},
    ).first()
    if running is not None:  # a double click asks once
        return AgentRunStarted(id=running.id)

    run_id = open_run(
        session, agent_code=AGENT, user_id=user.id, user_input=target, intent=body.kind,
        model=client.model,
    )  # fmt: skip
    write_audit(
        session,
        request,
        "agent.run_started",
        "agent_run",
        user,
        entity_id=run_id,
        after={"kind": body.kind, "target": target},
    )  # also commits the run
    background.add_task(
        execute_run, factory, client, run_id, user.id, body.kind, params, settings, clock.today()
    )
    return AgentRunStarted(id=run_id)


@router.get("/agent/runs/{run_id}")
def get_run(
    run_id: uuid.UUID, session: SessionDep, settings: SettingsDep, user: Asker
) -> AgentRunView:
    row = (
        session.execute(
            text(
                """SELECT r.id, r.status::text AS status, r.intent, r.output_json, r.error,
                          r.model, r.started_at, r.finished_at, a.model_policy ->> 'tier' AS tier
                   FROM agent_runs r JOIN agents a ON a.id = r.agent_id
                   WHERE r.id = :id AND r.user_id = :user AND a.code = :agent"""
            ),
            {"id": run_id, "user": user.id, "agent": AGENT},
        )
        .mappings()
        .first()
    )
    if row is None:  # also when it belongs to someone else
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    state, error = row["status"], row["error"]
    if (
        state == "running"
        and (datetime.now(UTC) - row["started_at"]).total_seconds() > STALE_AFTER_SECONDS
    ):
        state, error = "failed", "internal: the run did not finish"
    output = cast("dict[str, Any]", row["output_json"] or {})
    explained = row["intent"] == EXPLAIN and state == "succeeded"
    recommendation = None
    if row["intent"] == RECOMMEND and state == "succeeded" and output:
        recommendation = AgentRecommendation(
            trade=output["trade"], open_places=output["open_places"], shortfall=output["shortfall"],
            note=output.get("note"),
            selections=[AgentSelection(**s) for s in output["selections"]],
            rejected=[AgentDropped(**d) for d in output["rejected"]],
        )  # fmt: skip
    return AgentRunView(
        id=row["id"], kind=row["intent"], status=state,
        steps=[AgentStep(**s) for s in steps_of(session, run_id)],
        recommendation=recommendation,
        answer=str(output["summary"]) if explained else None,
        error=friendly_error(error), model=row["model"], tier=row["tier"] or "mid",
        started_at=row["started_at"], finished_at=row["finished_at"],
    )  # fmt: skip
