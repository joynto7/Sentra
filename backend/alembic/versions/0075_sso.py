"""Single sign-on (FR-1.3; UC-1.7 steps 4-6, UC-1.5): an organization's identity provider, and
the logins that are away at it.

Revision ID: 0075
Revises: 0074
Create Date: 2026-11-04
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0075"
down_revision: str | None = "0074"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('sso_connections',
    sa.Column('protocol', sa.String(length=20), server_default='oidc', nullable=False),
    sa.Column('email_domain', sa.String(length=255), nullable=False),
    sa.Column('issuer', sa.String(length=500), nullable=False),
    sa.Column('client_id', sa.String(length=255), nullable=False),
    sa.Column('client_secret', sa.Text(), nullable=False),
    sa.Column('tested_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_by_id', sa.Uuid(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_sso_connections_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_sso_connections_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sso_connections')),
    sa.UniqueConstraint('email_domain', name=op.f('uq_sso_connections_email_domain')),
    sa.UniqueConstraint('organization_id', name='uq_sso_connections_organization')
    )
    op.create_index(op.f('ix_sso_connections_organization_id'), 'sso_connections', ['organization_id'], unique=False)
    op.create_table('sso_login_states',
    sa.Column('state', sa.String(length=64), nullable=False),
    sa.Column('nonce', sa.String(length=64), nullable=False),
    sa.Column('code_verifier', sa.String(length=128), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_sso_login_states_organization_id_organizations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sso_login_states')),
    sa.UniqueConstraint('state', name=op.f('uq_sso_login_states_state'))
    )
    op.create_index(op.f('ix_sso_login_states_organization_id'), 'sso_login_states', ['organization_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_sso_login_states_organization_id'), table_name='sso_login_states')
    op.drop_table('sso_login_states')
    op.drop_index(op.f('ix_sso_connections_organization_id'), table_name='sso_connections')
    op.drop_table('sso_connections')
