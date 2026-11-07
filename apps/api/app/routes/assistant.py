"""The Virtual HR chat: ask a question, watch it being answered, read the thread again.

A message is answered at once with a run id; the Supervisor works in the background and the screen
polls `GET /assistant/messages/{run_id}` to show its steps and then the answer. Conversations are
private: only the person who started one can read, continue or delete it. Everything the assistant
shows comes from tools that read as the caller, so it can never show more than the screens do.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from app.ai.assistant.intents import suggestions
from app.ai.assistant.supervisor import AGENT, STALE_AFTER_SECONDS, execute_message
from app.ai.deps import light_client
from app.ai.llm import LLMClient
from app.ai.redact import RedactionError, check_messages
from app.ai.runtime import open_run
from app.ai.workforce import steps_of
from app.audit import write_audit
from app.auth.deps import AuthUser, get_clock, require
from app.clock import Clock
from app.config import Settings, get_settings
from app.db import get_session, get_session_factory
from app.routes.agent import friendly_error
from app.schemas import (
    ChatAnswer,
    ChatBody,
    ChatMessage,
    ChatRunView,
    ChatStarted,
    ChatStep,
    ChatSuggestions,
    Conversation,
    ConversationView,
)

router = APIRouter(prefix="/assistant", tags=["assistant"])

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ClockDep = Annotated[Clock, Depends(get_clock)]
Asker = Annotated[AuthUser, Depends(require("ai:use"))]

MESSAGES_PER_WINDOW = 20  # one person, per ten minutes
BUSY_AT = 8  # answers being worked on across everyone
HIDDEN = "[not kept: this message had a number the assistant never stores]"


def _stored_text(message: str) -> str:
    """What is saved of a question: a phone or document number in it is never written down."""
    try:
        check_messages([{"role": "user", "content": message}])
    except RedactionError:
        return HIDDEN
    return message


def _answer_of(raw: Any) -> ChatAnswer | None:
    return ChatAnswer.model_validate(raw) if raw else None


@router.get("/suggestions")
def get_suggestions(settings: SettingsDep, user: Asker) -> ChatSuggestions:
    return ChatSuggestions(
        items=suggestions(user), ai_enabled=settings.llm_tier("light") is not None
    )


@router.post("/messages", status_code=status.HTTP_202_ACCEPTED)
def send_message(
    body: ChatBody,
    request: Request,
    background: BackgroundTasks,
    session: SessionDep,
    settings: SettingsDep,
    clock: ClockDep,
    factory: Annotated[sessionmaker[Session], Depends(get_session_factory)],
    client: Annotated[LLMClient | None, Depends(light_client)],
    user: Asker,
) -> ChatStarted:
    """Take a question. It answers at once with a run id; the answer arrives by polling."""
    message = " ".join(body.message.split())
    if not message:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ask a question first.")
    conversation_id = body.conversation_id
    if conversation_id is not None:
        owned = session.execute(
            text("SELECT 1 FROM conversations WHERE id = :c AND user_id = :u"),
            {"c": conversation_id, "u": user.id},
        ).first()
        if owned is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
        waiting = session.execute(
            text(
                """SELECT 1 FROM agent_runs WHERE session_id = :c AND status = 'running'
                     AND started_at > now() - make_interval(secs => :stale)"""
            ),
            {"c": conversation_id, "stale": STALE_AFTER_SECONDS},
        ).first()
        if waiting is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Wait for the answer before asking again."
            )
    recent = session.execute(
        text(
            """SELECT count(*) FILTER (WHERE r.user_id = :u
                          AND r.started_at > now() - interval '10 minutes') AS mine,
                      count(*) FILTER (WHERE r.status = 'running'
                          AND r.started_at > now() - make_interval(secs => :stale)) AS busy
               FROM agent_runs r JOIN agents a ON a.id = r.agent_id WHERE a.code = :agent"""
        ),
        {"u": user.id, "agent": AGENT, "stale": STALE_AFTER_SECONDS},
    ).one()
    if int(recent.mine) >= MESSAGES_PER_WINDOW:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "That is a lot of questions in a short time. Wait a few minutes and ask again.",
        )
    if int(recent.busy) >= BUSY_AT:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "The assistant is busy answering others. Try again in a moment.",
        )

    kept = _stored_text(message)
    if conversation_id is None:
        conversation_id = session.execute(
            text("INSERT INTO conversations (user_id, title) VALUES (:u, :t) RETURNING id"),
            {"u": user.id, "t": kept[:60] or "New chat"},
        ).scalar_one()
    message_id = session.execute(
        text(
            """INSERT INTO conversation_messages (conversation_id, role, content)
               VALUES (:c, 'user', :content) RETURNING id"""
        ),
        {"c": conversation_id, "content": kept},
    ).scalar_one()
    run_id = open_run(
        session,
        agent_code=AGENT,
        user_id=user.id,
        user_input=kept,
        intent="chat",
        model=client.model if client else "python",
        session_id=conversation_id,
    )
    session.execute(
        text("UPDATE conversation_messages SET run_id = :r WHERE id = :m"),
        {"r": run_id, "m": message_id},
    )
    write_audit(session, request, "assistant.asked", "agent_run", user, entity_id=run_id)
    background.add_task(
        execute_message,
        factory,
        client,
        run_id,
        user.id,
        conversation_id,
        message_id,
        message,
        settings,
        clock,
    )
    return ChatStarted(run_id=run_id, conversation_id=conversation_id)


@router.get("/messages/{run_id}")
def get_answer(run_id: uuid.UUID, session: SessionDep, user: Asker) -> ChatRunView:
    row = (
        session.execute(
            text(
                """SELECT r.id, r.session_id, r.status::text AS status, r.error, r.model,
                          r.started_at, r.finished_at
                   FROM agent_runs r JOIN agents a ON a.id = r.agent_id
                   WHERE r.id = :id AND r.user_id = :user AND a.code = :agent"""
            ),
            {"id": run_id, "user": user.id, "agent": AGENT},
        )
        .mappings()
        .first()
    )
    if row is None:  # also when it belongs to someone else
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    state, error = row["status"], row["error"]
    if (
        state == "running"
        and (datetime.now(UTC) - row["started_at"]).total_seconds() > STALE_AFTER_SECONDS
    ):
        state, error = "failed", "internal: the run did not finish"
    stored = session.execute(
        text(
            """SELECT answer_json FROM conversation_messages
               WHERE run_id = :r AND role = 'assistant' ORDER BY created_at DESC LIMIT 1"""
        ),
        {"r": run_id},
    ).first()
    return ChatRunView(
        id=row["id"],
        conversation_id=row["session_id"],
        status=state,
        steps=[ChatStep(**s) for s in steps_of(session, run_id)],
        answer=_answer_of(stored.answer_json if stored else None),
        error=friendly_error(error),
        model=row["model"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


@router.get("/conversations")
def list_conversations(session: SessionDep, user: Asker) -> list[Conversation]:
    rows = session.execute(
        text(
            """SELECT id, title, updated_at FROM conversations WHERE user_id = :u
               ORDER BY updated_at DESC LIMIT 50"""
        ),
        {"u": user.id},
    ).mappings()
    return [Conversation(**r) for r in rows]


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: uuid.UUID, session: SessionDep, user: Asker
) -> ConversationView:
    head = (
        session.execute(
            text("SELECT id, title, updated_at FROM conversations WHERE id = :c AND user_id = :u"),
            {"c": conversation_id, "u": user.id},
        )
        .mappings()
        .first()
    )
    if head is None:  # also when it is someone else's
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    messages = session.execute(
        text(
            """SELECT id, role, content, answer_json, run_id, created_at
               FROM conversation_messages WHERE conversation_id = :c
               ORDER BY created_at, role DESC"""
        ),
        {"c": conversation_id},
    ).mappings()
    return ConversationView(
        **head,
        messages=[
            ChatMessage(
                id=m["id"],
                role=m["role"],
                content=m["content"],
                answer=_answer_of(m["answer_json"]),
                run_id=m["run_id"],
                created_at=m["created_at"],
            )
            for m in messages
        ],
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: uuid.UUID, request: Request, session: SessionDep, user: Asker
) -> Response:
    gone = session.execute(
        text("DELETE FROM conversations WHERE id = :c AND user_id = :u RETURNING id"),
        {"c": conversation_id, "u": user.id},
    ).first()
    if gone is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    write_audit(
        session,
        request,
        "assistant.conversation_deleted",
        "conversation",
        user,
        entity_id=conversation_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
