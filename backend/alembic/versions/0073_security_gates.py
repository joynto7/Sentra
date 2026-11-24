"""The CI/CD security gates of FR-9.4 (UC-9.4) and their runs (UC-9.5): the campaign a
pipeline may start with an API key, the policy its findings are judged by, the run they are
compared with, and what each call of the gate decided for its build.

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
    op.create_table('security_gates',
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('target_id', sa.Uuid(), nullable=False),
    sa.Column('campaign_id', sa.Uuid(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('fail_on', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('fail_on_reopened', sa.Boolean(), nullable=False),
    sa.Column('baseline_run_id', sa.Uuid(), nullable=True),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['baseline_run_id'], ['campaign_runs.id'], name=op.f('fk_security_gates_baseline_run_id_campaign_runs'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['campaign_id'], ['campaigns.id'], name=op.f('fk_security_gates_campaign_id_campaigns'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_security_gates_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_security_gates_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['target_id'], ['targets.id'], name=op.f('fk_security_gates_target_id_targets'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_security_gates')),
    sa.UniqueConstraint('organization_id', 'number', name='uq_security_gates_number')
    )
    op.create_index(op.f('ix_security_gates_organization_id'), 'security_gates', ['organization_id'], unique=False)
    op.create_index('ix_security_gates_organization_status', 'security_gates', ['organization_id', 'status'], unique=False)
    op.create_table('gate_runs',
    sa.Column('gate_id', sa.Uuid(), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('campaign_run_id', sa.Uuid(), nullable=True),
    sa.Column('verdict', sa.String(length=10), nullable=False),
    sa.Column('build_ref', sa.String(length=200), nullable=True),
    sa.Column('build_commit', sa.String(length=80), nullable=True),
    sa.Column('build_url', sa.String(length=500), nullable=True),
    sa.Column('compared_run_id', sa.Uuid(), nullable=True),
    sa.Column('new_findings', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('breaking', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('message', sa.Text(), nullable=True),
    sa.Column('started_by_key_id', sa.Uuid(), nullable=True),
    sa.Column('started_by_id', sa.Uuid(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['campaign_run_id'], ['campaign_runs.id'], name=op.f('fk_gate_runs_campaign_run_id_campaign_runs'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['compared_run_id'], ['campaign_runs.id'], name=op.f('fk_gate_runs_compared_run_id_campaign_runs'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['gate_id'], ['security_gates.id'], name=op.f('fk_gate_runs_gate_id_security_gates'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_gate_runs_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['started_by_id'], ['users.id'], name=op.f('fk_gate_runs_started_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['started_by_key_id'], ['api_keys.id'], name=op.f('fk_gate_runs_started_by_key_id_api_keys'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_gate_runs')),
    sa.UniqueConstraint('gate_id', 'number', name='uq_gate_runs_number')
    )
    op.create_index('ix_gate_runs_campaign_run_id', 'gate_runs', ['campaign_run_id'], unique=False)
    op.create_index(op.f('ix_gate_runs_organization_id'), 'gate_runs', ['organization_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_gate_runs_organization_id'), table_name='gate_runs')
    op.drop_index('ix_gate_runs_campaign_run_id', table_name='gate_runs')
    op.drop_table('gate_runs')
    op.drop_index('ix_security_gates_organization_status', table_name='security_gates')
    op.drop_index(op.f('ix_security_gates_organization_id'), table_name='security_gates')
    op.drop_table('security_gates')
