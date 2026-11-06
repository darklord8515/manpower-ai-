"""Contract ends, exits and the recruitment pipeline.

- employees: contract_end_on, exit_on, exit_reason; employment_status gains 'absconded'.
- recruitment_status becomes the pipeline HR tracks in Excel (open, sourcing, offer_issued,
  visa_processing, arrived, filled, cancelled). The old 'in_progress' becomes 'sourcing'.
- recruitment_requests: source (local / overseas), expected_arrival, replaces_employee_id.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-06
"""

from __future__ import annotations

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

OPEN_STAGES = "('open', 'sourcing', 'offer_issued', 'visa_processing', 'arrived')"


def upgrade() -> None:
    conn = op.get_bind()
    # Employees. ADD VALUE is allowed inside a transaction as long as the value is not used in it.
    conn.exec_driver_sql("ALTER TYPE employment_status ADD VALUE 'absconded'")
    conn.exec_driver_sql(
        "CREATE TYPE exit_reason AS ENUM ('resigned', 'terminated', 'absconded', "
        "'contract_ended', 'other')"
    )
    conn.exec_driver_sql(
        """
        ALTER TABLE employees
            ADD COLUMN contract_end_on date,
            ADD COLUMN exit_on date,
            ADD COLUMN exit_reason exit_reason
        """
    )

    # Recruitment pipeline: replace the enum (objects that depend on the column are recreated).
    conn.exec_driver_sql("DROP INDEX recruitment_requests_open_idx")
    conn.exec_driver_sql("ALTER TABLE recruitment_requests ALTER COLUMN status DROP DEFAULT")
    conn.exec_driver_sql("ALTER TYPE recruitment_status RENAME TO recruitment_status_old")
    conn.exec_driver_sql(
        "CREATE TYPE recruitment_status AS ENUM ('open', 'sourcing', 'offer_issued', "
        "'visa_processing', 'arrived', 'filled', 'cancelled')"
    )
    conn.exec_driver_sql(
        """
        ALTER TABLE recruitment_requests ALTER COLUMN status TYPE recruitment_status
        USING (CASE status::text WHEN 'in_progress' THEN 'sourcing'
                                 ELSE status::text END)::recruitment_status
        """
    )
    conn.exec_driver_sql("ALTER TABLE recruitment_requests ALTER COLUMN status SET DEFAULT 'open'")
    conn.exec_driver_sql("DROP TYPE recruitment_status_old")
    conn.exec_driver_sql("CREATE TYPE recruit_source AS ENUM ('local', 'overseas')")
    conn.exec_driver_sql(
        """
        ALTER TABLE recruitment_requests
            ADD COLUMN source recruit_source NOT NULL DEFAULT 'overseas',
            ADD COLUMN expected_arrival date,
            ADD COLUMN replaces_employee_id uuid REFERENCES employees(id)
        """
    )
    conn.exec_driver_sql(
        f"""
        CREATE INDEX recruitment_requests_open_idx ON recruitment_requests (project_id, trade_id)
            WHERE status IN {OPEN_STAGES}
        """
    )


def downgrade() -> None:
    raise NotImplementedError("The pipeline stages cannot be merged back into two states.")
