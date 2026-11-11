"""An expected joining date per person, for the Mobilization board.

A person on offer or with documents cleared has a date HR expects them to join. HR can change it at
any time. When they are marked as joined it becomes their joining date (unless HR types another).
Changing it is written to the history (`join_date_set`).

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-11
"""

from __future__ import annotations

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("ALTER TABLE employees ADD COLUMN expected_join_on date")
    bind.exec_driver_sql("ALTER TABLE workforce_events DROP CONSTRAINT workforce_events_kind_check")
    bind.exec_driver_sql(
        """ALTER TABLE workforce_events ADD CONSTRAINT workforce_events_kind_check
               CHECK (kind IN ('added', 'placed', 'moved', 'documents_cleared', 'joined',
                               'resigned', 'plan_changed', 'imported', 'join_date_set'))"""
    )


def downgrade() -> None:
    raise NotImplementedError("Drop the column by hand if it is ever not wanted.")
