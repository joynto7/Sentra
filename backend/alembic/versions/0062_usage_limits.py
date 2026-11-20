"""An organization's monthly limits and the warnings it was sent (FR-10.4, UC-10.6).

Revision ID: 0062
Revises: 0061
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0062"
down_revision: str | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NULL means the platform's default from the settings (UC-10.6, 1a1).
    op.add_column("organizations", sa.Column("limit_campaign_runs", sa.Integer(), nullable=True))
    op.add_column("organizations", sa.Column("limit_attempts", sa.Integer(), nullable=True))
    op.add_column(
        "organizations",
        sa.Column("limit_llm_cost_usd", sa.Numeric(precision=12, scale=2), nullable=True),
    )
    op.add_column("organizations", sa.Column("limit_warn_percent", sa.Integer(), nullable=True))
    op.create_table(
        "usage_limit_warnings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("month", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("used_percent", sa.Integer(), nullable=False),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_usage_limit_warnings_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_usage_limit_warnings")),
        sa.UniqueConstraint(
            "organization_id", "month", "kind", name="uq_usage_limit_warnings_month_kind"
        ),
    )
    op.create_index(
        op.f("ix_usage_limit_warnings_organization_id"), "usage_limit_warnings", ["organization_id"]
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_usage_limit_warnings_organization_id"), table_name="usage_limit_warnings"
    )
    op.drop_table("usage_limit_warnings")
    op.drop_column("organizations", "limit_warn_percent")
    op.drop_column("organizations", "limit_llm_cost_usd")
    op.drop_column("organizations", "limit_attempts")
    op.drop_column("organizations", "limit_campaign_runs")
