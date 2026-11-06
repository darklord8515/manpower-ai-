"""Shared fixtures. Database tests need a real Postgres 16 and are skipped when none is reachable,
unless REQUIRE_DB=1 (CI sets it, so a missing database fails the build instead of hiding it)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text

from alembic import command
from app.config import ConfigError, get_settings

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
