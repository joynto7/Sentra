"""The autopilot: one row per assessment it runs, with its stage and its story.

Revision ID: 0081
Revises: 0080
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0081"
down_revision: str | None = "0080"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "autopilot_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("started_by_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("stage", sa.String(length=15), nullable=False),
        sa.Column("waiting_for", sa.String(length=30), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("state", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("steps", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("campaign_id", sa.Uuid(), nullable=True),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["campaign_id"],
            ["campaigns.id"],
            name=op.f("fk_autopilot_runs_campaign_id_campaigns"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_autopilot_runs_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["campaign_runs.id"],
            name=op.f("fk_autopilot_runs_run_id_campaign_runs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["started_by_id"],
            ["users.id"],
            name=op.f("fk_autopilot_runs_started_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_autopilot_runs_target_id_targets"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_autopilot_runs")),
        sa.UniqueConstraint(
            "organization_id", "number", name=op.f("uq_autopilot_runs_organization_id")
        ),
    )
    op.create_index(
        op.f("ix_autopilot_runs_organization_id"), "autopilot_runs", ["organization_id"]
    )
    op.create_index(op.f("ix_autopilot_runs_target_id"), "autopilot_runs", ["target_id"])
    op.create_index("ix_autopilot_runs_status", "autopilot_runs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_autopilot_runs_status", table_name="autopilot_runs")
    op.drop_index(op.f("ix_autopilot_runs_target_id"), table_name="autopilot_runs")
    op.drop_index(op.f("ix_autopilot_runs_organization_id"), table_name="autopilot_runs")
    op.drop_table("autopilot_runs")
