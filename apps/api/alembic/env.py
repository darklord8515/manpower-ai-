"""Alembic environment. Migrations run as the database owner, never as the application role."""

from __future__ import annotations

from sqlalchemy import create_engine

from alembic import context
from app.config import get_settings

config = context.config


def run_migrations_online() -> None:
    # Tests pass a throwaway database through config.attributes; normal runs use the owner login.
    url = config.attributes.get("url") or get_settings().migration_url
    engine = create_engine(url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()
        connection.commit()


if context.is_offline_mode():
    raise RuntimeError("Offline migrations are not supported: the baseline needs a live database.")
run_migrations_online()
