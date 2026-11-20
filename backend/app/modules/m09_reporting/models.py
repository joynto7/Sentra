import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import UUIDPrimaryKey


def _now() -> datetime:
    return datetime.now(UTC)


class Notification(UUIDPrimaryKey, Base):
    """One in-app notification for one person (FR-9.3, UC-9.3). Several events of the same kind
    in a short time share one notification with a count (UC-9.3, 1a)."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_id_read_at", "user_id", "read_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # None for alerts about the account itself, which show in every organization of the user.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE")
    )
    event: Mapped[str] = mapped_column(String(40))
    text: Mapped[str] = mapped_column(
        String(300)
    )  # the sentence, e.g. "F-1168 was assigned to you"
    subject: Mapped[str] = mapped_column(String(120))  # the part shown in bold, e.g. "F-1168"
    link: Mapped[str | None] = mapped_column(String(300))  # the related item, inside Sentra
    count: Mapped[int] = mapped_column(default=1)
    group_key: Mapped[str | None] = mapped_column(String(120))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    # The latest event of the group: the time shown, and the order of the list.
    last_event_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


class NotificationPreference(UUIDPrimaryKey, Base):
    """A user's choice for one event (UC-1.11 step 2). Without a row, both channels are on."""

    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "event"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event: Mapped[str] = mapped_column(String(40))
    in_app: Mapped[bool]
    email: Mapped[bool]
