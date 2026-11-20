"""LLM providers, their models and the model of each task (FR-10.3, UC-10.4).

Revision ID: 0061
Revises: 0060
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: str | None = "0060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "llm_providers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("prefix", sa.String(length=30), nullable=False),
        sa.Column("base_url", sa.String(length=300), nullable=True),
        sa.Column("api_key_encrypted", sa.String(length=500), nullable=True),
        sa.Column("deployment", sa.String(length=10), nullable=False),
        sa.Column("added_by_id", sa.Uuid(), nullable=True),
        sa.Column("tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("test_reply", sa.String(length=500), nullable=True),
        sa.Column("test_duration_ms", sa.Integer(), nullable=True),
        sa.Column("test_cost_usd", sa.Numeric(precision=12, scale=6), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["added_by_id"],
            ["users.id"],
            name=op.f("fk_llm_providers_added_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_llm_providers")),
    )
    op.create_table(
        "llm_provider_models",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["llm_providers.id"],
            name=op.f("fk_llm_provider_models_provider_id_llm_providers"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_llm_provider_models")),
        sa.UniqueConstraint("provider_id", "name", name="uq_llm_provider_models_name"),
    )
    op.create_index(
        op.f("ix_llm_provider_models_provider_id"), "llm_provider_models", ["provider_id"]
    )
    op.create_table(
        "llm_task_models",
        sa.Column("task", sa.String(length=30), nullable=False),
        sa.Column("provider_model_id", sa.Uuid(), nullable=False),
        sa.Column(
            "since", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("assigned_by_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["assigned_by_id"],
            ["users.id"],
            name=op.f("fk_llm_task_models_assigned_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["provider_model_id"],
            ["llm_provider_models.id"],
            name=op.f("fk_llm_task_models_provider_model_id_llm_provider_models"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("task", name=op.f("pk_llm_task_models")),
    )


def downgrade() -> None:
    op.drop_table("llm_task_models")
    op.drop_index(op.f("ix_llm_provider_models_provider_id"), table_name="llm_provider_models")
    op.drop_table("llm_provider_models")
    op.drop_table("llm_providers")
