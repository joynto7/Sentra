"""Rolling a Shield Policy back (FR-8.6, UC-8.8): why somebody rolled back to a version or
switched the policy off, in their own words, and the version the new one took out of the traffic.

Revision ID: 0070
Revises: 0069
Create Date: 2026-10-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0070"
down_revision: str | None = "0069"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("shield_policies", sa.Column("reason", sa.String(length=300), nullable=True))
    op.add_column("shield_policies", sa.Column("rolled_back_from", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("shield_policies", "rolled_back_from")
    op.drop_column("shield_policies", "reason")
