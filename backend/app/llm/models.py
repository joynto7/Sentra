import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.models import Timestamps, UUIDPrimaryKey


class LLMUsage(UUIDPrimaryKey, Base):
    """One request through the LLM layer: for which organization and task, which model, the tokens
    and the cost (FR-10.4), and what was masked (NFR-9.6). A failed request is kept as well: its
    data reached the provider, and it counts for UC-10.5 step 2."""

    __tablename__ = "llm_usage"
    __table_args__ = (
        Index("ix_llm_usage_organization_id_created_at", "organization_id", "created_at"),
    )

    # None for the platform's own test requests (UC-10.4 step 3)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE")
    )
    # The campaign run the request served, e.g. as its LLM judge: the run's cost (UC-5.6 step 2)
    # and, per task, the model that served it (report, class diagram 6b: ModelUsage)
    campaign_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="SET NULL"), index=True
    )
    task: Mapped[str] = mapped_column(String(30))
    model: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(50))
    deployment: Mapped[str] = mapped_column(String(10))
    prompt_tokens: Mapped[int] = mapped_column(default=0)
    completion_tokens: Mapped[int] = mapped_column(default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0))
    duration_ms: Mapped[int] = mapped_column(default=0)
    succeeded: Mapped[bool]
    error: Mapped[str | None] = mapped_column(String(200))
    masked: Mapped[dict] = mapped_column(JSONB, default=dict)  # e.g. {"EMAIL": 2, "SECRET": 1}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LLMProvider(UUIDPrimaryKey, Timestamps, Base):
    """A provider the Platform Administrator configured (FR-10.3, UC-10.4): a commercial API or a
    model server on the platform. Its API key is stored encrypted here, in the LLM layer, and is
    never read again outside `app/llm` (UC-10.4 quality requirement 2).

    `prefix` is the LiteLLM provider name, so a model of this provider is called
    "<prefix>/<model>" and switching providers stays a change of configuration (NFR-7.3).
    """

    __tablename__ = "llm_providers"

    name: Mapped[str] = mapped_column(String(80))  # what the cards show, e.g. "Anthropic"
    kind: Mapped[str] = mapped_column(String(30))  # ProviderKind: what the page offered
    prefix: Mapped[str] = mapped_column(String(30))  # the LiteLLM provider, e.g. "ollama_chat"
    base_url: Mapped[str | None] = mapped_column(String(300))
    # AES-256-GCM, context "llm-provider-key:<provider id>" (app/core/crypto.py); None for a
    # provider that needs no key, such as Ollama on the platform.
    api_key_encrypted: Mapped[str | None] = mapped_column(String(500))
    # Decided when the provider is saved (UC-10.4 step 5) and never guessed again: "external"
    # means the organization's data leaves the platform.
    deployment: Mapped[str] = mapped_column(String(10))
    added_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # The last connection test of UC-10.4 step 3, as the card shows it.
    tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    test_reply: Mapped[str | None] = mapped_column(String(500))
    test_duration_ms: Mapped[int | None]
    test_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))

    models: Mapped[list["LLMProviderModel"]] = relationship(
        back_populates="provider", cascade="all, delete-orphan", order_by="LLMProviderModel.name"
    )

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key_encrypted)


class LLMProviderModel(Base):
    """One model of a provider, named the provider's own way, e.g. "claude-sonnet-5-5" or
    "llama3.1:8b". `label` is what a person calls it, e.g. "Claude Sonnet"."""

    __tablename__ = "llm_provider_models"
    __table_args__ = (UniqueConstraint("provider_id", "name", name="uq_llm_provider_models_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    provider_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("llm_providers.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    label: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    provider: Mapped[LLMProvider] = relationship(back_populates="models")


class LLMTaskModel(Base):
    """Which model does which task of Sentra's own AI (UC-10.4 step 4). One row per task: the
    change itself is kept in the audit log, this table holds what is in force and since when."""

    __tablename__ = "llm_task_models"

    task: Mapped[str] = mapped_column(String(30), primary_key=True)  # LLMTask
    provider_model_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("llm_provider_models.id", ondelete="RESTRICT")
    )
    since: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    assigned_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    model: Mapped[LLMProviderModel] = relationship()


def key_context(provider_id: uuid.UUID) -> str:
    """The encryption context of a provider's API key: a key copied to another row cannot be
    decrypted there (app/core/crypto.py)."""
    return f"llm-provider-key:{provider_id}"
