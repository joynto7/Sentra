"""What the assistant keeps: each person's conversations, and the actions it proposed in them.

A conversation belongs to one person in one organization and is never shown to anyone else, not
even to an Organization Administrator. It is deleted with the person's account and by the daily
clean-up after `RETENTION_DAYS` (schedules.py).
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey

RETENTION_DAYS = 90


def _now() -> datetime:
    """The time is taken here, not by the database's now(), which stays the same for the whole
    transaction: messages of one conversation must keep their order even when a test (or a batch)
    saves several in one."""
    return datetime.now(UTC)


class ActionStatus:
    PENDING = "pending"  # proposed; waits for the person
    RUNNING = "running"  # confirmed, and being done
    DONE = "done"
    FAILED = "failed"  # the person confirmed it and the API refused it
    CANCELLED = "cancelled"


class Conversation(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    __tablename__ = "assistant_conversations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(120), default="New conversation")


class Message(UUIDPrimaryKey, Base):
    __tablename__ = "assistant_messages"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(12))  # "user" or "assistant"
    content: Mapped[str] = mapped_column(Text, default="")
    # What the assistant did to answer, as the page shows it: [{tool, label, status, summary}].
    steps: Mapped[list] = mapped_column(JSONB, default=list)
    # The result cards the page draws (a list of targets, a finding, the risk figures).
    cards: Mapped[list] = mapped_column(JSONB, default=list)
    suggestions: Mapped[list] = mapped_column(JSONB, default=list)
    # The model's own side of the turn, in the OpenAI form, so the next turn can continue from it.
    trace: Mapped[list] = mapped_column(JSONB, default=list)
    mode: Mapped[str] = mapped_column(String(10), default="ai")  # "ai" or "guide"
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


class Action(UUIDPrimaryKey, OrganizationScoped, Base):
    """A change the assistant proposed. Nothing is sent until the person confirms it, and the
    arguments that are shown are the arguments that are sent."""

    __tablename__ = "assistant_actions"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="CASCADE"), index=True
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assistant_messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    tool: Mapped[str] = mapped_column(String(60))
    tool_call_id: Mapped[str] = mapped_column(String(80), default="")
    arguments: Mapped[dict] = mapped_column(JSONB, default=dict)
    summary: Mapped[str] = mapped_column(Text)
    risk: Mapped[str] = mapped_column(String(10), default="normal")  # "normal" or "high"
    status: Mapped[str] = mapped_column(String(10), default=ActionStatus.PENDING)
    result: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
