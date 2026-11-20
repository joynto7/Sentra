"""The system alerts and the alert thresholds (FR-10.6, UC-10.9).

Revision ID: 0063
Revises: 0062
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0063"
down_revision: str | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "system_alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("component", sa.String(length=30), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("summary", sa.String(length=200), nullable=False),
        sa.Column("effect", sa.String(length=300), nullable=False),
        sa.Column("detail", sa.dialects.postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "opened_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("repeats", sa.Integer(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_automatically", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_system_alerts")),
    )
    op.create_index(op.f("ix_system_alerts_opened_at"), "system_alerts", ["opened_at"])
    # One open alert per component and cause, so the same thing is never reported twice.
    op.create_index(
        "uq_system_alerts_open",
        "system_alerts",
        ["component", "kind"],
        unique=True,
        postgresql_where=sa.text("closed_at IS NULL"),
    )
    op.create_table(
        "health_thresholds",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("queue_length", sa.Integer(), nullable=False),
        sa.Column("error_rate_percent", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("worker_load_percent", sa.Integer(), nullable=False),
        sa.Column("storage_percent", sa.Integer(), nullable=False),
        sa.Column("gateway_silence_minutes", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("set_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["set_by_id"],
            ["users.id"],
            name=op.f("fk_health_thresholds_set_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_health_thresholds")),
    )


def downgrade() -> None:
    op.drop_table("health_thresholds")
    op.drop_index("uq_system_alerts_open", table_name="system_alerts")
    op.drop_index(op.f("ix_system_alerts_opened_at"), table_name="system_alerts")
    op.drop_table("system_alerts")
