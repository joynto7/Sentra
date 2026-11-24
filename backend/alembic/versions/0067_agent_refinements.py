"""What the adaptive testing agent did in a campaign run (FR-5.5, UC-5.5).

Revision ID: 0067
Revises: 0066
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0067"
down_revision: str | None = "0066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_refinements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_run_id", sa.Uuid(), nullable=False),
        sa.Column("after_attempt_id", sa.Uuid(), nullable=True),
        sa.Column("attempt_id", sa.Uuid(), nullable=True),
        sa.Column("test_code", sa.String(length=40), nullable=False),
        sa.Column("state", sa.String(length=15), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("instructions_version", sa.String(length=20), nullable=True),
        sa.Column("model", sa.String(length=200), nullable=True),
        sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["after_attempt_id"],
            ["attempts.id"],
            name=op.f("fk_agent_refinements_after_attempt_id_attempts"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["attempts.id"],
            name=op.f("fk_agent_refinements_attempt_id_attempts"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["campaign_run_id"],
            ["campaign_runs.id"],
            name=op.f("fk_agent_refinements_campaign_run_id_campaign_runs"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_agent_refinements_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agent_refinements")),
    )
    op.create_index(
        op.f("ix_agent_refinements_organization_id"), "agent_refinements", ["organization_id"]
    )
    op.create_index(
        "ix_agent_refinements_run", "agent_refinements", ["campaign_run_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_agent_refinements_run", table_name="agent_refinements")
    op.drop_index(op.f("ix_agent_refinements_organization_id"), table_name="agent_refinements")
    op.drop_table("agent_refinements")
