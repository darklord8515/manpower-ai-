"""A worker's email address, so HR can write to them from the profile.

Optional and edited by HR (employee:write). It is never sent to a model and never put in a chat answer.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-08
"""

from __future__ import annotations

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql("ALTER TABLE employees ADD COLUMN email text")


def downgrade() -> None:
    raise NotImplementedError("Emails are personal data; drop the column by hand if needed.")
