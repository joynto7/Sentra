"""Target checks (FR-2.3, FR-2.4, FR-2.5): connection tests, ownership checks and who verified a
target, target profiles with their saved versions, and the canary tokens of each target.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-21
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("ownership_verifications",
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("method", sa.String(length=20), nullable=False),
    sa.Column("trigger", sa.String(length=20), nullable=False),
    sa.Column("checked_by_id", sa.Uuid(), nullable=True),
    sa.Column("status", sa.String(length=10), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("checked_location", sa.String(length=500), nullable=False),
    sa.Column("found", sa.Text(), nullable=True),
    sa.Column("message", sa.Text(), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["checked_by_id"], ["users.id"], name=op.f("fk_ownership_verifications_checked_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_ownership_verifications_target_id_targets"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_ownership_verifications"))
    )
    op.create_index(op.f("ix_ownership_verifications_target_id"), "ownership_verifications", ["target_id"], unique=False)
    op.create_table("target_canaries",
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("slot", sa.String(length=30), nullable=False),
    sa.Column("token", sa.String(length=120), nullable=False),
    sa.Column("topic", sa.String(length=200), nullable=True),
    sa.Column("source", sa.String(length=10), nullable=False),
    sa.Column("planted_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_target_canaries_target_id_targets"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_target_canaries"))
    )
    op.create_index(op.f("ix_target_canaries_target_id"), "target_canaries", ["target_id"], unique=False)
    op.create_index("uq_target_canaries_one_current", "target_canaries", ["target_id", "slot"], unique=True, postgresql_where=sa.text("retired_at IS NULL"))
    op.create_table("target_connection_tests",
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("requested_by_id", sa.Uuid(), nullable=True),
    sa.Column("status", sa.String(length=10), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("status_code", sa.Integer(), nullable=True),
    sa.Column("duration_ms", sa.Integer(), nullable=True),
    sa.Column("reply_path", sa.String(length=300), nullable=True),
    sa.Column("reply_excerpt", sa.Text(), nullable=True),
    sa.Column("error_kind", sa.String(length=20), nullable=True),
    sa.Column("error_message", sa.Text(), nullable=True),
    sa.Column("unreadable_excerpt", sa.Text(), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], name=op.f("fk_target_connection_tests_requested_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_target_connection_tests_target_id_targets"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_target_connection_tests"))
    )
    op.create_index(op.f("ix_target_connection_tests_target_id"), "target_connection_tests", ["target_id"], unique=False)
    op.create_table("target_profiles",
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("status", sa.String(length=10), nullable=False),
    sa.Column("version", sa.Integer(), nullable=False),
    sa.Column("requested_by_id", sa.Uuid(), nullable=True),
    sa.Column("mapped_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("discovery_requests", sa.Integer(), nullable=False),
    sa.Column("stop_reason", sa.Text(), nullable=True),
    sa.Column("entries", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("knowledge_sources", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("tools", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("reviewed_by_id", sa.Uuid(), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], name=op.f("fk_target_profiles_requested_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"], name=op.f("fk_target_profiles_reviewed_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_target_profiles_target_id_targets"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_target_profiles")),
    sa.UniqueConstraint("target_id", name=op.f("uq_target_profiles_target_id"))
    )
    op.create_table("target_profile_revisions",
    sa.Column("profile_id", sa.Uuid(), nullable=False),
    sa.Column("version", sa.Integer(), nullable=False),
    sa.Column("kind", sa.String(length=10), nullable=False),
    sa.Column("saved_by_id", sa.Uuid(), nullable=True),
    sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["profile_id"], ["target_profiles.id"], name=op.f("fk_target_profile_revisions_profile_id_target_profiles"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["saved_by_id"], ["users.id"], name=op.f("fk_target_profile_revisions_saved_by_id_users"), ondelete="SET NULL"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_target_profile_revisions")),
    sa.UniqueConstraint("profile_id", "version", name=op.f("uq_target_profile_revisions_profile_id"))
    )
    op.create_index(op.f("ix_target_profile_revisions_profile_id"), "target_profile_revisions", ["profile_id"], unique=False)
    op.add_column("targets", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("targets", sa.Column("verified_by_id", sa.Uuid(), nullable=True))
    op.add_column("targets", sa.Column("verification_method", sa.String(length=20), nullable=True))
    op.create_foreign_key(op.f("fk_targets_verified_by_id_users"), "targets", "users", ["verified_by_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(op.f("fk_targets_verified_by_id_users"), "targets", type_="foreignkey")
    op.drop_column("targets", "verification_method")
    op.drop_column("targets", "verified_by_id")
    op.drop_column("targets", "verified_at")
    op.drop_index(op.f("ix_target_profile_revisions_profile_id"), table_name="target_profile_revisions")
    op.drop_table("target_profile_revisions")
    op.drop_table("target_profiles")
    op.drop_index(op.f("ix_target_connection_tests_target_id"), table_name="target_connection_tests")
    op.drop_table("target_connection_tests")
    op.drop_index("uq_target_canaries_one_current", table_name="target_canaries", postgresql_where=sa.text("retired_at IS NULL"))
    op.drop_index(op.f("ix_target_canaries_target_id"), table_name="target_canaries")
    op.drop_table("target_canaries")
    op.drop_index(op.f("ix_ownership_verifications_target_id"), table_name="ownership_verifications")
    op.drop_table("ownership_verifications")
