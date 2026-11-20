"""Severity ratings and risk scores (FR-7.1, FR-7.2): the severity a finding was given with the
factors it was calculated from, and every risk score of a target with its time and its trigger,
so that the score's trend can be shown.

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "risk_scores",
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("score", sa.SmallInteger(), nullable=False),
        sa.Column("band", sa.String(length=15), nullable=False),
        sa.Column("counted", sa.Integer(), nullable=False),
        sa.Column(
            "counted_by_severity", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("awaiting_confirmation", sa.Integer(), nullable=False),
        sa.Column("counted_codes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("factors", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("trigger", sa.String(length=20), nullable=False),
        sa.Column("campaign_run_id", sa.Uuid(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["campaign_run_id"],
            ["campaign_runs.id"],
            name=op.f("fk_risk_scores_campaign_run_id_campaign_runs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_risk_scores_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_risk_scores_target_id_targets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_risk_scores")),
    )
    op.create_index(
        op.f("ix_risk_scores_organization_id"), "risk_scores", ["organization_id"], unique=False
    )
    op.create_index(
        "ix_risk_scores_target_calculated",
        "risk_scores",
        ["target_id", "calculated_at"],
        unique=False,
    )
    op.add_column(
        "findings", sa.Column("calculated_severity", sa.String(length=15), nullable=True)
    )
    op.add_column(
        "findings",
        sa.Column(
            "severity_factors",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "findings",
        sa.Column(
            "severity_provisional",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "findings", sa.Column("severity_rated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "findings",
        sa.Column(
            "severity_adjusted", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.add_column(
        "findings", sa.Column("reproducibility", sa.Numeric(precision=4, scale=3), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("findings", "reproducibility")
    op.drop_column("findings", "severity_adjusted")
    op.drop_column("findings", "severity_rated_at")
    op.drop_column("findings", "severity_provisional")
    op.drop_column("findings", "severity_factors")
    op.drop_column("findings", "calculated_severity")
    op.drop_index("ix_risk_scores_target_calculated", table_name="risk_scores")
    op.drop_index(op.f("ix_risk_scores_organization_id"), table_name="risk_scores")
    op.drop_table("risk_scores")
