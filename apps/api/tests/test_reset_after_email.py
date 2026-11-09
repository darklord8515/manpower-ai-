"""A demo reset still works after HR has emailed a worker (the log of that email points at them)."""

from __future__ import annotations

from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.seed.load import reset_demo
from tests.support import make_settings


def test_reset_demo_clears_the_email_log_with_everything_else(
    make_client: Callable[..., TestClient], migrated_db: Engine
) -> None:
    make_client()  # seeds the demo
    with migrated_db.begin() as c:
        c.execute(
            text(
                """INSERT INTO notifications (employee_id, channel, event, payload, delivered)
                   SELECT id, 'email', 'hr.message', '{}', true FROM employees LIMIT 1"""
            )
        )
    with migrated_db.begin() as c:
        reset_demo(c, make_settings())
    with migrated_db.connect() as c:
        assert c.execute(text("SELECT count(*) FROM notifications")).scalar_one() == 0
        assert c.execute(text("SELECT count(*) FROM employees")).scalar_one() == 0
