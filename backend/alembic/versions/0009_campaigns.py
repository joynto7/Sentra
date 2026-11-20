"""Campaigns (FR-5.1).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-13
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("suites", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("adaptive_agent", sa.Boolean(), nullable=False),
        sa.Column("attempt_budget", sa.Integer(), nullable=False),
        sa.Column("request_rate", sa.Integer(), nullable=False),
        sa.Column("repetitions", sa.Integer(), nullable=False),
        sa.Column("window_start", sa.Time(), nullable=True),
        sa.Column("window_end", sa.Time(), nullable=True),
        sa.Column("time_zone", sa.String(length=64), nullable=False),
        sa.Column(
            "approval_status", sa.String(length=20), server_default="not_required", nullable=False
        ),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_campaigns_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_campaigns_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_campaigns_target_id_targets"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_campaigns")),
        sa.UniqueConstraint("organization_id", "number", name=op.f("uq_campaigns_organization_id")),
    )
    op.create_index(
        op.f("ix_campaigns_organization_id"), "campaigns", ["organization_id"], unique=False
    )
    op.create_index(op.f("ix_campaigns_target_id"), "campaigns", ["target_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_campaigns_target_id"), table_name="campaigns")
    op.drop_index(op.f("ix_campaigns_organization_id"), table_name="campaigns")
    op.drop_table("campaigns")
