"""Benchmark runs and their repetitions (FR-11.3, UC-11.3, UC-11.4).

Revision ID: 0065
Revises: 0064
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0065"
down_revision: str | None = "0064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "benchmark_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("status_message", sa.Text(), nullable=False),
        sa.Column("strategies", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("attempt_budget", sa.Integer(), nullable=False),
        sa.Column("repetitions", sa.Integer(), nullable=False),
        sa.Column("judge_every_attempt", sa.Boolean(), nullable=False),
        sa.Column("baseline_id", sa.Uuid(), nullable=True),
        sa.Column("estimate", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("versions", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("order_seed", sa.Integer(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["baseline_id"],
            ["benchmark_runs.id"],
            name=op.f("fk_benchmark_runs_baseline_id_benchmark_runs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_benchmark_runs_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_benchmark_runs_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_benchmark_runs")),
        sa.UniqueConstraint("organization_id", "number", name=op.f("uq_benchmark_runs_organization_id")),
    )
    op.create_index(op.f("ix_benchmark_runs_organization_id"), "benchmark_runs", ["organization_id"])
    op.create_index(op.f("ix_benchmark_runs_status"), "benchmark_runs", ["status"])
    op.create_table(
        "benchmark_repetitions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("benchmark_run_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("strategy_key", sa.String(length=20), nullable=False),
        sa.Column("repetition", sa.Integer(), nullable=False),
        sa.Column("order_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("campaign_run_id", sa.Uuid(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts_sent", sa.Integer(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.ForeignKeyConstraint(
            ["benchmark_run_id"],
            ["benchmark_runs.id"],
            name=op.f("fk_benchmark_repetitions_benchmark_run_id_benchmark_runs"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["campaign_run_id"],
            ["campaign_runs.id"],
            name=op.f("fk_benchmark_repetitions_campaign_run_id_campaign_runs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_benchmark_repetitions_target_id_targets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_benchmark_repetitions")),
        sa.UniqueConstraint("campaign_run_id", name=op.f("uq_benchmark_repetitions_campaign_run_id")),
        sa.UniqueConstraint(
            "benchmark_run_id",
            "target_id",
            "strategy_key",
            "repetition",
            name="uq_benchmark_repetitions_one",
        ),
    )
    op.create_index(
        "ix_benchmark_repetitions_order", "benchmark_repetitions", ["benchmark_run_id", "order_no"]
    )


def downgrade() -> None:
    op.drop_index("ix_benchmark_repetitions_order", table_name="benchmark_repetitions")
    op.drop_table("benchmark_repetitions")
    op.drop_index(op.f("ix_benchmark_runs_status"), table_name="benchmark_runs")
    op.drop_index(op.f("ix_benchmark_runs_organization_id"), table_name="benchmark_runs")
    op.drop_table("benchmark_runs")
