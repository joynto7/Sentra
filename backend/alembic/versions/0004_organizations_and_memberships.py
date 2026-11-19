"""Memberships, and the organization a session and a user work in (FR-1.4).

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-12
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "memberships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_memberships_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_memberships_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_memberships")),
        sa.UniqueConstraint("user_id", "organization_id", name=op.f("uq_memberships_user_id")),
    )
    op.create_index(op.f("ix_memberships_user_id"), "memberships", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_memberships_organization_id"), "memberships", ["organization_id"], unique=False
    )
    op.add_column("users", sa.Column("last_organization_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_users_last_organization_id_organizations"),
        "users",
        "organizations",
        ["last_organization_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("sessions", sa.Column("organization_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_sessions_organization_id_organizations"),
        "sessions",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_sessions_organization_id_organizations"), "sessions", type_="foreignkey"
    )
    op.drop_column("sessions", "organization_id")
    op.drop_constraint(
        op.f("fk_users_last_organization_id_organizations"), "users", type_="foreignkey"
    )
    op.drop_column("users", "last_organization_id")
    op.drop_index(op.f("ix_memberships_organization_id"), table_name="memberships")
    op.drop_index(op.f("ix_memberships_user_id"), table_name="memberships")
    op.drop_table("memberships")
