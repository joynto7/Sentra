"""Custom tests (FR-4.3): retired flag, success rules, codes unique per organization.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-13
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "test_definitions",
        sa.Column("retired", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "test_definitions",
        sa.Column(
            "success_rules",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    # Codes were unique across Sentra; custom tests only need them unique per organization.
    op.drop_constraint(op.f("uq_test_definitions_code"), "test_definitions", type_="unique")
    op.create_unique_constraint(
        op.f("uq_test_definitions_organization_id"),
        "test_definitions",
        ["organization_id", "code", "version"],
        postgresql_nulls_not_distinct=True,
    )
    op.create_index(
        "uq_test_definitions_one_current",
        "test_definitions",
        ["organization_id", "code"],
        unique=True,
        postgresql_where=sa.text("is_current"),
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_test_definitions_one_current",
        table_name="test_definitions",
        postgresql_where=sa.text("is_current"),
    )
    op.drop_constraint(
        op.f("uq_test_definitions_organization_id"), "test_definitions", type_="unique"
    )
    op.create_unique_constraint(
        op.f("uq_test_definitions_code"), "test_definitions", ["code", "version"]
    )
    op.drop_column("test_definitions", "success_rules")
    op.drop_column("test_definitions", "retired")
