"""Targets and their encrypted connection credentials (FR-2.1, FR-2.2).

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-12
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "targets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("endpoint_url", sa.String(length=2048), nullable=False),
        sa.Column("environment", sa.String(length=20), nullable=False),
        sa.Column("max_request_rate", sa.Integer(), nullable=False),
        sa.Column("request_template", sa.Text(), nullable=True),
        sa.Column("response_template", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="unverified", nullable=False),
        sa.Column("verification_token", sa.String(length=64), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_targets_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_targets_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_targets")),
    )
    op.create_index(op.f("ix_targets_organization_id"), "targets", ["organization_id"], unique=False)
    op.create_table(
        "target_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("credential_type", sa.String(length=20), nullable=False),
        sa.Column("encrypted_value", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_target_credentials_target_id_targets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_target_credentials")),
        sa.UniqueConstraint("target_id", "name", name=op.f("uq_target_credentials_target_id")),
    )
    op.create_index(
        op.f("ix_target_credentials_target_id"), "target_credentials", ["target_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_target_credentials_target_id"), table_name="target_credentials")
    op.drop_table("target_credentials")
    op.drop_index(op.f("ix_targets_organization_id"), table_name="targets")
    op.drop_table("targets")
