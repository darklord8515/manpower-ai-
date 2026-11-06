"""Shared fixtures. Database tests need a real Postgres 16 and are skipped when none is reachable,
unless REQUIRE_DB=1 (CI sets it, so a missing database fails the build instead of hiding it)."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from sqlalchemy import Engine, create_engine, text

from app.config import ConfigError, get_settings


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
