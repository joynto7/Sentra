import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import UUIDPrimaryKey


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
