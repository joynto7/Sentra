"""Triage of findings (FR-6.5) and the merging of duplicates (FR-6.6): the owner and the decision
each finding carries, and its append-only history.

Revision ID: 0058
Revises: 0057
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0058"
down_revision: str | None = "0057"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# UC-6.6, quality requirement 5: the history of a finding is append-only, so that every decision
# can be traced. The same guard as for evidence (0020), with its own message.
APPEND_ONLY = """
CREATE OR REPLACE FUNCTION sentra_finding_events_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'The history of a finding can''t be changed or deleted.'
        USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql
"""
TRIGGER = (
    "CREATE TRIGGER finding_events_append_only BEFORE UPDATE OR DELETE ON finding_events "
    "FOR EACH ROW EXECUTE FUNCTION sentra_finding_events_append_only()"
)


def upgrade() -> None:
    op.create_table(
        "finding_events",
        sa.Column("finding_id", sa.Uuid(), nullable=False),
        sa.Column("event_no", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=25), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("actor_name", sa.String(length=200), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("was", sa.String(length=25), nullable=True),
        sa.Column("became", sa.String(length=25), nullable=True),
        sa.Column("campaign_run_id", sa.Uuid(), nullable=True),
        sa.Column("related_finding_id", sa.Uuid(), nullable=True),
        sa.Column("related_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name=op.f("fk_finding_events_actor_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["campaign_run_id"],
            ["campaign_runs.id"],
            name=op.f("fk_finding_events_campaign_run_id_campaign_runs"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["finding_id"],
            ["findings.id"],
            name=op.f("fk_finding_events_finding_id_findings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_finding_events_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["related_finding_id"],
            ["findings.id"],
            name=op.f("fk_finding_events_related_finding_id_findings"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["related_user_id"],
            ["users.id"],
            name=op.f("fk_finding_events_related_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_finding_events")),
        sa.UniqueConstraint("finding_id", "event_no", name=op.f("uq_finding_events_finding_id")),
    )
    op.create_index(
        op.f("ix_finding_events_organization_id"),
        "finding_events",
        ["organization_id"],
        unique=False,
    )
    op.execute(APPEND_ONLY)
    op.execute(TRIGGER)

    op.add_column(
        "findings",
        sa.Column("severity_justification", sa.Text(), server_default="", nullable=False),
    )
    op.add_column("findings", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.add_column("findings", sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("findings", sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("findings", sa.Column("confirmed_by_id", sa.Uuid(), nullable=True))
    op.add_column("findings", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("findings", sa.Column("closed_by_id", sa.Uuid(), nullable=True))
    op.add_column(
        "findings", sa.Column("close_reason", sa.Text(), server_default="", nullable=False)
    )
    op.add_column("findings", sa.Column("merged_into_id", sa.Uuid(), nullable=True))
    op.create_index(op.f("ix_findings_owner_id"), "findings", ["owner_id"], unique=False)
    op.create_index(
        op.f("ix_findings_merged_into_id"), "findings", ["merged_into_id"], unique=False
    )
    op.create_foreign_key(
        op.f("fk_findings_owner_id_users"),
        "findings",
        "users",
        ["owner_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_findings_confirmed_by_id_users"),
        "findings",
        "users",
        ["confirmed_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_findings_closed_by_id_users"),
        "findings",
        "users",
        ["closed_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        op.f("fk_findings_merged_into_id_findings"),
        "findings",
        "findings",
        ["merged_into_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("fk_findings_merged_into_id_findings"), "findings", type_="foreignkey")
    op.drop_constraint(op.f("fk_findings_closed_by_id_users"), "findings", type_="foreignkey")
    op.drop_constraint(op.f("fk_findings_confirmed_by_id_users"), "findings", type_="foreignkey")
    op.drop_constraint(op.f("fk_findings_owner_id_users"), "findings", type_="foreignkey")
    op.drop_index(op.f("ix_findings_merged_into_id"), table_name="findings")
    op.drop_index(op.f("ix_findings_owner_id"), table_name="findings")
    op.drop_column("findings", "merged_into_id")
    op.drop_column("findings", "close_reason")
    op.drop_column("findings", "closed_by_id")
    op.drop_column("findings", "closed_at")
    op.drop_column("findings", "confirmed_by_id")
    op.drop_column("findings", "confirmed_at")
    op.drop_column("findings", "assigned_at")
    op.drop_column("findings", "owner_id")
    op.drop_column("findings", "severity_justification")
    op.drop_index(op.f("ix_finding_events_organization_id"), table_name="finding_events")
    op.drop_table("finding_events")
    op.execute("DROP FUNCTION IF EXISTS sentra_finding_events_append_only()")
