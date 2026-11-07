"""The Virtual HR chat: saved conversations, and the read tools the Workforce agent answers with.

A conversation belongs to one user. A message starts a supervisor run (`agent_runs.session_id` was
already there with nothing behind it; it now points at the conversation) and the answer is stored as
validated JSON. The Workforce agent also gets six read-only tools for the questions people ask in
the chat (who is free, who is expiring, which alerts, which projects and requests).

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-08
"""

from __future__ import annotations

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(
        """CREATE TABLE conversations (
               id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
               user_id    uuid NOT NULL REFERENCES users(id),
               title      text NOT NULL,
               created_at timestamptz NOT NULL DEFAULT now(),
               updated_at timestamptz NOT NULL DEFAULT now()
           )"""
    )
    bind.exec_driver_sql(
        "CREATE INDEX conversations_user_idx ON conversations (user_id, updated_at DESC)"
    )
    bind.exec_driver_sql(
        """CREATE TABLE conversation_messages (
               id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
               conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
               role            text NOT NULL CHECK (role IN ('user', 'assistant')),
               content         text NOT NULL,
               answer_json     jsonb,
               run_id          uuid REFERENCES agent_runs(id),
               created_at      timestamptz NOT NULL DEFAULT now()
           )"""
    )
    bind.exec_driver_sql(
        "CREATE INDEX conversation_messages_idx ON conversation_messages "
        "(conversation_id, created_at)"
    )
    bind.exec_driver_sql(
        """ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_session_fk
               FOREIGN KEY (session_id) REFERENCES conversations(id) ON DELETE SET NULL"""
    )
    bind.exec_driver_sql(
        """UPDATE agents SET allowed_tools = ARRAY['get_request_line','search_candidates',
                  'check_candidates','recommend_candidates','forecast_availability',
                  'search_workers','worker_profile','documents_expiring','list_alerts',
                  'list_projects','list_requests']
           WHERE code = 'workforce'"""
    )


def downgrade() -> None:
    raise NotImplementedError("Conversations hold people's questions; drop them by hand if needed.")
