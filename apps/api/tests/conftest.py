"""Shared fixtures. Database tests need a real Postgres 16 and are skipped when none is reachable,
unless REQUIRE_DB=1 (CI sets it, so a missing database fails the build instead of hiding it)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.auth.throttle import LoginThrottle
from app.config import ConfigError, get_settings
from app.db import get_session, get_session_factory
from app.main import create_app
from app.routes import auth as auth_routes
from app.seed.load import seed_demo
from tests.support import make_settings

API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def admin_engine() -> Iterator[Engine]:
    """Owner connection used to create and drop throwaway databases."""
    required = os.environ.get("REQUIRE_DB") == "1"
    try:
        engine = create_engine(get_settings().migration_url, isolation_level="AUTOCOMMIT")
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except (ConfigError, Exception) as error:  # noqa: BLE001 - any failure means "no database"
        if required:
            raise
        pytest.skip(f"no Postgres available for database tests ({type(error).__name__})")
    yield engine
    engine.dispose()


def migrate(url: str) -> None:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.attributes["url"] = url
    command.upgrade(config, "head")


@pytest.fixture
def migrated_db(admin_engine: Engine) -> Iterator[Engine]:
    """A throwaway database with every migration applied. Dropped afterwards."""
    name = f"cq_test_{uuid.uuid4().hex[:8]}"
    with admin_engine.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    url = admin_engine.url.set(database=name)
    migrate(url.render_as_string(hide_password=False))
    engine = create_engine(url)
    yield engine
    engine.dispose()
    with admin_engine.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


@pytest.fixture
def make_client(
    migrated_db: Engine, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Callable[..., TestClient]]:
    """Builds clients on one freshly seeded database; settings can be overridden per client."""
    monkeypatch.setattr(auth_routes, "throttle", LoginThrottle())
    sessions = sessionmaker(bind=migrated_db, expire_on_commit=False)
    clients: list[TestClient] = []
    seeded = False

    def build(**overrides: object) -> TestClient:
        nonlocal seeded
        settings = make_settings(**overrides)
        if not seeded:
            with migrated_db.begin() as connection:
                seed_demo(connection, settings)
            seeded = True
        app = create_app(settings)

        def session() -> Iterator[Session]:
            with sessions() as s:
                yield s

        app.dependency_overrides[get_session] = session
        app.dependency_overrides[get_session_factory] = lambda: sessions
        app.dependency_overrides[get_settings] = lambda: settings
        client = TestClient(app)
        clients.append(client)
        return client

    yield build
    for client in clients:
        client.close()


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()
