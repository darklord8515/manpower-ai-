"""The Mobilization agent reads only: one tool, `list_mobilizations`.

The baseline listed `get_mobilization`, `check_readiness` and `create_mob_tasks`. The first two are
one read; the third would let an agent write, which agents never do (CLAUDE.md), and the
mobilization service already creates the tasks on approval. `agents.allowed_tools` is enforced by
the runtime, so a tool that is not listed does not exist for the agent.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-09
"""

from __future__ import annotations

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        """UPDATE agents SET allowed_tools = ARRAY['list_mobilizations']
           WHERE code = 'mobilization'"""
    )


def downgrade() -> None:
    raise NotImplementedError("Set agents.allowed_tools by hand if it is ever needed.")
