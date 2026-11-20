"""Campaign runs (FR-5.4, FR-5.6, FR-5.7): each run of a campaign with the versions it uses, its
limits, pause and stop, and its attempts; and the campaign run that an LLM request served, for the
run's cost.

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-29
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("campaign_runs",
    sa.Column("campaign_id", sa.Uuid(), nullable=True),
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("number", sa.Integer(), nullable=False),
    sa.Column("run_type", sa.String(length=20), nullable=False),
    sa.Column("trigger", sa.String(length=20), nullable=False),
    sa.Column("status", sa.String(length=20), nullable=False),
    sa.Column("status_message", sa.Text(), nullable=False),
    sa.Column("end_reason", sa.String(length=30), nullable=True),
    sa.Column("launched_by_id", sa.Uuid(), nullable=True),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("ended_by_id", sa.Uuid(), nullable=True),
    sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("versions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("plan", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("attempt_budget", sa.Integer(), nullable=False),
    sa.Column("request_rate", sa.Integer(), nullable=False),
    sa.Column("attempts_planned", sa.Integer(), nullable=False),
    sa.Column("attempts_sent", sa.Integer(), nullable=False),
    sa.Column("attempts_replied", sa.Integer(), nullable=False),
    sa.Column("attempts_failed", sa.Integer(), nullable=False),
    sa.Column("cost_usd", sa.Numeric(precision=12, scale=6), nullable=False),
    sa.Column("overloads_in_a_row", sa.Integer(), nullable=False),
    sa.Column("errors_in_a_row", sa.Integer(), nullable=False),
    sa.Column("retries", sa.Integer(), nullable=False),
    sa.Column("worker_errors", sa.Integer(), nullable=False),
    sa.Column("window_ends_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("paused_by_id", sa.Uuid(), nullable=True),
    sa.Column("pause_kind", sa.String(length=10), nullable=True),
    sa.Column("wake_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("dispatch_token", sa.Uuid(), nullable=True),
    sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("lease_owner", sa.Uuid(), nullable=True),
    sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
    sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("ownership_check_id", sa.Uuid(), nullable=True),
    sa.Column("hook_errors", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.CheckConstraint("attempts_sent <= attempt_budget", name=op.f("ck_campaign_runs_within_budget")),
    sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], name=op.f("fk_campaign_runs_campaign_id_campaigns"), ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["ended_by_id"], ["users.id"], name=op.f("fk_campaign_runs_ended_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["launched_by_id"], ["users.id"], name=op.f("fk_campaign_runs_launched_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_campaign_runs_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["ownership_check_id"], ["ownership_verifications.id"], name=op.f("fk_campaign_runs_ownership_check_id_ownership_verifications"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["paused_by_id"], ["users.id"], name=op.f("fk_campaign_runs_paused_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_campaign_runs_target_id_targets"), ondelete="RESTRICT"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_campaign_runs")),
    sa.UniqueConstraint("campaign_id", "number", name=op.f("uq_campaign_runs_campaign_id"))
    )
    op.create_index("ix_campaign_runs_organization_created", "campaign_runs", ["organization_id", "created_at"], unique=False)
    op.create_index(op.f("ix_campaign_runs_organization_id"), "campaign_runs", ["organization_id"], unique=False)
    op.create_index(op.f("ix_campaign_runs_status"), "campaign_runs", ["status"], unique=False)
    op.create_index(op.f("ix_campaign_runs_target_id"), "campaign_runs", ["target_id"], unique=False)
    op.create_index("uq_campaign_runs_one_active", "campaign_runs", ["campaign_id"], unique=True, postgresql_where=sa.text("status IN ('queued', 'running', 'paused')"))
    op.create_table("attempts",
    sa.Column("campaign_run_id", sa.Uuid(), nullable=False),
    sa.Column("attempt_no", sa.Integer(), nullable=False),
    sa.Column("test_definition_id", sa.Uuid(), nullable=False),
    sa.Column("test_code", sa.String(length=40), nullable=False),
    sa.Column("suite_code", sa.String(length=40), nullable=True),
    sa.Column("template", sa.String(length=80), nullable=False),
    sa.Column("variant", sa.Integer(), nullable=False),
    sa.Column("priority", sa.SmallInteger(), nullable=False),
    sa.Column("retry_of_id", sa.Uuid(), nullable=True),
    sa.Column("status", sa.String(length=15), nullable=False),
    sa.Column("input", sa.Text(), nullable=False),
    sa.Column("session_id", sa.String(length=64), nullable=False),
    sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("status_code", sa.Integer(), nullable=True),
    sa.Column("duration_ms", sa.Integer(), nullable=True),
    sa.Column("reply", sa.Text(), nullable=True),
    sa.Column("reply_length", sa.Integer(), nullable=True),
    sa.Column("tool_calls", sa.Text(), nullable=True),
    sa.Column("error_kind", sa.String(length=20), nullable=True),
    sa.Column("error_message", sa.Text(), nullable=True),
    sa.Column("refinement_reason", sa.Text(), nullable=True),
    sa.Column("hook_errors", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["campaign_run_id"], ["campaign_runs.id"], name=op.f("fk_attempts_campaign_run_id_campaign_runs"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_attempts_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["retry_of_id"], ["attempts.id"], name=op.f("fk_attempts_retry_of_id_attempts"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["test_definition_id"], ["test_definitions.id"], name=op.f("fk_attempts_test_definition_id_test_definitions"), ondelete="RESTRICT"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_attempts")),
    sa.UniqueConstraint("campaign_run_id", "attempt_no", name=op.f("uq_attempts_campaign_run_id"))
    )
    op.create_index("ix_attempts_next", "attempts", ["campaign_run_id", "status", "priority", "attempt_no"], unique=False)
    op.create_index(op.f("ix_attempts_organization_id"), "attempts", ["organization_id"], unique=False)
    op.create_index("ix_attempts_organization_sent", "attempts", ["organization_id", "sent_at"], unique=False)
    op.create_index("ix_attempts_run_sent", "attempts", ["campaign_run_id", "sent_at"], unique=False)
    op.add_column("llm_usage", sa.Column("campaign_run_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_llm_usage_campaign_run_id"), "llm_usage", ["campaign_run_id"], unique=False)
    op.create_foreign_key(op.f("fk_llm_usage_campaign_run_id_campaign_runs"), "llm_usage", "campaign_runs", ["campaign_run_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(op.f("fk_llm_usage_campaign_run_id_campaign_runs"), "llm_usage", type_="foreignkey")
    op.drop_index(op.f("ix_llm_usage_campaign_run_id"), table_name="llm_usage")
    op.drop_column("llm_usage", "campaign_run_id")
    op.drop_index("ix_attempts_run_sent", table_name="attempts")
    op.drop_index("ix_attempts_organization_sent", table_name="attempts")
    op.drop_index(op.f("ix_attempts_organization_id"), table_name="attempts")
    op.drop_index("ix_attempts_next", table_name="attempts")
    op.drop_table("attempts")
    op.drop_index("uq_campaign_runs_one_active", table_name="campaign_runs", postgresql_where=sa.text("status IN ('queued', 'running', 'paused')"))
    op.drop_index(op.f("ix_campaign_runs_target_id"), table_name="campaign_runs")
    op.drop_index(op.f("ix_campaign_runs_status"), table_name="campaign_runs")
    op.drop_index(op.f("ix_campaign_runs_organization_id"), table_name="campaign_runs")
    op.drop_index("ix_campaign_runs_organization_created", table_name="campaign_runs")
    op.drop_table("campaign_runs")
