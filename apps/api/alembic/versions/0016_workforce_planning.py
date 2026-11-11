"""Workforce planning: planned headcount per project and designation, where each person is, and a history.

The client tracks positions in two Excel trackers (labour and staff). This adds what they need:
- trades.kind / department: a designation is labour or staff, and belongs to a department;
- projects.kind (project or head office) and two more stages (pre-construction, handover);
- employees: offer_issued and documents_cleared statuses (active = joined), the project they are placed
  on, their discipline, local or overseas, whether they are a UAE national, and a note;
- plan_lines: how many people a project plans for each designation (empty positions are the difference);
- workforce_events: everything done to the workforce (placed, moved, joined ...), marking what the AI did.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-11
"""

from __future__ import annotations

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A new enum value cannot be used in the transaction that adds it, so these run on their own.
    with op.get_context().autocommit_block():
        for statement in (
            "ALTER TYPE employment_status ADD VALUE IF NOT EXISTS 'offer_issued'",
            "ALTER TYPE employment_status ADD VALUE IF NOT EXISTS 'documents_cleared'",
            "ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'pre_construction'",
            "ALTER TYPE project_status ADD VALUE IF NOT EXISTS 'handover'",
        ):
            op.get_bind().exec_driver_sql(statement)
    bind = op.get_bind()
    bind.exec_driver_sql(
        """ALTER TABLE trades
               ADD COLUMN kind text NOT NULL DEFAULT 'labour' CHECK (kind IN ('labour', 'staff')),
               ADD COLUMN department text"""
    )
    bind.exec_driver_sql("UPDATE trades SET kind = 'staff' WHERE category = 'Staff'")
    bind.exec_driver_sql(
        """ALTER TABLE projects
               ADD COLUMN kind text NOT NULL DEFAULT 'project'
                   CHECK (kind IN ('project', 'head_office'))"""
    )
    bind.exec_driver_sql(
        """ALTER TABLE employees
               ADD COLUMN project_id uuid REFERENCES projects(id),
               ADD COLUMN discipline text,
               ADD COLUMN source text CHECK (source IN ('local', 'overseas')),
               ADD COLUMN uae_national boolean NOT NULL DEFAULT false,
               ADD COLUMN note text"""
    )
    bind.exec_driver_sql("CREATE INDEX employees_project_idx ON employees (project_id)")
    bind.exec_driver_sql(
        """CREATE TABLE plan_lines (
               id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
               project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
               trade_id          uuid NOT NULL REFERENCES trades(id),
               discipline        text,
               planned           integer NOT NULL CHECK (planned >= 0),
               needed_by         date,
               uae_national_only boolean NOT NULL DEFAULT false,
               source            text CHECK (source IN ('local', 'overseas')),
               updated_at        timestamptz NOT NULL DEFAULT now()
           )"""
    )
    bind.exec_driver_sql(
        """CREATE UNIQUE INDEX plan_lines_key ON plan_lines
               (project_id, trade_id, uae_national_only)"""
    )
    bind.exec_driver_sql(
        """CREATE TABLE workforce_events (
               id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
               employee_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
               project_from uuid REFERENCES projects(id),
               project_to   uuid REFERENCES projects(id),
               kind         text NOT NULL CHECK (kind IN ('added', 'placed', 'moved', 'documents_cleared',
                                'joined', 'resigned', 'plan_changed', 'imported')),
               decided_by   text NOT NULL DEFAULT 'hr' CHECK (decided_by IN ('hr', 'ai')),
               reason       text,
               actor_id     uuid REFERENCES users(id),
               created_at   timestamptz NOT NULL DEFAULT now()
           )"""
    )
    bind.exec_driver_sql(
        "CREATE INDEX workforce_events_idx ON workforce_events (created_at DESC)"
    )


def downgrade() -> None:
    raise NotImplementedError("Drop these by hand if they are ever not wanted.")
