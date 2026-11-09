"""Calendar events HR adds by hand: a safety induction, an audit visit, a deadline.

Leaves, holidays, project dates and document dates are not stored here: the calendar reads them from
where they already live. This table holds only what a person types in.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-08
"""

from __future__ import annotations

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(
        """CREATE TABLE calendar_events (
               id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
               title      text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 120),
               starts_on  date NOT NULL,
               ends_on    date NOT NULL CHECK (ends_on >= starts_on),
               kind       text NOT NULL DEFAULT 'event'
                          CHECK (kind IN ('event', 'meeting', 'deadline')),
               note       text,
               created_by uuid REFERENCES users(id),
               is_demo    boolean NOT NULL DEFAULT false,
               created_at timestamptz NOT NULL DEFAULT now()
           )"""
    )
    bind.exec_driver_sql("CREATE INDEX calendar_events_dates_idx ON calendar_events (starts_on, ends_on)")


def downgrade() -> None:
    raise NotImplementedError("Drop the table by hand if it is ever needed.")
