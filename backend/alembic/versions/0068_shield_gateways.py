"""Sentra Shield gateways (FR-8.3, UC-8.1): one gateway per target, with its position, the hash
of its credential, what it reports about itself and the test request that proves it is in the
target's traffic path.

Revision ID: 0068
Revises: 0067
Create Date: 2026-10-31
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0068"
down_revision: str | None = "0067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shield_gateways",
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.String(length=15), nullable=False),
        sa.Column("status", sa.String(length=15), nullable=False),
        sa.Column("credential_prefix", sa.String(length=16), nullable=False),
        sa.Column("credential_hash", sa.String(length=64), nullable=False),
        sa.Column("gateway_version", sa.String(length=20), nullable=True),
        sa.Column("added_latency_ms", sa.Integer(), nullable=True),
        sa.Column("requests_seen", sa.Integer(), nullable=False),
        sa.Column("check_marker", sa.String(length=32), nullable=True),
        sa.Column("check_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_contact_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_shield_gateways_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_shield_gateways_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_shield_gateways_target_id_targets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shield_gateways")),
        sa.UniqueConstraint("target_id", name=op.f("uq_shield_gateways_target_id")),
    )
    op.create_index(
        op.f("ix_shield_gateways_organization_id"), "shield_gateways", ["organization_id"]
    )
    op.create_index(op.f("ix_shield_gateways_target_id"), "shield_gateways", ["target_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_shield_gateways_target_id"), table_name="shield_gateways")
    op.drop_index(op.f("ix_shield_gateways_organization_id"), table_name="shield_gateways")
    op.drop_table("shield_gateways")
