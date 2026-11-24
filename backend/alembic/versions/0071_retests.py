"""Verification (FR-8.4, FR-8.5; UC-8.5 to UC-8.7): the changes a remediation needs inside the
application and when a developer marked each of them, the retest of a remediation version with
the figures before and after it, the requests of normal use it sent and what the fix did to each
of them, and the Benign Request Set of a target those requests come from (Screen 22).

Revision ID: 0071
Revises: 0070
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0071"
down_revision: str | None = "0070"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "target_benign_requests",
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name=op.f("fk_target_benign_requests_created_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_target_benign_requests_target_id_targets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_target_benign_requests")),
        sa.UniqueConstraint(
            "target_id", "position", name=op.f("uq_target_benign_requests_target_id")
        ),
    )
    op.create_index(
        op.f("ix_target_benign_requests_target_id"),
        "target_benign_requests",
        ["target_id"],
        unique=False,
    )
    op.create_table(
        "retests",
        sa.Column("finding_id", sa.Uuid(), nullable=False),
        sa.Column("remediation_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("campaign_run_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("verdict", sa.String(length=15), nullable=True),
        sa.Column("policy_version", sa.Integer(), nullable=True),
        sa.Column("changes_marked", sa.Integer(), nullable=False),
        sa.Column("test_code", sa.String(length=40), nullable=False),
        sa.Column("repetitions", sa.Integer(), nullable=False),
        sa.Column("replayed", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("before_attempts", sa.Integer(), nullable=False),
        sa.Column("before_successes", sa.Integer(), nullable=False),
        sa.Column("after_attempts", sa.Integer(), nullable=False),
        sa.Column("after_successes", sa.Integer(), nullable=False),
        sa.Column("after_unevaluated", sa.Integer(), nullable=False),
        sa.Column("risk_before", sa.Integer(), nullable=True),
        sa.Column("risk_band_before", sa.String(length=15), nullable=True),
        sa.Column("risk_after", sa.Integer(), nullable=True),
        sa.Column("risk_band_after", sa.String(length=15), nullable=True),
        sa.Column("benign_total", sa.Integer(), nullable=False),
        sa.Column("benign_blocked", sa.Integer(), nullable=False),
        sa.Column("benign_changed", sa.Integer(), nullable=False),
        sa.Column("benign_failed", sa.Integer(), nullable=False),
        sa.Column("benign_generic", sa.Boolean(), nullable=False),
        sa.Column("conclusion", sa.Text(), nullable=True),
        sa.Column("started_by_id", sa.Uuid(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("out_of_date", sa.Boolean(), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["campaign_run_id"],
            ["campaign_runs.id"],
            name=op.f("fk_retests_campaign_run_id_campaign_runs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["finding_id"],
            ["findings.id"],
            name=op.f("fk_retests_finding_id_findings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_retests_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["remediation_id"],
            ["remediations.id"],
            name=op.f("fk_retests_remediation_id_remediations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["started_by_id"],
            ["users.id"],
            name=op.f("fk_retests_started_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_retests")),
        sa.UniqueConstraint("finding_id", "number", name=op.f("uq_retests_finding_id")),
    )
    op.create_index(op.f("ix_retests_finding_id"), "retests", ["finding_id"], unique=False)
    op.create_index(
        op.f("ix_retests_organization_id"), "retests", ["organization_id"], unique=False
    )
    op.create_index(op.f("ix_retests_remediation_id"), "retests", ["remediation_id"], unique=False)
    op.create_table(
        "application_changes",
        sa.Column("finding_id", sa.Uuid(), nullable=False),
        sa.Column("remediation_id", sa.Uuid(), nullable=False),
        sa.Column("fix_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=15), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("link", sa.String(length=2048), nullable=True),
        sa.Column("implemented_by_id", sa.Uuid(), nullable=True),
        sa.Column("implemented_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["finding_id"],
            ["findings.id"],
            name=op.f("fk_application_changes_finding_id_findings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["fix_id"],
            ["remediation_fixes.id"],
            name=op.f("fk_application_changes_fix_id_remediation_fixes"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["implemented_by_id"],
            ["users.id"],
            name=op.f("fk_application_changes_implemented_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_application_changes_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["remediation_id"],
            ["remediations.id"],
            name=op.f("fk_application_changes_remediation_id_remediations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_application_changes")),
        sa.UniqueConstraint("fix_id", name=op.f("uq_application_changes_fix_id")),
    )
    op.create_index(
        op.f("ix_application_changes_finding_id"),
        "application_changes",
        ["finding_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_application_changes_organization_id"),
        "application_changes",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_application_changes_remediation_id"),
        "application_changes",
        ["remediation_id"],
        unique=False,
    )
    op.create_table(
        "retest_benign_checks",
        sa.Column("retest_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("outcome", sa.String(length=10), nullable=False),
        sa.Column("what_happened", sa.String(length=300), nullable=True),
        sa.Column("reply", sa.Text(), nullable=True),
        sa.Column("reply_length", sa.Integer(), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("review", sa.String(length=15), nullable=False),
        sa.Column("reviewed_by_id", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_retest_benign_checks_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["retest_id"],
            ["retests.id"],
            name=op.f("fk_retest_benign_checks_retest_id_retests"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_id"],
            ["users.id"],
            name=op.f("fk_retest_benign_checks_reviewed_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_retest_benign_checks")),
        sa.UniqueConstraint(
            "retest_id", "position", name=op.f("uq_retest_benign_checks_retest_id")
        ),
    )
    op.create_index(
        op.f("ix_retest_benign_checks_organization_id"),
        "retest_benign_checks",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_retest_benign_checks_retest_id"),
        "retest_benign_checks",
        ["retest_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_retest_benign_checks_retest_id"), table_name="retest_benign_checks")
    op.drop_index(
        op.f("ix_retest_benign_checks_organization_id"), table_name="retest_benign_checks"
    )
    op.drop_table("retest_benign_checks")
    op.drop_index(op.f("ix_application_changes_remediation_id"), table_name="application_changes")
    op.drop_index(op.f("ix_application_changes_organization_id"), table_name="application_changes")
    op.drop_index(op.f("ix_application_changes_finding_id"), table_name="application_changes")
    op.drop_table("application_changes")
    op.drop_index(op.f("ix_retests_remediation_id"), table_name="retests")
    op.drop_index(op.f("ix_retests_organization_id"), table_name="retests")
    op.drop_index(op.f("ix_retests_finding_id"), table_name="retests")
    op.drop_table("retests")
    op.drop_index(op.f("ix_target_benign_requests_target_id"), table_name="target_benign_requests")
    op.drop_table("target_benign_requests")
