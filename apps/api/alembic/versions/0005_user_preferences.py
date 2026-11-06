"""Per-user screen preferences (the Home layout).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-06
"""

from __future__ import annotations

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE users ADD COLUMN ui_preferences jsonb NOT NULL DEFAULT '{}'"
    )


def downgrade() -> None:
    raise NotImplementedError("Drop the column by hand if it is ever needed.")
