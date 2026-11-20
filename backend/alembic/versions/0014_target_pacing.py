"""When the next request to each target may leave: the Target Connector's spacing (FR-5.7).

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-14
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "target_pacing",
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("next_request_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_target_pacing_target_id_targets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("target_id", name=op.f("pk_target_pacing")),
    )


def downgrade() -> None:
    op.drop_table("target_pacing")
