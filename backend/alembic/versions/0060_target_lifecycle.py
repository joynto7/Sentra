"""The later life of a target (FR-2.6): when it was archived and by whom.

Revision ID: 0060
Revises: 0059
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0060"
down_revision: str | None = "0059"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("targets", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("targets", sa.Column("archived_by_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_targets_archived_by_id_users"),
        "targets",
        "users",
        ["archived_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_targets_archived_by_id_users"), "targets", type_="foreignkey")
    op.drop_column("targets", "archived_by_id")
    op.drop_column("targets", "archived_at")
