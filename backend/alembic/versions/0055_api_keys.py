"""The API keys of an organization (FR-9.5, UC-9.6): what an integration may do, how long the key
lasts and when it was last used. Only the first characters of a key and its SHA-256 are kept, never
the key itself (NFR-3.1).

Revision ID: 0055
Revises: 0054
Create Date: 2026-10-31
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0055"
down_revision: str | None = "0054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('api_keys',
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('purpose', sa.String(length=300), nullable=False),
    sa.Column('prefix', sa.String(length=16), nullable=False),
    sa.Column('key_hash', sa.String(length=64), nullable=False),
    sa.Column('scopes', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('target_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_by_id', sa.Uuid(), nullable=True),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expiry_notified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_api_keys_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_api_keys_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['revoked_by_id'], ['users.id'], name=op.f('fk_api_keys_revoked_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_api_keys')),
    sa.UniqueConstraint('prefix', name=op.f('uq_api_keys_prefix'))
    )
    op.create_index(op.f('ix_api_keys_organization_id'), 'api_keys', ['organization_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_api_keys_organization_id'), table_name='api_keys')
    op.drop_table('api_keys')
