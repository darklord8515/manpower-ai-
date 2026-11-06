"""db/schema.sql is the source of truth. Applying every migration to an empty database must give
exactly the same result as loading schema.sql into another empty database."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL

from alembic import command
from app.config import REPO_ROOT

API_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_FILE = REPO_ROOT / "db" / "schema.sql"

# Each query returns rows that must be identical in both databases.
CATALOG_QUERIES: dict[str, str] = {
    "columns": """
        SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> 'alembic_version'
        ORDER BY 1, 2""",
    "indexes": """
        SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename <> 'alembic_version' ORDER BY 1, 2""",
    "constraints": """
        SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND conrelid::regclass::text <> 'alembic_version' ORDER BY 1, 2""",
    "enums": """
        SELECT t.typname, e.enumsortorder, e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid ORDER BY 1, 2""",
    "views": "SELECT viewname, definition FROM pg_views WHERE schemaname = 'public' ORDER BY 1",
    "grants": """
        SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'constructiq_app' AND table_schema = 'public'
          AND table_name <> 'alembic_version' ORDER BY 1, 2""",
    "roles": "SELECT code, name, dashboard, default_scope FROM roles ORDER BY 1",
    "permissions": "SELECT code, description FROM permissions ORDER BY 1",
    "role_permissions": """
        SELECT r.code, p.code, rp.scope FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
        ORDER BY 1, 2""",
    "agents": "SELECT code, is_enabled, allowed_tools FROM agents ORDER BY 1",
    "work_rules": "SELECT code, year, starts_on, ends_on FROM work_rules ORDER BY 1, 2",
}


def _database_url(admin: Engine, name: str) -> URL:
    return admin.url.set(database=name)


@pytest.fixture
def two_databases(admin_engine: Engine) -> Iterator[tuple[str, str]]:
    suffix = uuid.uuid4().hex[:8]
    names = (f"cq_migrated_{suffix}", f"cq_schema_{suffix}")
    with admin_engine.connect() as connection:
        for name in names:
            connection.execute(text(f'CREATE DATABASE "{name}"'))
    yield names
    with admin_engine.connect() as connection:
        for name in names:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def _catalog(url: URL) -> dict[str, list[tuple[Any, ...]]]:
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            return {
                name: [tuple(row) for row in connection.execute(text(sql))]
                for name, sql in CATALOG_QUERIES.items()
            }
    finally:
        engine.dispose()


def test_migrations_produce_exactly_schema_sql(
    admin_engine: Engine, two_databases: tuple[str, str]
) -> None:
    migrated, loaded = two_databases

    config = Config(str(API_ROOT / "alembic.ini"))
    config.attributes["url"] = _database_url(admin_engine, migrated).render_as_string(
        hide_password=False
    )
    command.upgrade(config, "head")

    engine = create_engine(_database_url(admin_engine, loaded), isolation_level="AUTOCOMMIT")
    with engine.connect() as connection:
        connection.exec_driver_sql(SCHEMA_FILE.read_text(encoding="utf-8"))
    engine.dispose()

    from_migrations = _catalog(_database_url(admin_engine, migrated))
    from_schema = _catalog(_database_url(admin_engine, loaded))
    assert from_migrations["columns"], "the migrated database has no tables"
    for name in CATALOG_QUERIES:
        assert from_migrations[name] == from_schema[name], f"{name} differ from db/schema.sql"


def test_schema_has_the_tables_this_phase_uses(
    admin_engine: Engine, two_databases: tuple[str, str]
) -> None:
    migrated, _ = two_databases
    config = Config(str(API_ROOT / "alembic.ini"))
    config.attributes["url"] = _database_url(admin_engine, migrated).render_as_string(
        hide_password=False
    )
    command.upgrade(config, "head")
    tables = {row[0] for row in _catalog(_database_url(admin_engine, migrated))["columns"]}
    expected = {
        "roles", "permissions", "role_permissions", "users", "user_roles", "employees",
        "employee_documents", "projects", "user_project_access", "audit_log",
    }  # fmt: skip
    assert expected <= tables
