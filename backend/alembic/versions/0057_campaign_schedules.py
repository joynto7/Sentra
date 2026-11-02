"""Campaign schedules (FR-5.3): when a campaign runs by itself, once or on a recurring schedule,
and what came of its last moment.

Revision ID: 0057
Revises: 0056
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0057"
down_revision: str | None = "0056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "campaign_schedules",
        sa.Column("campaign_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("frequency", sa.String(length=10), nullable=True),
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("at_time", sa.Time(), nullable=True),
        sa.Column("weekday", sa.SmallInteger(), nullable=True),
        sa.Column("day_of_month", sa.SmallInteger(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_result", sa.String(length=10), nullable=True),
        sa.Column("last_message", sa.Text(), server_default="", nullable=False),
        sa.Column("last_run_id", sa.Uuid(), nullable=True),
        sa.Column("misses", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False
        ),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28",
            name=op.f("ck_campaign_schedules_schedule_day_of_month"),
        ),
        sa.CheckConstraint(
            "weekday IS NULL OR weekday BETWEEN 0 AND 6",
            name=op.f("ck_campaign_schedules_schedule_weekday"),
        ),
        sa.ForeignKeyConstraint(
            ["campaign_id"],
            ["campaigns.id"],
            name=op.f("fk_campaign_schedules_campaign_id_campaigns"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_campaign_schedules_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["last_run_id"],
            ["campaign_runs.id"],
            name=op.f("fk_campaign_schedules_last_run_id_campaign_runs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_campaign_schedules_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_campaign_schedules")),
        sa.UniqueConstraint("campaign_id", name=op.f("uq_campaign_schedules_campaign_id")),
    )
    op.create_index(
        "ix_campaign_schedules_due",
        "campaign_schedules",
        ["status", "next_run_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_campaign_schedules_organization_id"),
        "campaign_schedules",
        ["organization_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_campaign_schedules_organization_id"), table_name="campaign_schedules"
    )
    op.drop_index("ix_campaign_schedules_due", table_name="campaign_schedules")
    op.drop_table("campaign_schedules")
