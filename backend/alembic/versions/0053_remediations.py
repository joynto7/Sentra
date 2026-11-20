"""Remediation proposals (FR-8.1, UC-8.2): every version of a finding's proposal, the fixes of
each version and the jobs that generate them. A proposal is a draft until a person approves it,
which comes with FR-8.2.

Revision ID: 0053
Revises: 0052
Create Date: 2026-10-30
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0053"
down_revision: str | None = "0052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("remediation_jobs",
    sa.Column("finding_id", sa.Uuid(), nullable=False),
    sa.Column("trigger", sa.String(length=20), nullable=False),
    sa.Column("requested_by_id", sa.Uuid(), nullable=True),
    sa.Column("status", sa.String(length=10), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("version", sa.Integer(), nullable=True),
    sa.Column("message", sa.Text(), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["finding_id"], ["findings.id"], name=op.f("fk_remediation_jobs_finding_id_findings"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_remediation_jobs_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], name=op.f("fk_remediation_jobs_requested_by_id_users"), ondelete="SET NULL"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_remediation_jobs"))
    )
    op.create_index(op.f("ix_remediation_jobs_finding_id"), "remediation_jobs", ["finding_id"], unique=False)
    op.create_index(op.f("ix_remediation_jobs_organization_id"), "remediation_jobs", ["organization_id"], unique=False)
    op.create_table("remediations",
    sa.Column("finding_id", sa.Uuid(), nullable=False),
    sa.Column("version", sa.Integer(), nullable=False),
    sa.Column("status", sa.String(length=20), nullable=False),
    sa.Column("origin", sa.String(length=10), nullable=False),
    sa.Column("based_on_version", sa.Integer(), nullable=True),
    sa.Column("root_cause", sa.Text(), nullable=False),
    sa.Column("summary", sa.Text(), nullable=False),
    sa.Column("ai_generated", sa.Boolean(), nullable=False),
    sa.Column("generation", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("requested_by_id", sa.Uuid(), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["finding_id"], ["findings.id"], name=op.f("fk_remediations_finding_id_findings"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_remediations_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], name=op.f("fk_remediations_requested_by_id_users"), ondelete="SET NULL"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_remediations")),
    sa.UniqueConstraint("finding_id", "version", name=op.f("uq_remediations_finding_id"))
    )
    op.create_index(op.f("ix_remediations_finding_id"), "remediations", ["finding_id"], unique=False)
    op.create_index(op.f("ix_remediations_organization_id"), "remediations", ["organization_id"], unique=False)
    op.create_table("remediation_fixes",
    sa.Column("remediation_id", sa.Uuid(), nullable=False),
    sa.Column("position", sa.Integer(), nullable=False),
    sa.Column("kind", sa.String(length=20), nullable=False),
    sa.Column("title", sa.String(length=200), nullable=False),
    sa.Column("description", sa.Text(), nullable=False),
    sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("enforcement", sa.String(length=15), nullable=False),
    sa.Column("enforcement_note", sa.String(length=200), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["remediation_id"], ["remediations.id"], name=op.f("fk_remediation_fixes_remediation_id_remediations"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_remediation_fixes")),
    sa.UniqueConstraint("remediation_id", "position", name=op.f("uq_remediation_fixes_remediation_id"))
    )
    op.create_index(op.f("ix_remediation_fixes_remediation_id"), "remediation_fixes", ["remediation_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_remediation_fixes_remediation_id"), table_name="remediation_fixes")
    op.drop_table("remediation_fixes")
    op.drop_index(op.f("ix_remediations_organization_id"), table_name="remediations")
    op.drop_index(op.f("ix_remediations_finding_id"), table_name="remediations")
    op.drop_table("remediations")
    op.drop_index(op.f("ix_remediation_jobs_organization_id"), table_name="remediation_jobs")
    op.drop_index(op.f("ix_remediation_jobs_finding_id"), table_name="remediation_jobs")
    op.drop_table("remediation_jobs")
