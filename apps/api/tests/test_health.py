from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db import get_session
from app.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_health_ok_when_database_answers(client: TestClient) -> None:
    session = MagicMock(spec=Session)
    client.app.dependency_overrides[get_session] = lambda: session  # type: ignore[attr-defined]
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["db"] == "ok"


def test_health_reports_degraded_with_503_when_database_is_down(client: TestClient) -> None:
    session = MagicMock(spec=Session)
    session.execute.side_effect = OperationalError("SELECT 1", {}, Exception("down"))
    client.app.dependency_overrides[get_session] = lambda: session  # type: ignore[attr-defined]
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "down", "env": response.json()["env"]}
