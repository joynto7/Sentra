"""Threat models (FR-3.1, FR-3.2, FR-3.3): every version of a target's threat model, its threats,
and the jobs that generate new versions. Triggers keep what a stored version says unchanged.

Revision ID: 0050
Revises: 0022
Create Date: 2026-10-30
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0050"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# FR-3.3: a stored version is never changed; the same SQL as m03_threat_models/models.py attaches
# to the tables. Approving a draft once, and SET NULL for a deleted user, stay possible.
VERSION_FIXED_FUNCTION = """
CREATE OR REPLACE FUNCTION sentra_threat_model_version_fixed() RETURNS trigger AS $$
BEGIN
    IF (NEW.organization_id, NEW.target_id, NEW.version, NEW.origin, NEW.based_on_version,
        NEW.profile_version, NEW.components, NEW.ai_generated, NEW.generation, NEW.created_at)
       IS DISTINCT FROM
       (OLD.organization_id, OLD.target_id, OLD.version, OLD.origin, OLD.based_on_version,
        OLD.profile_version, OLD.components, OLD.ai_generated, OLD.generation, OLD.created_at)
       OR (OLD.status = 'approved' AND (NEW.status, NEW.approved_at)
           IS DISTINCT FROM (OLD.status, OLD.approved_at)) THEN
        RAISE EXCEPTION 'A threat model version can''t be changed. Save a new version instead.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql
"""
VERSION_FIXED_TRIGGER = (
    "CREATE TRIGGER threat_models_version_fixed BEFORE UPDATE ON threat_models "
    "FOR EACH ROW EXECUTE FUNCTION sentra_threat_model_version_fixed()"
)
THREAT_FIXED_FUNCTION = """
CREATE OR REPLACE FUNCTION sentra_threat_fixed() RETURNS trigger AS $$
BEGIN
    IF (NEW.threat_model_id, NEW.threat_no, NEW.title, NEW.component_kind, NEW.component_name,
        NEW.owasp, NEW.atlas, NEW.likelihood, NEW.impact, NEW.source, NEW.rule, NEW.rationale,
        NEW.change_reason, NEW.removed, NEW.removal_reason)
       IS DISTINCT FROM
       (OLD.threat_model_id, OLD.threat_no, OLD.title, OLD.component_kind, OLD.component_name,
        OLD.owasp, OLD.atlas, OLD.likelihood, OLD.impact, OLD.source, OLD.rule, OLD.rationale,
        OLD.change_reason, OLD.removed, OLD.removal_reason) THEN
        RAISE EXCEPTION 'A stored threat can''t be changed. Save a new version instead.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql
