"""HR ticks off mobilization tasks and confirms arrival.

The MVP has no Operations or Site logins, so the HR Manager and the HR Executive do this work on
behalf of every department (each tick records who did it).

- New permission mobilization:update ("Tick mobilization tasks").
- mobilization:update and assignment:confirm_arrival go to hr_manager and hr_executive (all).

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-07
"""

from __future__ import annotations

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.exec_driver_sql(
        "INSERT INTO permissions (code, description) VALUES "
        "('mobilization:update', 'Tick mobilization tasks')"
    )
    conn.exec_driver_sql(
        """
        INSERT INTO role_permissions (role_id, permission_id, scope)
        SELECT r.id, p.id, 'all'::access_scope
        FROM roles r JOIN permissions p
          ON p.code IN ('mobilization:update', 'assignment:confirm_arrival')
        WHERE r.code IN ('hr_manager', 'hr_executive')
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Remove the permission and its grants by hand if it is ever needed.")
