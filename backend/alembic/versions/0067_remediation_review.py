"""Review and approval of a remediation proposal (FR-8.2, UC-8.3): who adapted a version, when it
was sent for approval, who decided and why, and the thread the proposal is discussed in.

Revision ID: 0067
Revises: 0066
Create Date: 2026-10-31
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0067"
down_revision: str | None = "0066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("remediations", sa.Column("edited_by_id", sa.Uuid(), nullable=True))
    op.add_column(
        "remediations", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("remediations", sa.Column("decided_by_id", sa.Uuid(), nullable=True))
    op.add_column(
        "remediations", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("remediations", sa.Column("decision_reason", sa.Text(), nullable=True))
    op.create_foreign_key(
        op.f("fk_remediations_edited_by_id_users"),
        "remediations",
        "users",
        ["edited_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_remediations_decided_by_id_users"),
        "remediations",
        "users",
        ["decided_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "remediation_comments",
        sa.Column("finding_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_remediation_comments_author_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["finding_id"],
            ["findings.id"],
            name=op.f("fk_remediation_comments_finding_id_findings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_remediation_comments_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_remediation_comments")),
    )
    op.create_index(
        op.f("ix_remediation_comments_finding_id"),
        "remediation_comments",
        ["finding_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_remediation_comments_organization_id"),
        "remediation_comments",
        ["organization_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_remediation_comments_organization_id"), table_name="remediation_comments")
    op.drop_index(op.f("ix_remediation_comments_finding_id"), table_name="remediation_comments")
    op.drop_table("remediation_comments")
    op.drop_constraint(
        op.f("fk_remediations_decided_by_id_users"), "remediations", type_="foreignkey"
    )
    op.drop_constraint(
        op.f("fk_remediations_edited_by_id_users"), "remediations", type_="foreignkey"
    )
    op.drop_column("remediations", "decision_reason")
    op.drop_column("remediations", "decided_at")
    op.drop_column("remediations", "decided_by_id")
    op.drop_column("remediations", "submitted_at")
    op.drop_column("remediations", "edited_by_id")
