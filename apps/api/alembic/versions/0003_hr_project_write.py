"""HR can add projects: grant project:write to the HR Manager and the HR Executive.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-06
"""

from __future__ import annotations

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        INSERT INTO role_permissions (role_id, permission_id, scope)
        SELECT r.id, p.id, 'all'::access_scope
        FROM roles r JOIN permissions p ON p.code = 'project:write'
        WHERE r.code IN ('hr_manager', 'hr_executive')
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Remove the grant by hand if it is ever needed.")
