"""The lab targets an organization has deployed (FR-11.2, UC-11.1).

Revision ID: 0064
Revises: 0063
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0064"
down_revision: str | None = "0063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "lab_deployments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("lab_key", sa.String(length=40), nullable=False),
        sa.Column("state", sa.String(length=20), nullable=False),
        sa.Column(
            "known_vulnerabilities",
            sa.dialects.postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "deployed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("last_reset_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resets", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_lab_deployments_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_lab_deployments_target_id_targets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lab_deployments")),
        sa.UniqueConstraint("target_id", name=op.f("uq_lab_deployments_target_id")),
    )
    op.create_index(op.f("ix_lab_deployments_organization_id"), "lab_deployments", ["organization_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_lab_deployments_organization_id"), table_name="lab_deployments")
    op.drop_table("lab_deployments")
