"""The audit log (FR-10.2, NFR-8.3): hash-chained, append-only entries, and the Platform
Administrator flag of an account.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-21
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# NFR-8.3: no UPDATE or DELETE of an entry; the same SQL as app/core/audit.py attaches to the table.
APPEND_ONLY_FUNCTION = """
CREATE OR REPLACE FUNCTION sentra_audit_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('sentra.audit_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Audit log entries can''t be changed or deleted.'
        USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql
"""
APPEND_ONLY_TRIGGER = (
    "CREATE TRIGGER audit_log_entries_append_only BEFORE UPDATE OR DELETE ON audit_log_entries "
    "FOR EACH ROW EXECUTE FUNCTION sentra_audit_append_only()"
)


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("platform_admin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_table(
        "audit_chains",
        sa.Column("key", sa.String(length=40), nullable=False),
        sa.Column("last_seq", sa.BigInteger(), nullable=False),
        sa.Column("last_hash", sa.String(length=64), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checked_ok", sa.Boolean(), nullable=True),
        sa.Column("checked_entries", sa.BigInteger(), nullable=False),
        sa.Column("broken_seq", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_audit_chains")),
    )
    op.create_table(
        "audit_log_entries",
        sa.Column("chain", sa.String(length=40), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_type", sa.String(length=20), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("actor_name", sa.String(length=200), nullable=False),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=False),
        sa.Column("item_type", sa.String(length=30), nullable=True),
        sa.Column("item_id", sa.String(length=64), nullable=True),
        sa.Column("item_label", sa.String(length=200), nullable=True),
        sa.Column("source_address", sa.String(length=45), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("prev_hash", sa.String(length=64), nullable=False),
        sa.Column("entry_hash", sa.String(length=64), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_audit_log_entries_organization_id_organizations"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log_entries")),
        sa.UniqueConstraint("chain", "seq", name=op.f("uq_audit_log_entries_chain")),
    )
    op.create_index(
        "ix_audit_log_entries_org_action",
        "audit_log_entries",
        ["organization_id", "action"],
        unique=False,
    )
    op.create_index(
        "ix_audit_log_entries_org_actor",
        "audit_log_entries",
        ["organization_id", "actor_id"],
        unique=False,
    )
    op.create_index(
        "ix_audit_log_entries_org_item",
        "audit_log_entries",
        ["organization_id", "item_type", "item_id"],
        unique=False,
    )
    op.create_index(
        "ix_audit_log_entries_org_time",
        "audit_log_entries",
        ["organization_id", "occurred_at"],
        unique=False,
    )
    op.execute(APPEND_ONLY_FUNCTION)
    op.execute(APPEND_ONLY_TRIGGER)


def downgrade() -> None:
    op.drop_index("ix_audit_log_entries_org_time", table_name="audit_log_entries")
    op.drop_index("ix_audit_log_entries_org_item", table_name="audit_log_entries")
    op.drop_index("ix_audit_log_entries_org_actor", table_name="audit_log_entries")
    op.drop_index("ix_audit_log_entries_org_action", table_name="audit_log_entries")
    op.drop_table("audit_log_entries")  # its trigger goes with it
    op.execute("DROP FUNCTION IF EXISTS sentra_audit_append_only()")
    op.drop_table("audit_chains")
    op.drop_column("users", "platform_admin")
