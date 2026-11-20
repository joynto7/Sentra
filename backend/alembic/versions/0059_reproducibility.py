"""Reproducibility measurements (FR-6.4): how reliably each finding could be reproduced in a
campaign run, and which attempt a repetition repeats.

Revision ID: 0059
Revises: 0058
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0059"
down_revision: str | None = "0058"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reproducibility_measurements",
        sa.Column("finding_id", sa.Uuid(), nullable=False),
        sa.Column("campaign_run_id", sa.Uuid(), nullable=False),
        sa.Column("test_code", sa.String(length=40), nullable=False),
        sa.Column("wanted", sa.SmallInteger(), nullable=False),
        sa.Column("scheduled", sa.SmallInteger(), nullable=False),
        sa.Column("attempts", sa.SmallInteger(), nullable=False),
        sa.Column("successes", sa.SmallInteger(), nullable=False),
        sa.Column("rate", sa.Numeric(precision=4, scale=3), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("reason", sa.Text(), server_default="", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["campaign_run_id"],
            ["campaign_runs.id"],
            name=op.f("fk_reproducibility_measurements_campaign_run_id_campaign_runs"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["finding_id"],
            ["findings.id"],
            name=op.f("fk_reproducibility_measurements_finding_id_findings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_reproducibility_measurements_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reproducibility_measurements")),
        sa.UniqueConstraint(
            "finding_id",
            "campaign_run_id",
            name=op.f("uq_reproducibility_measurements_finding_id"),
        ),
    )
    op.create_index(
        op.f("ix_reproducibility_measurements_organization_id"),
        "reproducibility_measurements",
        ["organization_id"],
        unique=False,
    )
    op.add_column("attempts", sa.Column("repeat_of_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_attempts_repeat_of_id_attempts"),
        "attempts",
        "attempts",
        ["repeat_of_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_attempts_repeat_of_id_attempts"), "attempts", type_="foreignkey")
    op.drop_column("attempts", "repeat_of_id")
    op.drop_index(
        op.f("ix_reproducibility_measurements_organization_id"),
        table_name="reproducibility_measurements",
    )
    op.drop_table("reproducibility_measurements")
