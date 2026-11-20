"""Findings and their evidence (FR-6.2, FR-6.3): one finding per root cause of a target, and the
evidence that supports it, written once with a checksum and never changed (NFR-2.4).

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-30
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# NFR-2.4: no UPDATE or DELETE of evidence; the same SQL as app/modules/m06_findings/models.py
# attaches to the table.
READ_ONLY_FUNCTION = """
CREATE OR REPLACE FUNCTION sentra_evidence_read_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Evidence can''t be changed or deleted.'
        USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql
"""
READ_ONLY_TRIGGER = (
    "CREATE TRIGGER evidence_read_only BEFORE UPDATE OR DELETE ON evidence "
    "FOR EACH ROW EXECUTE FUNCTION sentra_evidence_read_only()"
)


def upgrade() -> None:
    op.create_table("findings",
    sa.Column("number", sa.Integer(), nullable=False),
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("test_code", sa.String(length=40), nullable=False),
    sa.Column("test_definition_id", sa.Uuid(), nullable=False),
    sa.Column("component_kind", sa.String(length=20), nullable=False),
    sa.Column("component_name", sa.String(length=120), nullable=False),
    sa.Column("title", sa.String(length=200), nullable=False),
    sa.Column("category", sa.String(length=5), nullable=False),
    sa.Column("atlas", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("severity", sa.String(length=15), nullable=False),
    sa.Column("status", sa.String(length=25), nullable=False),
    sa.Column("description", sa.Text(), nullable=False),
    sa.Column("first_run_id", sa.Uuid(), nullable=False),
    sa.Column("last_run_id", sa.Uuid(), nullable=False),
    sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("evidence_count", sa.Integer(), nullable=False),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["first_run_id"], ["campaign_runs.id"], name=op.f("fk_findings_first_run_id_campaign_runs"), ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["last_run_id"], ["campaign_runs.id"], name=op.f("fk_findings_last_run_id_campaign_runs"), ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_findings_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_findings_target_id_targets"), ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["test_definition_id"], ["test_definitions.id"], name=op.f("fk_findings_test_definition_id_test_definitions"), ondelete="RESTRICT"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_findings")),
    sa.UniqueConstraint("organization_id", "number", name=op.f("uq_findings_organization_id")),
    sa.UniqueConstraint("target_id", "test_code", "component_kind", "component_name", name="uq_findings_root_cause")
    )
    op.create_index("ix_findings_organization_status", "findings", ["organization_id", "status"], unique=False)
    op.create_index(op.f("ix_findings_organization_id"), "findings", ["organization_id"], unique=False)
    op.create_table("evidence",
    sa.Column("finding_id", sa.Uuid(), nullable=False),
    sa.Column("evidence_no", sa.Integer(), nullable=False),
    sa.Column("kind", sa.String(length=20), nullable=False),
    sa.Column("attempt_id", sa.Uuid(), nullable=False),
    sa.Column("campaign_run_id", sa.Uuid(), nullable=False),
    sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("checksum", sa.String(length=64), nullable=False),
    sa.Column("size", sa.Integer(), nullable=False),
    sa.Column("content", sa.Text(), nullable=True),
    sa.Column("content_ref", sa.String(length=300), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["attempt_id"], ["attempts.id"], name=op.f("fk_evidence_attempt_id_attempts"), ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["campaign_run_id"], ["campaign_runs.id"], name=op.f("fk_evidence_campaign_run_id_campaign_runs"), ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["finding_id"], ["findings.id"], name=op.f("fk_evidence_finding_id_findings"), ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_evidence_organization_id_organizations"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_evidence")),
    sa.UniqueConstraint("attempt_id", "kind", name=op.f("uq_evidence_attempt_id")),
    sa.UniqueConstraint("finding_id", "evidence_no", name=op.f("uq_evidence_finding_id"))
    )
    op.create_index("ix_evidence_campaign_run_id", "evidence", ["campaign_run_id"], unique=False)
    op.create_index(op.f("ix_evidence_organization_id"), "evidence", ["organization_id"], unique=False)
    op.execute(READ_ONLY_FUNCTION)
    op.execute(READ_ONLY_TRIGGER)


def downgrade() -> None:
    op.drop_index(op.f("ix_evidence_organization_id"), table_name="evidence")
    op.drop_index("ix_evidence_campaign_run_id", table_name="evidence")
    op.drop_table("evidence")  # its trigger goes with it
    op.execute("DROP FUNCTION IF EXISTS sentra_evidence_read_only()")
    op.drop_index(op.f("ix_findings_organization_id"), table_name="findings")
    op.drop_index("ix_findings_organization_status", table_name="findings")
    op.drop_table("findings")
