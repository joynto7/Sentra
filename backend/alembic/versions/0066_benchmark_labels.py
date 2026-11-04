"""The analyst's labels of a benchmark run, and the version of each list of documented
weaknesses (FR-11.4, UC-11.5).

Revision ID: 0066
Revises: 0065
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0066"
down_revision: str | None = "0065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "lab_deployments",
        sa.Column("known_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("lab_deployments", "known_version", server_default=None)
    op.create_table(
        "benchmark_labels",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("benchmark_run_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=True),
        sa.Column("finding_id", sa.Uuid(), nullable=True),
        sa.Column("verdict", sa.String(length=20), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("labelled_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "labelled_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["attempts.id"],
            name=op.f("fk_benchmark_labels_attempt_id_attempts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["benchmark_run_id"],
            ["benchmark_runs.id"],
            name=op.f("fk_benchmark_labels_benchmark_run_id_benchmark_runs"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["finding_id"],
            ["findings.id"],
            name=op.f("fk_benchmark_labels_finding_id_findings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["labelled_by_id"],
            ["users.id"],
            name=op.f("fk_benchmark_labels_labelled_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_benchmark_labels")),
        sa.UniqueConstraint(
            "benchmark_run_id", "attempt_id", name="uq_benchmark_labels_one_attempt"
        ),
        sa.UniqueConstraint(
            "benchmark_run_id", "finding_id", name="uq_benchmark_labels_one_finding"
        ),
    )
    op.create_index(
        op.f("ix_benchmark_labels_benchmark_run_id"), "benchmark_labels", ["benchmark_run_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_benchmark_labels_benchmark_run_id"), table_name="benchmark_labels")
    op.drop_table("benchmark_labels")
    op.drop_column("lab_deployments", "known_version")
