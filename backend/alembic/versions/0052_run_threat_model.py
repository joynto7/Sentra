"""The threat model version a campaign run was based on (FR-3.3): `campaign_runs.threat_model_id`.
A launch copies it from the campaign, so UC-3.4 step 2 can name the runs that used a version.

Revision ID: 0052
Revises: 0051
Create Date: 2026-10-30
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0052"
down_revision: str | None = "0051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("campaign_runs", sa.Column("threat_model_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_campaign_runs_threat_model_id"), "campaign_runs", ["threat_model_id"], unique=False)
    op.create_foreign_key(op.f("fk_campaign_runs_threat_model_id_threat_models"), "campaign_runs", "threat_models", ["threat_model_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(op.f("fk_campaign_runs_threat_model_id_threat_models"), "campaign_runs", type_="foreignkey")
    op.drop_index(op.f("ix_campaign_runs_threat_model_id"), table_name="campaign_runs")
    op.drop_column("campaign_runs", "threat_model_id")
