"""Module 11's tables. The lab target itself is an ordinary `Target` (UC-11.1 step 4), so this
holds only what the Security Lab knows on top of it (FR-11.2)."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, UUIDPrimaryKey


class LabState(StrEnum):
    """Readiness, as Screen 65 shows it in words."""

    DEPLOYING = "deploying"  # UC-11.1 step 2: the worker is reading what it reports
    READY = "ready"
    RESETTING = "resetting"  # UC-11.2 step 1: no campaign run may use it
    NOT_READY = "not_ready"  # a reset failed twice (UC-11.2, 5a1), or it can't be reached


class LabDeployment(UUIDPrimaryKey, OrganizationScoped, Base):
    """One lab target of the catalogue, deployed in one organization (UC-11.1, NFR-3.3): which
    one it is, whether it is ready, and what it reported about itself.

    The resets are kept in the target's own history through the audit log (FR-2.6), so there is no
    second history here; this row holds what the page needs at a glance.
    """

    __tablename__ = "lab_deployments"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), unique=True
    )
    lab_key: Mapped[str] = mapped_column(String(40))  # catalogue.CATALOGUE
    state: Mapped[str] = mapped_column(String(20), default=LabState.READY)
    # What the lab target itself says it is vulnerable to (FR-11.1), read from /lab/state
    known_vulnerabilities: Mapped[list] = mapped_column(JSONB, default=list)
    deployed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resets: Mapped[int] = mapped_column(default=0)
    last_error: Mapped[str | None] = mapped_column(Text)  # why it is not ready, in words
