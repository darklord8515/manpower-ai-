"""A run records which model answered it, so a fallback to the second provider is visible."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.ai.runtime import close_run, open_run
from tests.support import ScriptedLLM


class Fell:
    """Stands in for a FallbackClient that ended up on the second provider."""

    answered_by = "openrouter:openai/gpt-oss-120b:free"


def test_a_run_records_the_provider_that_answered(client: TestClient, migrated_db: Engine) -> None:
    with Session(migrated_db) as session:
        user = session.execute(text("SELECT id FROM users LIMIT 1")).scalar_one()

        def model_of(run_id: object) -> str:
            return str(
                session.execute(
                    text("SELECT model FROM agent_runs WHERE id = :i"), {"i": run_id}
                ).scalar_one()
            )

        fell = open_run(
            session, agent_code="narrator", user_id=user, user_input="a", intent="t", model="groq:g"
        )
        close_run(session, fell, status="succeeded", latency_ms=5, client=Fell())
        plain = open_run(
            session, agent_code="narrator", user_id=user, user_input="b", intent="t", model="m"
        )
        close_run(session, plain, status="succeeded", latency_ms=5, client=ScriptedLLM([]))
        session.commit()
        assert model_of(fell) == "openrouter:openai/gpt-oss-120b:free"
        assert model_of(plain) == "m"  # a client with nothing to add leaves the model alone
