"""Reports and their schedules (FR-9.1, FR-9.2; UC-9.1, UC-9.2): every generated report with its
scope, its format, its status and the checksum of its file, and the standing orders that produce
reports after a run, weekly or monthly.

Revision ID: 0056
Revises: 0055
Create Date: 2026-10-31
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0056"
down_revision: str | None = "0055"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('report_schedules',
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('type', sa.String(length=10), nullable=False),
    sa.Column('scope', sa.String(length=15), nullable=False),
    sa.Column('target_id', sa.Uuid(), nullable=True),
    sa.Column('category', sa.String(length=5), nullable=True),
    sa.Column('period_days', sa.Integer(), nullable=True),
    sa.Column('format', sa.String(length=5), nullable=False),
    sa.Column('frequency', sa.String(length=20), nullable=False),
    sa.Column('recipient_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('next_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_report_schedules_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_report_schedules_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['target_id'], ['targets.id'], name=op.f('fk_report_schedules_target_id_targets'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_report_schedules'))
    )
    op.create_index(op.f('ix_report_schedules_organization_id'), 'report_schedules', ['organization_id'], unique=False)
    op.create_table('reports',
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=10), nullable=False),
    sa.Column('scope', sa.String(length=15), nullable=False),
    sa.Column('target_id', sa.Uuid(), nullable=True),
    sa.Column('campaign_run_id', sa.Uuid(), nullable=True),
    sa.Column('period_from', sa.DateTime(timezone=True), nullable=True),
    sa.Column('period_to', sa.DateTime(timezone=True), nullable=True),
    sa.Column('category', sa.String(length=5), nullable=True),
    sa.Column('format', sa.String(length=5), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('summary', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('object_key', sa.String(length=200), nullable=True),
    sa.Column('checksum', sa.String(length=64), nullable=True),
    sa.Column('size_bytes', sa.Integer(), nullable=True),
    sa.Column('requested_by_id', sa.Uuid(), nullable=True),
    sa.Column('schedule_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['campaign_run_id'], ['campaign_runs.id'], name=op.f('fk_reports_campaign_run_id_campaign_runs'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_reports_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['requested_by_id'], ['users.id'], name=op.f('fk_reports_requested_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['schedule_id'], ['report_schedules.id'], name=op.f('fk_reports_schedule_id_report_schedules'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['target_id'], ['targets.id'], name=op.f('fk_reports_target_id_targets'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_reports')),
    sa.UniqueConstraint('organization_id', 'number', name=op.f('uq_reports_organization_id'))
    )
    op.create_index(op.f('ix_reports_organization_id'), 'reports', ['organization_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_reports_organization_id'), table_name='reports')
    op.drop_table('reports')
    op.drop_index(op.f('ix_report_schedules_organization_id'), table_name='report_schedules')
    op.drop_table('report_schedules')
