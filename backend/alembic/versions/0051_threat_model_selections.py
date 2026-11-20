"""Threat model selections and accepted gaps (FR-3.3, FR-3.4): the test suites saved as the default
for a target's new campaigns, the reasons for threats that no test covers, and the threat model
version each campaign is based on.

Revision ID: 0051
Revises: 0050
Create Date: 2026-10-30
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0051"
down_revision: str | None = "0050"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("threat_gap_acceptances",
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("threat_model_id", sa.Uuid(), nullable=False),
    sa.Column("threat_no", sa.Integer(), nullable=False),
    sa.Column("reason", sa.String(length=300), nullable=False),
    sa.Column("accepted_by_id", sa.Uuid(), nullable=True),
    sa.Column("accepted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["accepted_by_id"], ["users.id"], name=op.f("fk_threat_gap_acceptances_accepted_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_threat_gap_acceptances_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_threat_gap_acceptances_target_id_targets"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["threat_model_id"], ["threat_models.id"], name=op.f("fk_threat_gap_acceptances_threat_model_id_threat_models"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_threat_gap_acceptances"))
    )
    op.create_index(op.f("ix_threat_gap_acceptances_organization_id"), "threat_gap_acceptances", ["organization_id"], unique=False)
    op.create_index(op.f("ix_threat_gap_acceptances_target_id"), "threat_gap_acceptances", ["target_id"], unique=False)
    op.create_table("threat_model_selections",
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("threat_model_id", sa.Uuid(), nullable=False),
    sa.Column("suites", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("uncovered", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("saved_by_id", sa.Uuid(), nullable=True),
    sa.Column("saved_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_threat_model_selections_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["saved_by_id"], ["users.id"], name=op.f("fk_threat_model_selections_saved_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_threat_model_selections_target_id_targets"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["threat_model_id"], ["threat_models.id"], name=op.f("fk_threat_model_selections_threat_model_id_threat_models"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_threat_model_selections"))
    )
    op.create_index(op.f("ix_threat_model_selections_organization_id"), "threat_model_selections", ["organization_id"], unique=False)
    op.create_index(op.f("ix_threat_model_selections_target_id"), "threat_model_selections", ["target_id"], unique=False)
    op.add_column("campaigns", sa.Column("threat_model_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(op.f("fk_campaigns_threat_model_id_threat_models"), "campaigns", "threat_models", ["threat_model_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(op.f("fk_campaigns_threat_model_id_threat_models"), "campaigns", type_="foreignkey")
    op.drop_column("campaigns", "threat_model_id")
    op.drop_index(op.f("ix_threat_model_selections_target_id"), table_name="threat_model_selections")
    op.drop_index(op.f("ix_threat_model_selections_organization_id"), table_name="threat_model_selections")
    op.drop_table("threat_model_selections")
    op.drop_index(op.f("ix_threat_gap_acceptances_target_id"), table_name="threat_gap_acceptances")
    op.drop_index(op.f("ix_threat_gap_acceptances_organization_id"), table_name="threat_gap_acceptances")
    op.drop_table("threat_gap_acceptances")
