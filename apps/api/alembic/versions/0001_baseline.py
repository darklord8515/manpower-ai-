"""Baseline: the schema in db/schema.sql.

This migration applies a frozen copy of the first schema (alembic/baseline/0001_schema.sql).
db/schema.sql is the source of truth for the CURRENT schema: every later change is a new migration
that also updates db/schema.sql; CI (tests/test_migrations.py) fails if the two ever differ.

Revision ID: 0001
Revises:
Create Date: 2026-11-06
"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA_FILE = Path(__file__).resolve().parents[1] / "baseline" / "0001_schema.sql"


def upgrade() -> None:
    # exec_driver_sql sends the file as-is (no bind-parameter parsing), so `::` casts and `$$`
    # blocks in the SQL are untouched.
    op.get_bind().exec_driver_sql(SCHEMA_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise NotImplementedError(
        "The baseline cannot be undone. Use `make reset-demo` or recreate the database."
    )
