"""The Workforce agent's real tool list.

`agents.allowed_tools` is now enforced by the agent runtime: a tool that is not listed is refused,
whatever the model asks for. The baseline listed the tools of the design document; these are the
tools the agent actually has (docs/agents.md): the Allocation Board's recommendation run and the
forecast explanation. The availability, document and work-rule checks that the design listed
separately are one tool, `check_candidates`, which runs every hard rule.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-07
"""

from __future__ import annotations

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        """UPDATE agents SET allowed_tools = ARRAY['get_request_line','search_candidates',
                  'check_candidates','recommend_candidates','forecast_availability']
           WHERE code = 'workforce'"""
    )


def downgrade() -> None:
    raise NotImplementedError("The previous list was a design placeholder; restore it by hand.")
