"""The Allocation Board: line decisions, picks, and who may raise a request.

- staffing_request_lines: status, decided_by, decided_at, decision_reason.
- staffing_request_picks: who HR has chosen on a line before approval, and who was removed and why.
- HR Manager and HR Executive may raise staffing requests; the HR Manager approves.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-06
"""

from __future__ import annotations

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.exec_driver_sql("CREATE TYPE line_status AS ENUM ('open', 'approved', 'rejected')")
    conn.exec_driver_sql(
        """
        ALTER TABLE staffing_request_lines
            ADD COLUMN status line_status NOT NULL DEFAULT 'open',
            ADD COLUMN decided_by uuid REFERENCES users(id),
            ADD COLUMN decided_at timestamptz,
            ADD COLUMN decision_reason text,
            ADD CONSTRAINT staffing_request_lines_reject_reason_check
                CHECK (status <> 'rejected' OR length(btrim(coalesce(decision_reason, ''))) >= 10)
        """
    )
    conn.exec_driver_sql(
        """
        CREATE TABLE staffing_request_picks (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            line_id       uuid NOT NULL REFERENCES staffing_request_lines(id) ON DELETE CASCADE,
            employee_id   uuid NOT NULL REFERENCES employees(id),
            source        text NOT NULL DEFAULT 'hr' CHECK (source IN ('hr', 'rules', 'agent')),
            reason        text,
            picked_by     uuid NOT NULL REFERENCES users(id),
            removed_reason text,
            created_at    timestamptz NOT NULL DEFAULT now(),
            UNIQUE (line_id, employee_id)
        )
        """
    )
    conn.exec_driver_sql(
        """
        CREATE INDEX staffing_request_picks_employee_idx ON staffing_request_picks (employee_id)
            WHERE removed_reason IS NULL
        """
    )
    conn.exec_driver_sql(
        """
        INSERT INTO role_permissions (role_id, permission_id, scope)
        SELECT r.id, p.id, 'all'::access_scope
        FROM roles r JOIN permissions p ON p.code = 'staffing:create'
        WHERE r.code IN ('hr_manager', 'hr_executive')
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Remove the picks table and grants by hand if it is ever needed.")
