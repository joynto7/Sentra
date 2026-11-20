"""Test suites (FR-4.4), one row per version (FR-4.5).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-13
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "test_suites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("origin", sa.String(length=20), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=10), server_default="active", nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("purpose", sa.String(length=300), nullable=False),
        sa.Column("tests", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("change_note", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_test_suites_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_test_suites")),
        sa.UniqueConstraint(
            "organization_id",
            "code",
            "version",
            name=op.f("uq_test_suites_organization_id"),
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index(
        "uq_test_suites_one_current",
        "test_suites",
        ["organization_id", "code"],
        unique=True,
        postgresql_where=sa.text("is_current"),
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_test_suites_one_current", table_name="test_suites", postgresql_where=sa.text("is_current")
    )
    op.drop_table("test_suites")
