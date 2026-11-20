"""Notifications and notification preferences (FR-9.3).

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-14
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("event", sa.String(length=40), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("subject", sa.String(length=120), nullable=False),
        sa.Column("link", sa.String(length=300), nullable=True),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("group_key", sa.String(length=120), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "last_event_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_notifications_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notifications_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
    )
    op.create_index(
        "ix_notifications_user_id_read_at", "notifications", ["user_id", "read_at"], unique=False
    )
    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event", sa.String(length=40), nullable=False),
        sa.Column("in_app", sa.Boolean(), nullable=False),
        sa.Column("email", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notification_preferences_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_preferences")),
        sa.UniqueConstraint(
            "user_id", "event", name=op.f("uq_notification_preferences_user_id")
        ),
    )


def downgrade() -> None:
    op.drop_table("notification_preferences")
    op.drop_index("ix_notifications_user_id_read_at", table_name="notifications")
    op.drop_table("notifications")
