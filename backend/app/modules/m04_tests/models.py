import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import UUIDPrimaryKey


class TestDefinition(UUIDPrimaryKey, Base):
    """One version of a test definition. A change never edits a row: it adds a new version
    and marks it current, so past campaign runs stay reproducible (FR-4.5)."""

    __tablename__ = "test_definitions"
    __test__ = False  # not a pytest test class
    __table_args__ = (
        # A code is unique per organization; built-in tests (no organization) count as one group.
        UniqueConstraint("organization_id", "code", "version", postgresql_nulls_not_distinct=True),
        Index("ix_test_definitions_current", "is_current"),
        # Only one current version per test, even when two people save at the same moment.
        Index(
            "uq_test_definitions_one_current",
            "organization_id",
            "code",
            unique=True,
            postgresql_where=text("is_current"),
            postgresql_nulls_not_distinct=True,
        ),
    )

    code: Mapped[str] = mapped_column(String(40))
    version: Mapped[int]
    is_current: Mapped[bool]
    origin: Mapped[str] = mapped_column(String(20))  # "built_in" or "custom" (FR-4.3)
    # A retired custom test is left out of the catalogue and of future campaign runs (UC-4.3, 3a).
    # Retiring is a change, so it is saved as a new version that has this set.
    retired: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    # Custom tests belong to one organization; built-in tests have no organization.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE")
    )

    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(5))
    severity: Mapped[str] = mapped_column(String(15))
    objective: Mapped[str] = mapped_column(Text)
    prerequisites: Mapped[str] = mapped_column(Text)
    target_types: Mapped[list[str]] = mapped_column(JSONB)
    success_condition: Mapped[str] = mapped_column(Text)
    detection_methods: Mapped[list[dict]] = mapped_column(JSONB)
    success_rules: Mapped[list[dict]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    attempt_template: Mapped[str] = mapped_column(String(80))
    recommended_mitigation: Mapped[str] = mapped_column(Text)
    atlas: Mapped[list[str]] = mapped_column(JSONB)

    content_hash: Mapped[str] = mapped_column(String(64))
    change_note: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
