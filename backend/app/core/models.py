import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
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


class OrganizationScoped:
    """Mixin for every table whose rows belong to exactly one organization (NFR-3.3)."""

    @declared_attr
    def organization_id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
