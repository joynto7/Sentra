import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import crypto
from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


class TargetType(StrEnum):
    CHATBOT = "chatbot"
    RAG_APPLICATION = "rag_application"
    TOOL_USING_AGENT = "tool_using_agent"


class Environment(StrEnum):
    STAGING = "staging"
    PRODUCTION = "production"


class TargetStatus(StrEnum):
    """The target statuses of the report's state diagram (UC-2.1, UC-2.3, UC-2.6)."""

    UNVERIFIED = "unverified"  # registered; ownership not proved yet, so it cannot be tested
    VERIFIED = "verified"
    ARCHIVED = "archived"


class CredentialType(StrEnum):
    API_KEY = "api_key"  # an API key in a header that the user names, e.g. X-Api-Key
    BEARER_TOKEN = "bearer_token"  # sent as "Authorization: Bearer <token>"
    CUSTOM_HEADER = "custom_header"


class Target(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    """An AI application that an organization registered for testing (FR-2.1)."""

    __tablename__ = "targets"

    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(30))
    endpoint_url: Mapped[str] = mapped_column(String(2048))
    environment: Mapped[str] = mapped_column(String(20))
    max_request_rate: Mapped[int]  # requests per minute; Sentra never sends faster (FR-5.7)
    # None = OpenAI-compatible chat API. Otherwise a JSON body with {{message}} placeholders.
    request_template: Mapped[str | None] = mapped_column(Text)
    # Where the reply and the tool calls are in the response: {"reply": "$.output.text", ...}.
    response_template: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), server_default=TargetStatus.UNVERIFIED.value)
    # Published by the owner to prove control of the target (FR-2.3).
    verification_token: Mapped[str] = mapped_column(String(64))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    credentials: Mapped[list["TargetCredential"]] = relationship(
        back_populates="target", cascade="all, delete-orphan", order_by="TargetCredential.name"
    )


class TargetCredential(UUIDPrimaryKey, Timestamps, Base):
    """A secret needed to call a target, encrypted with AES-256 (FR-2.2, NFR-3.1). It belongs to
    its target and is deleted with it; only the Target Connector decrypts it."""

    __tablename__ = "target_credentials"
    __table_args__ = (UniqueConstraint("target_id", "name"),)

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))  # the header that carries the secret
    credential_type: Mapped[str] = mapped_column(String(20))
    encrypted_value: Mapped[str] = mapped_column(Text)

    target: Mapped[Target] = relationship(back_populates="credentials")

    @property
    def context(self) -> str:
        """Binds the encrypted value to this target and header, so it can't be moved elsewhere."""
        return f"target-credential:{self.target_id}:{self.name.lower()}"

    def set_value(self, value: str) -> None:
        self.encrypted_value = crypto.encrypt(value, self.context)

    def decrypt(self) -> str:
        """Only the Target Connector calls this, at the moment it calls the target (FR-2.2)."""
        return crypto.decrypt(self.encrypted_value, self.context)


class TargetPacing(Base):
    """When the next request to a target may leave. The Target Connector spaces its requests with
    it, so a target never gets more than its rate, whatever the number of workers (FR-5.7)."""

    __tablename__ = "target_pacing"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), primary_key=True
    )
    next_request_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
