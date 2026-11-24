"""Shield Policy versions (FR-8.3, UC-8.4): one row per version of a target's policy, with the
document the gateway downloads, where its rules come from, the approver behind the deployment and
the window it waits for — plus what a gateway reports about its policy: what it held back, what
it masked, the restricted sources it saw and the version it is enforcing.

Revision ID: 0069
Revises: 0068
Create Date: 2026-10-31
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0069"
down_revision: str | None = "0068"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shield_policies",
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=12), nullable=False),
        sa.Column("source", sa.String(length=12), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("rule_count", sa.Integer(), nullable=False),
        sa.Column("carried_over", sa.Integer(), nullable=False),
        sa.Column("sources", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("based_on_version", sa.Integer(), nullable=True),
        sa.Column("trigger_finding", sa.String(length=20), nullable=True),
        sa.Column("trigger_version", sa.Integer(), nullable=True),
        sa.Column("approved_by_id", sa.Uuid(), nullable=True),
        sa.Column("deployed_by_id", sa.Uuid(), nullable=True),
        sa.Column("deploy_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("offered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("offers", sa.Integer(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.String(length=300), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["approved_by_id"],
            ["users.id"],
            name=op.f("fk_shield_policies_approved_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["deployed_by_id"],
            ["users.id"],
            name=op.f("fk_shield_policies_deployed_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_shield_policies_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_id"],
            ["targets.id"],
            name=op.f("fk_shield_policies_target_id_targets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shield_policies")),
        sa.UniqueConstraint("target_id", "version", name=op.f("uq_shield_policies_target_id")),
    )
    op.create_index(
        op.f("ix_shield_policies_organization_id"), "shield_policies", ["organization_id"]
    )
    op.create_index(op.f("ix_shield_policies_target_id"), "shield_policies", ["target_id"])
    # What a gateway reports about its policy: what it held back, and the version it enforces.
    op.add_column(
        "shield_gateways",
        sa.Column("requests_blocked", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "shield_gateways",
        sa.Column("requests_changed", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "shield_gateways",
        sa.Column("reported_policy_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "shield_gateways",
        sa.Column(
            "retrieval_sightings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )
    op.alter_column("shield_gateways", "requests_blocked", server_default=None)
    op.alter_column("shield_gateways", "requests_changed", server_default=None)
    op.alter_column("shield_gateways", "reported_policy_version", server_default=None)
    op.alter_column("shield_gateways", "retrieval_sightings", server_default=None)


def downgrade() -> None:
    op.drop_column("shield_gateways", "retrieval_sightings")
    op.drop_column("shield_gateways", "reported_policy_version")
    op.drop_column("shield_gateways", "requests_changed")
    op.drop_column("shield_gateways", "requests_blocked")
    op.drop_index(op.f("ix_shield_policies_target_id"), table_name="shield_policies")
    op.drop_index(op.f("ix_shield_policies_organization_id"), table_name="shield_policies")
    op.drop_table("shield_policies")
