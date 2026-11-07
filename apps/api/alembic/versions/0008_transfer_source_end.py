"""Remember when the source project ended, when a transfer was reserved.

employee_assignments.source_project_ends_on: on a planned assignment that depends on another one,
the end date the source project had when the person was reserved. The transfer_dependency_broken
alert compares it with the project's end date now, so someone released early on purpose is not
flagged, and a project that was extended past the handover is.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-07
"""

from __future__ import annotations

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE employee_assignments ADD COLUMN source_project_ends_on date"
    )


def downgrade() -> None:
    raise NotImplementedError("Drop the column by hand if it is ever needed.")
