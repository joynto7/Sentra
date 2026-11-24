"""The policy each gate run was judged by (UC-9.4, quality requirement 2): a copy of the gate's
policy, written when the run starts, so that a result can still be explained after the gate's
policy has changed. Existing runs take the policy of their gate.

Revision ID: 0073
Revises: 0072
Create Date: 2026-11-03
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0073"
down_revision: str | None = "0072"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "gate_runs",
        sa.Column(
            "fail_on",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "gate_runs",
        sa.Column(
            "fail_on_reopened", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )
    # The runs that already exist were judged by their gate's policy, which has not changed yet.
    op.execute(
        "UPDATE gate_runs SET fail_on = g.fail_on, fail_on_reopened = g.fail_on_reopened "
        "FROM security_gates AS g WHERE g.id = gate_runs.gate_id"
    )
    op.alter_column("gate_runs", "fail_on", server_default=None)
    op.alter_column("gate_runs", "fail_on_reopened", server_default=None)


def downgrade() -> None:
    op.drop_column("gate_runs", "fail_on_reopened")
    op.drop_column("gate_runs", "fail_on")
