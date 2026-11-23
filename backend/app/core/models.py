import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func, text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from app.core.database import Base


class UUIDPrimaryKey:
    """Random UUID primary key, so IDs cannot be guessed or enumerated."""

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Organization(UUIDPrimaryKey, Timestamps, Base):
    """The tenant. Every organization's data is isolated from every other's (FR-1.4)."""

    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    # Every member must use two-step verification (FR-1.2, UC-1.7).
    mfa_required: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    # UC-10.5: none of the organization's data goes to an external LLM provider. The LLM layer
    # reads it at every request, so a change applies at once, also to running campaign runs.
    local_models_only: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    # The organization's monthly limits (FR-10.4, UC-10.6), set by a Platform Administrator on
    # Screen 61. None means the platform's default from the settings (1a1), so a new organization
    # needs nothing set and raising a default lifts every organization without a limit of its own.
    # Who changed a limit and when is in the audit log (FR-10.2).
    limit_campaign_runs: Mapped[int | None]
    limit_attempts: Mapped[int | None]
    limit_llm_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    limit_warn_percent: Mapped[int | None]  # the organization is warned at this share of a limit


class OrganizationScoped:
    """Mixin for every table whose rows belong to exactly one organization (NFR-3.3)."""

    @declared_attr
    def organization_id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
