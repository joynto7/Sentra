"""Multi-method detection (FR-6.1): the result of each detection method for each attempt, stored
separately, and the combined verdict of each attempt.

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-30
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("detection_results",
    sa.Column("attempt_id", sa.Uuid(), nullable=False),
    sa.Column("method", sa.String(length=30), nullable=False),
    sa.Column("role", sa.String(length=15), nullable=False),
    sa.Column("outcome", sa.String(length=15), nullable=False),
    sa.Column("summary", sa.Text(), nullable=False),
    sa.Column("checks", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("duration_ms", sa.Integer(), nullable=True),
    sa.Column("confidence", sa.Numeric(precision=4, scale=3), nullable=True),
    sa.Column("reasoning", sa.Text(), nullable=True),
    sa.Column("judge_model", sa.String(length=200), nullable=True),
    sa.Column("judge_deployment", sa.String(length=10), nullable=True),
    sa.Column("instructions_version", sa.String(length=20), nullable=True),
    sa.Column("instructions_sha256", sa.String(length=64), nullable=True),
    sa.Column("tries", sa.SmallInteger(), nullable=False),
    sa.Column("error", sa.Text(), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["attempt_id"], ["attempts.id"], name=op.f("fk_detection_results_attempt_id_attempts"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_detection_results_organization_id_organizations"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_detection_results")),
    sa.UniqueConstraint("attempt_id", "method", name=op.f("uq_detection_results_attempt_id"))
    )
    op.create_index(op.f("ix_detection_results_organization_id"), "detection_results", ["organization_id"], unique=False)
    op.create_table("detection_verdicts",
    sa.Column("attempt_id", sa.Uuid(), nullable=False),
    sa.Column("campaign_run_id", sa.Uuid(), nullable=False),
    sa.Column("outcome", sa.String(length=15), nullable=False),
    sa.Column("decided_by", sa.String(length=15), nullable=True),
    sa.Column("requires_confirmation", sa.Boolean(), nullable=False),
    sa.Column("disagreement", sa.Boolean(), nullable=False),
    sa.Column("summary", sa.Text(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["attempt_id"], ["attempts.id"], name=op.f("fk_detection_verdicts_attempt_id_attempts"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["campaign_run_id"], ["campaign_runs.id"], name=op.f("fk_detection_verdicts_campaign_run_id_campaign_runs"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_detection_verdicts_organization_id_organizations"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("attempt_id", name=op.f("pk_detection_verdicts"))
    )
    op.create_index("ix_detection_verdicts_run_outcome", "detection_verdicts", ["campaign_run_id", "outcome"], unique=False)
    op.create_index(op.f("ix_detection_verdicts_organization_id"), "detection_verdicts", ["organization_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_detection_verdicts_organization_id"), table_name="detection_verdicts")
    op.drop_index("ix_detection_verdicts_run_outcome", table_name="detection_verdicts")
    op.drop_table("detection_verdicts")
    op.drop_index(op.f("ix_detection_results_organization_id"), table_name="detection_results")
    op.drop_table("detection_results")
