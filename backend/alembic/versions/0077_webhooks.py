"""Webhooks (FR-9.6; UC-9.7): the endpoints of an organization's own systems and every event on
its way to one of them.

Revision ID: 0077
Revises: 0076
Create Date: 2026-11-04
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0077"
down_revision: str | None = "0076"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('webhooks',
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('events', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('secret', sa.Text(), nullable=False),
    sa.Column('secret_created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('status', sa.String(length=20), server_default='inactive', nullable=False),
    sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('failures', sa.Integer(), server_default='0', nullable=False),
    sa.Column('disabled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_webhooks_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_webhooks_organization_id_organizations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_webhooks'))
    )
    op.create_index(op.f('ix_webhooks_organization_id'), 'webhooks', ['organization_id'], unique=False)
    op.create_table('webhook_deliveries',
    sa.Column('webhook_id', sa.Uuid(), nullable=False),
    sa.Column('event', sa.String(length=60), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=True),
    sa.Column('duration_ms', sa.Integer(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_webhook_deliveries_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['webhook_id'], ['webhooks.id'], name=op.f('fk_webhook_deliveries_webhook_id_webhooks'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_webhook_deliveries'))
    )
    op.create_index('ix_webhook_deliveries_webhook_created', 'webhook_deliveries', ['webhook_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_webhook_deliveries_organization_id'), 'webhook_deliveries', ['organization_id'], unique=False)
    op.create_index(op.f('ix_webhook_deliveries_webhook_id'), 'webhook_deliveries', ['webhook_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_webhook_deliveries_webhook_id'), table_name='webhook_deliveries')
    op.drop_index(op.f('ix_webhook_deliveries_organization_id'), table_name='webhook_deliveries')
    op.drop_index('ix_webhook_deliveries_webhook_created', table_name='webhook_deliveries')
    op.drop_table('webhook_deliveries')
    op.drop_index(op.f('ix_webhooks_organization_id'), table_name='webhooks')
    op.drop_table('webhooks')
