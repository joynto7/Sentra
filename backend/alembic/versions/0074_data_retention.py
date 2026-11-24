"""Data retention (FR-10.5; UC-10.7, UC-10.8): how long an organization keeps its evidence,
campaign data and reports, and what each daily clean-up deleted.

It also gives the evidence table's read-only trigger its one exception: a DELETE passes inside the
transaction that declares itself the retention clean-up, and an UPDATE stays impossible for
everybody. Without it FR-10.5 could not delete the data FR-6.3 wrote.

Revision ID: 0074
Revises: 0073
Create Date: 2026-11-03
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0074"
down_revision: str | None = "0073"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The function as this migration leaves it, and as 0020 wrote it.
WITH_RETENTION = """
CREATE OR REPLACE FUNCTION sentra_evidence_read_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('sentra.retention', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Evidence can''t be changed; it is deleted only when its period ends.'
        USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql
"""
READ_ONLY = """
CREATE OR REPLACE FUNCTION sentra_evidence_read_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Evidence can''t be changed or deleted.'
        USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql
"""


def upgrade() -> None:
    op.create_table('retention_settings',
    sa.Column('evidence_days', sa.Integer(), nullable=False),
    sa.Column('campaign_days', sa.Integer(), nullable=False),
    sa.Column('report_days', sa.Integer(), nullable=False),
    sa.Column('updated_by_id', sa.Uuid(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_retention_settings_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_retention_settings_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_retention_settings')),
    sa.UniqueConstraint('organization_id', name='uq_retention_settings_organization')
    )
    op.create_index(op.f('ix_retention_settings_organization_id'), 'retention_settings', ['organization_id'], unique=False)
    op.create_table('retention_runs',
    sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('evidence_days', sa.Integer(), nullable=False),
    sa.Column('campaign_days', sa.Integer(), nullable=False),
    sa.Column('report_days', sa.Integer(), nullable=False),
    sa.Column('evidence_deleted', sa.Integer(), nullable=False),
    sa.Column('evidence_bytes', sa.BigInteger(), nullable=False),
    sa.Column('attempts_deleted', sa.Integer(), nullable=False),
    sa.Column('reports_deleted', sa.Integer(), nullable=False),
    sa.Column('postponed', sa.Integer(), nullable=False),
    sa.Column('failures', sa.Integer(), nullable=False),
    sa.Column('failed_keys', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_retention_runs_organization_id_organizations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_retention_runs'))
    )
    op.create_index(op.f('ix_retention_runs_organization_id'), 'retention_runs', ['organization_id'], unique=False)
    op.execute(WITH_RETENTION)


def downgrade() -> None:
    op.execute(READ_ONLY)
    op.drop_index(op.f('ix_retention_runs_organization_id'), table_name='retention_runs')
    op.drop_table('retention_runs')
    op.drop_index(op.f('ix_retention_settings_organization_id'), table_name='retention_settings')
    op.drop_table('retention_settings')