"""
THREAT_FIXED_TRIGGER = (
    "CREATE TRIGGER threats_fixed BEFORE UPDATE ON threats "
    "FOR EACH ROW EXECUTE FUNCTION sentra_threat_fixed()"
)


def upgrade() -> None:
    op.create_table("threat_model_jobs",
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("trigger", sa.String(length=20), nullable=False),
    sa.Column("requested_by_id", sa.Uuid(), nullable=True),
    sa.Column("status", sa.String(length=10), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("version", sa.Integer(), nullable=True),
    sa.Column("message", sa.Text(), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_threat_model_jobs_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], name=op.f("fk_threat_model_jobs_requested_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_threat_model_jobs_target_id_targets"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_threat_model_jobs"))
    )
    op.create_index(op.f("ix_threat_model_jobs_organization_id"), "threat_model_jobs", ["organization_id"], unique=False)
    op.create_index(op.f("ix_threat_model_jobs_target_id"), "threat_model_jobs", ["target_id"], unique=False)
    op.create_table("threat_models",
    sa.Column("target_id", sa.Uuid(), nullable=False),
    sa.Column("version", sa.Integer(), nullable=False),
    sa.Column("status", sa.String(length=10), nullable=False),
    sa.Column("origin", sa.String(length=10), nullable=False),
    sa.Column("based_on_version", sa.Integer(), nullable=True),
    sa.Column("profile_version", sa.Integer(), nullable=True),
    sa.Column("components", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("ai_generated", sa.Boolean(), nullable=False),
    sa.Column("generation", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("created_by_id", sa.Uuid(), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("approved_by_id", sa.Uuid(), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.Column("organization_id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"], name=op.f("fk_threat_models_approved_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], name=op.f("fk_threat_models_created_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name=op.f("fk_threat_models_organization_id_organizations"), ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["target_id"], ["targets.id"], name=op.f("fk_threat_models_target_id_targets"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_threat_models")),
    sa.UniqueConstraint("target_id", "version", name=op.f("uq_threat_models_target_id"))
    )
    op.create_index(op.f("ix_threat_models_organization_id"), "threat_models", ["organization_id"], unique=False)
    op.create_index(op.f("ix_threat_models_target_id"), "threat_models", ["target_id"], unique=False)
    op.create_table("threats",
    sa.Column("threat_model_id", sa.Uuid(), nullable=False),
    sa.Column("threat_no", sa.Integer(), nullable=False),
    sa.Column("title", sa.String(length=200), nullable=False),
    sa.Column("component_kind", sa.String(length=20), nullable=False),
    sa.Column("component_name", sa.String(length=120), nullable=False),
    sa.Column("owasp", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column("atlas", sa.String(length=20), nullable=True),
    sa.Column("likelihood", sa.Integer(), nullable=False),
    sa.Column("impact", sa.Integer(), nullable=False),
    sa.Column("source", sa.String(length=15), nullable=False),
    sa.Column("rule", sa.String(length=40), nullable=True),
    sa.Column("rationale", sa.Text(), nullable=True),
    sa.Column("rated_by_id", sa.Uuid(), nullable=True),
    sa.Column("edited_by_id", sa.Uuid(), nullable=True),
    sa.Column("change_reason", sa.String(length=300), nullable=True),
    sa.Column("removed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    sa.Column("removal_reason", sa.String(length=300), nullable=True),
    sa.Column("id", sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(["edited_by_id"], ["users.id"], name=op.f("fk_threats_edited_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["rated_by_id"], ["users.id"], name=op.f("fk_threats_rated_by_id_users"), ondelete="SET NULL"),
    sa.ForeignKeyConstraint(["threat_model_id"], ["threat_models.id"], name=op.f("fk_threats_threat_model_id_threat_models"), ondelete="CASCADE"),
    sa.PrimaryKeyConstraint("id", name=op.f("pk_threats")),
    sa.UniqueConstraint("threat_model_id", "threat_no", name=op.f("uq_threats_threat_model_id"))
    )
    op.create_index(op.f("ix_threats_threat_model_id"), "threats", ["threat_model_id"], unique=False)
    op.execute(VERSION_FIXED_FUNCTION)
    op.execute(VERSION_FIXED_TRIGGER)
    op.execute(THREAT_FIXED_FUNCTION)
    op.execute(THREAT_FIXED_TRIGGER)


def downgrade() -> None:
    op.drop_index(op.f("ix_threats_threat_model_id"), table_name="threats")
    op.drop_table("threats")  # its trigger goes with it
    op.execute("DROP FUNCTION IF EXISTS sentra_threat_fixed()")
    op.drop_index(op.f("ix_threat_models_target_id"), table_name="threat_models")
    op.drop_index(op.f("ix_threat_models_organization_id"), table_name="threat_models")
    op.drop_table("threat_models")
    op.execute("DROP FUNCTION IF EXISTS sentra_threat_model_version_fixed()")
    op.drop_index(op.f("ix_threat_model_jobs_target_id"), table_name="threat_model_jobs")
    op.drop_index(op.f("ix_threat_model_jobs_organization_id"), table_name="threat_model_jobs")
    op.drop_table("threat_model_jobs")
