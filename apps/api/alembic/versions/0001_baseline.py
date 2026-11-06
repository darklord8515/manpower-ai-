"""Baseline: the schema in db/schema.sql.

db/schema.sql is the source of truth. This migration applies it unchanged, so the first migration
and the file can never disagree. Every later change is a new migration that also updates
db/schema.sql; CI (tests/test_migrations.py) fails if the two ever differ.

Revision ID: 0001
Revises:
Create Date: 2026-11-06
"""

from __future__ import annotations

from alembic import op
from app.config import REPO_ROOT

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA_FILE = REPO_ROOT / "db" / "schema.sql"


def upgrade() -> None:
    # exec_driver_sql sends the file as-is (no bind-parameter parsing), so `::` casts and `$$`
    # blocks in the SQL are untouched.
    op.get_bind().exec_driver_sql(SCHEMA_FILE.read_text(encoding="utf-8"))


def downgrade() -> None:
    raise NotImplementedError(
        "The baseline cannot be undone. Use `make reset-demo` or recreate the database."
    )
