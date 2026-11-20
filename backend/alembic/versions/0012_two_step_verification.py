"""Two-step verification (FR-1.2): the users' authenticator secrets and recovery codes, the
organizations' requirement, and when a session last confirmed the password. Failed logins are
counted per typed address instead of per account, so a lock reveals no account (FR-1.1).

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-14
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mfa_secret", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("mfa_pending_secret", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("mfa_enabled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("mfa_last_step", sa.BigInteger(), nullable=True))
    op.add_column(
        "organizations",
        sa.Column("mfa_required", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "sessions", sa.Column("password_confirmed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_table(
        "recovery_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_recovery_codes_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recovery_codes")),
    )
    op.create_index(
        op.f("ix_recovery_codes_user_id"), "recovery_codes", ["user_id"], unique=False
    )
    op.create_table(
        "login_throttles",
        sa.Column("email_hash", sa.String(length=64), nullable=False),
        sa.Column("failures", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("email_hash", name=op.f("pk_login_throttles")),
    )
    op.create_index(
        op.f("ix_login_throttles_updated_at"), "login_throttles", ["updated_at"], unique=False
    )
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_count")


def downgrade() -> None:
    op.add_column(
        "users",
        sa.Column("failed_login_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))
    op.drop_index(op.f("ix_login_throttles_updated_at"), table_name="login_throttles")
    op.drop_table("login_throttles")
    op.drop_index(op.f("ix_recovery_codes_user_id"), table_name="recovery_codes")
    op.drop_table("recovery_codes")
    op.drop_column("sessions", "password_confirmed_at")
    op.drop_column("organizations", "mfa_required")
    op.drop_column("users", "mfa_last_step")
    op.drop_column("users", "mfa_enabled_at")
    op.drop_column("users", "mfa_pending_secret")
    op.drop_column("users", "mfa_secret")
