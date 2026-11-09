"""A named project lead, worker photos, and the demo applicants page.

- projects.lead_employee_id: the company employee responsible for delivering the project. (The
  older projects.project_manager_id points at a login, not at a person on the payroll.)
- employees.photo_key / photo_type: where a worker's photo is kept in the storage backend.
- applicants / applicant_interviews: people who have applied (demo data for now) and the interview
  invitations HR sends them.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-09
"""

from __future__ import annotations

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(
        "ALTER TABLE projects ADD COLUMN lead_employee_id uuid REFERENCES employees(id)"
    )
    bind.exec_driver_sql("ALTER TABLE employees ADD COLUMN photo_key text, ADD COLUMN photo_type text")
    bind.exec_driver_sql(
        """CREATE TABLE applicants (
               id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
               code             text NOT NULL UNIQUE,
               full_name        text NOT NULL,
               category         text NOT NULL,
               years_experience integer NOT NULL CHECK (years_experience >= 0),
               nationality      text,
               location         text,
               email            text,
               skills           text[] NOT NULL DEFAULT '{}',
               summary          text,
               documents_ready  boolean NOT NULL DEFAULT false,
               available_from   date,
               status           text NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new', 'shortlisted', 'interview_sent', 'rejected')),
               is_demo          boolean NOT NULL DEFAULT false,
               created_at       timestamptz NOT NULL DEFAULT now()
           )"""
    )
    bind.exec_driver_sql(
        """CREATE TABLE applicant_interviews (
               id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
               applicant_id uuid NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
               starts_at    timestamptz NOT NULL,
               mode         text NOT NULL CHECK (mode IN ('online', 'offline')),
               venue        text NOT NULL,
               note         text,
               sent_to      text NOT NULL,
               sent_by      uuid REFERENCES users(id),
               delivered    boolean NOT NULL DEFAULT false,
               created_at   timestamptz NOT NULL DEFAULT now()
           )"""
    )
    bind.exec_driver_sql(
        "CREATE INDEX applicant_interviews_idx ON applicant_interviews (applicant_id, created_at)"
    )


def downgrade() -> None:
    raise NotImplementedError("Drop these by hand if they are ever not wanted.")
