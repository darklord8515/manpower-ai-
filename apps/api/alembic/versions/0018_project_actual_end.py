"""The real end date of a project.

`ends_on` is the date HR expects a project to finish. `actual_end_on` is the day it really finished.
Setting it completes the project (unless HR says otherwise).

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-11
"""

from __future__ import annotations

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("ALTER TABLE projects ADD COLUMN actual_end_on date")
    bind.exec_driver_sql(
        """ALTER TABLE projects ADD CONSTRAINT projects_actual_end_check
               CHECK (actual_end_on IS NULL OR starts_on IS NULL OR actual_end_on >= starts_on)"""
    )


def downgrade() -> None:
    raise NotImplementedError("Drop the column by hand if it is ever not wanted.")