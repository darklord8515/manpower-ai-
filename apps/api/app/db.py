"""Database engine and session. One place decides how the app talks to Postgres."""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings, get_settings


def build_engine(settings: Settings) -> Engine:
    connect_args: dict[str, Any] = {}
    if settings.database_pooled:
        # PgBouncer in transaction mode (Neon's pooled URL) cannot hold prepared statements.
        connect_args["prepare_threshold"] = None
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args=connect_args,
    )


@lru_cache
def get_engine() -> Engine:
    return build_engine(get_settings())


def get_session() -> Iterator[Session]:
    with sessionmaker(bind=get_engine(), expire_on_commit=False)() as session:
        yield session


def get_session_factory() -> sessionmaker[Session]:
    """For work that outlives the request (background batches): each opens its own session."""
    return sessionmaker(bind=get_engine(), expire_on_commit=False)
