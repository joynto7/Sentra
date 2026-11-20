"""Profile (FR-1.7): phone, a pending new e-mail address, when the password changed, and the
account's security events.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-13
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("pending_email", sa.String(length=320), nullable=True))
    op.add_column(
        "users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True)
    )
    # Existing accounts set their password when they were created.
    op.execute("UPDATE users SET password_changed_at = created_at")
    op.create_table(
        "account_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_account_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_events")),
    )
    op.create_index(
        op.f("ix_account_events_user_id"), "account_events", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_account_events_user_id"), table_name="account_events")
    op.drop_table("account_events")
    op.drop_column("users", "password_changed_at")
    op.drop_column("users", "pending_email")
    op.drop_column("users", "phone")
