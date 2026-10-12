"""Test definitions with versions (FR-4.2, FR-4.5).

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-12
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "test_definitions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("origin", sa.String(length=20), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=5), nullable=False),
        sa.Column("severity", sa.String(length=15), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("prerequisites", sa.Text(), nullable=False),
        sa.Column("target_types", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("success_condition", sa.Text(), nullable=False),
        sa.Column("detection_methods", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("attempt_template", sa.String(length=80), nullable=False),
        sa.Column("recommended_mitigation", sa.Text(), nullable=False),
        sa.Column("atlas", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("change_note", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_test_definitions_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_test_definitions")),
        sa.UniqueConstraint("code", "version", name=op.f("uq_test_definitions_code")),
    )
    op.create_index("ix_test_definitions_current", "test_definitions", ["is_current"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_test_definitions_current", table_name="test_definitions")
    op.drop_table("test_definitions")
