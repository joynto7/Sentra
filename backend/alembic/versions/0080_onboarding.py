"""First-run setup of a member in an organization: progress and the few choices made there.

Memberships that exist when this runs are marked done, so nobody who already works in Sentra is
sent through the setup.

Revision ID: 0080
Revises: 0079
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0080"
down_revision: str | None = "0079"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("memberships", sa.Column("onboarding", sa.JSON(), nullable=True))
    op.execute("""update memberships set onboarding = '{"done": true, "earlier": true}'""")


def downgrade() -> None:
    op.drop_column("memberships", "onboarding")
