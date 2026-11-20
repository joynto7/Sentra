"""The attack paths an analyst dismissed (FR-7.3, UC-7.5, 6a1): a path is derived from the
findings and the Target Profile every time the view is opened, so only the decision to hide one is
stored, with its reason and the chain it was about.

Revision ID: 0054
Revises: 0053
Create Date: 2026-10-30
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0054"
down_revision: str | None = "0053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('attack_path_dismissals',
    sa.Column('target_id', sa.Uuid(), nullable=False),
    sa.Column('path_key', sa.String(length=32), nullable=False),
    sa.Column('finding_codes', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('reason', sa.String(length=300), nullable=False),
    sa.Column('dismissed_by_id', sa.Uuid(), nullable=True),
    sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('organization_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['dismissed_by_id'], ['users.id'], name=op.f('fk_attack_path_dismissals_dismissed_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_attack_path_dismissals_organization_id_organizations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['target_id'], ['targets.id'], name=op.f('fk_attack_path_dismissals_target_id_targets'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_attack_path_dismissals')),
    sa.UniqueConstraint('target_id', 'path_key', name=op.f('uq_attack_path_dismissals_target_id'))
    )
    op.create_index(op.f('ix_attack_path_dismissals_organization_id'), 'attack_path_dismissals', ['organization_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_attack_path_dismissals_organization_id'), table_name='attack_path_dismissals')
    op.drop_table('attack_path_dismissals')
