"""User administration (FR-10.1): suspended memberships, and accounts suspended in every
organization by a Platform Administrator (UC-10.2).

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-21
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
    )
    op.add_column(
        "memberships", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("memberships", sa.Column("suspended_by_id", sa.Uuid(), nullable=True))
    op.add_column(
        "memberships", sa.Column("suspension_reason", sa.String(length=300), nullable=True)
    )
    op.add_column(
        "memberships",
        sa.Column(
            "suspended_by_platform", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.create_foreign_key(
        op.f("fk_memberships_suspended_by_id_users"),
        "memberships",
        "users",
        ["suspended_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("users", sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("suspension_reason", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "suspension_reason")
    op.drop_column("users", "suspended_at")
    op.drop_constraint(
        op.f("fk_memberships_suspended_by_id_users"), "memberships", type_="foreignkey"
    )
    op.drop_column("memberships", "suspended_by_platform")
    op.drop_column("memberships", "suspension_reason")
    op.drop_column("memberships", "suspended_by_id")
    op.drop_column("memberships", "suspended_at")
    op.drop_column("memberships", "status")
