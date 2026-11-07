"""Plain helpers shared by the API tests (the fixtures are in conftest.py)."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from datetime import date, datetime

from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.ai.llm import LLMError, LLMReply, Message, ToolSpec
from app.clock import GULF
from app.config import AppEnv, Settings

PASSWORD = "a-demo-password-for-tests"  # noqa: S105
HR_MANAGER = "noura.demo@constructiq.test"
HR_EXECUTIVE = "priya.demo@constructiq.test"
CEO = "layla.demo@constructiq.test"


class FixedClock:
    """A clock that says exactly when it is, for rules that count hours or days."""

    def __init__(self, now: datetime) -> None:
        self._now = now

    def today(self) -> date:
        return self._now.astimezone(GULF).date()

    def now(self) -> datetime:
        return self._now


class ScriptedLLM:
    """A model that answers from a script, and remembers every call it was given.

    `replies` is either a list (used in order; an exception in it is raised, so a provider failure
    can be scripted) or a function from the messages to the reply text.
    """

    def __init__(
        self,
        replies: Sequence[str | LLMReply | Exception]
        | Callable[[Sequence[Message]], str | LLMReply],
        model: str = "fake-light",
    ) -> None:
        self.model = model
        self._replies = replies
        self._used = 0
        self.calls: list[list[Message]] = []

    def chat(
        self,
        messages: Sequence[Message],
        *,
        tools: Sequence[ToolSpec] = (),
        json_output: bool = False,
        max_tokens: int = 1024,
    ) -> LLMReply:
        self.calls.append(list(messages))
        if callable(self._replies):
            reply = self._replies(messages)
        else:
            assert self._used < len(self._replies), "the model was called more often than scripted"
            reply = self._replies[self._used]
            self._used += 1
        if isinstance(reply, Exception):
            raise reply
        if isinstance(reply, LLMReply):
            return reply
        return LLMReply(reply, input_tokens=10, output_tokens=20)


def provider_down() -> LLMError:
    return LLMError("The model provider could not be reached (ConnectError)")


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": AppEnv.TEST,
        "demo_mode": True,
        "simulated_clock": True,
        "demo_password": PASSWORD,
        "secret_key": "k" * 40,
        "cors_origins": "http://localhost:3000",
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def sign_in(client: TestClient, email: str, password: str = PASSWORD) -> None:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text


def add_user(
    engine: Engine,
    email: str,
    role: str,
    employee_code: str | None = None,
    projects: tuple[str, ...] = (),
) -> None:
    """A user with one role, optionally linked to a worker and with access to projects."""
    user_id = uuid.uuid4()
    with engine.begin() as c:
        employee = (
            c.execute(
                text("SELECT id FROM employees WHERE employee_code = :c"), {"c": employee_code}
            ).scalar_one()
            if employee_code
            else None
        )
        c.execute(
            text(
                """INSERT INTO users (id, email, full_name, password_hash, employee_id, is_demo)
                   VALUES (:id, :email, :name, :hash, :employee, true)"""
            ),
            {"id": user_id, "email": email, "name": email.split("@")[0],
             "hash": PasswordHasher().hash(PASSWORD), "employee": employee},
        )  # fmt: skip
        c.execute(
            text(
                "INSERT INTO user_roles (user_id, role_id) SELECT :u, id FROM roles WHERE code = :r"
            ),
            {"u": user_id, "r": role},
        )
        for code in projects:
            c.execute(
                text(
                    """INSERT INTO user_project_access (user_id, project_id)
                       SELECT :u, id FROM projects WHERE code = :p"""
                ),
                {"u": user_id, "p": code},
            )
