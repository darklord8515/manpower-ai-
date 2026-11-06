"""One residency visa document: the visa and the Emirates ID are the same document.

The `visa` document type becomes `residency_visa` and `emirates_id` is removed. Where a worker had
both, the Emirates ID number moves onto the residency visa (the number HR masks and reveals) and
the separate Emirates ID row is dropped. A worker who only had an Emirates ID keeps it, as the
residency visa.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-06
"""

from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    # 1. Merge, while the old values still exist.
    conn.exec_driver_sql(
        """
        UPDATE employee_documents v SET doc_number = e.doc_number
        FROM employee_documents e
        WHERE v.employee_id = e.employee_id AND v.doc_type = 'visa' AND e.doc_type = 'emirates_id'
          AND v.is_current AND e.is_current AND e.doc_number IS NOT NULL
        """
    )
    conn.exec_driver_sql(
        """
        UPDATE employee_documents e SET doc_type = 'visa'
        WHERE e.doc_type = 'emirates_id' AND e.is_current AND NOT EXISTS (
            SELECT 1 FROM employee_documents v
            WHERE v.employee_id = e.employee_id AND v.doc_type = 'visa' AND v.is_current)
        """
    )
    conn.exec_driver_sql("DELETE FROM employee_documents WHERE doc_type = 'emirates_id'")
    # 2. Replace the enum. Objects that depend on the column are dropped and recreated.
    conn.exec_driver_sql("DROP VIEW v_document_expiry")
    conn.exec_driver_sql("DROP INDEX employee_documents_one_current")
    conn.exec_driver_sql("ALTER TYPE document_type RENAME TO document_type_old")
    conn.exec_driver_sql(
        """
        CREATE TYPE document_type AS ENUM ('passport', 'residency_visa', 'work_permit',
            'labour_card', 'medical_fitness', 'trade_certificate', 'safety_certificate',
            'driving_licence', 'other')
        """
    )
    conn.exec_driver_sql(
        """
        ALTER TABLE employee_documents ALTER COLUMN doc_type TYPE document_type
        USING (CASE doc_type::text WHEN 'visa' THEN 'residency_visa'
                                   ELSE doc_type::text END)::document_type
        """
    )
    conn.exec_driver_sql("DROP TYPE document_type_old")
    conn.exec_driver_sql(
        """
        CREATE UNIQUE INDEX employee_documents_one_current
            ON employee_documents (employee_id, doc_type) WHERE is_current AND doc_type <> 'other'
        """
    )
    conn.exec_driver_sql(
        """
        CREATE VIEW v_document_expiry AS
        SELECT d.employee_id, e.full_name, d.doc_type, d.expiry_date,
               (d.expiry_date - current_date) AS days_left
        FROM employee_documents d
        JOIN employees e ON e.id = d.employee_id
        WHERE d.is_current AND d.expiry_date IS NOT NULL
        """
    )


def downgrade() -> None:
    raise NotImplementedError("The merge of visa and Emirates ID cannot be undone.")
