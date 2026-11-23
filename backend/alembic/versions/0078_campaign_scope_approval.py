"""Scope approval of a campaign (FR-5.2, UC-5.2): the organization's requirement and the history
of every submission and decision.

Revision ID: 0078
Revises: 0077
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0078"
down_revision: str | None = "0077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column(
            "requires_scope_approval",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.create_table(
        "campaign_approvals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_campaign_approvals_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["campaign_id"],
            ["campaigns.id"],
            name=op.f("fk_campaign_approvals_campaign_id_campaigns"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_campaign_approvals_actor_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_campaign_approvals")),
    )
    op.create_index(
        op.f("ix_campaign_approvals_organization_id"), "campaign_approvals", ["organization_id"]
    )
    op.create_index(op.f("ix_campaign_approvals_campaign_id"), "campaign_approvals", ["campaign_id"])
    op.create_index(
        "ix_campaign_approvals_campaign", "campaign_approvals", ["campaign_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_campaign_approvals_campaign", table_name="campaign_approvals")
    op.drop_index(op.f("ix_campaign_approvals_campaign_id"), table_name="campaign_approvals")
    op.drop_index(op.f("ix_campaign_approvals_organization_id"), table_name="campaign_approvals")
    op.drop_table("campaign_approvals")
    op.drop_column("organizations", "requires_scope_approval")
