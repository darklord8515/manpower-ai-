"""The service account n8n and the system itself act as.

Model runs (`agent_runs.user_id`) and n8n's calls need a user. The `service_n8n` role and its three
permissions are already in the baseline; this adds the one user that holds it. It has no password
(it cannot sign in), is not a demo user (so it exists in every environment and the demo reset keeps
it) and is reached only by HMAC-signed requests, from Phase 5's n8n slice.

This is data, not structure, so db/schema.sql does not change.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-07
"""

from __future__ import annotations

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

EMAIL = "service.n8n@constructiq.internal"


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(
        f"""INSERT INTO users (email, full_name, password_hash, is_demo)
            VALUES ('{EMAIL}', 'n8n service account', NULL, false)
            ON CONFLICT (email) DO NOTHING"""
    )
    bind.exec_driver_sql(
        f"""INSERT INTO user_roles (user_id, role_id)
            SELECT u.id, r.id FROM users u, roles r
            WHERE u.email = '{EMAIL}' AND r.code = 'service_n8n'
            ON CONFLICT DO NOTHING"""
    )


def downgrade() -> None:
    raise NotImplementedError("Remove the service account by hand if it is ever needed.")
