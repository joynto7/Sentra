import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import crypto
from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


def _now() -> datetime:
    return datetime.now(UTC)


class TargetType(StrEnum):
    CHATBOT = "chatbot"
    RAG_APPLICATION = "rag_application"
    TOOL_USING_AGENT = "tool_using_agent"


class Environment(StrEnum):
    STAGING = "staging"
    PRODUCTION = "production"


class VerificationMethod(StrEnum):
    """How the owner proves control of the target (UC-2.3 step 1, class diagram 2)."""

    DNS_TXT_RECORD = "dns_txt_record"
    WELL_KNOWN_FILE = "well_known_file"
    LAB = "lab"  # Sentra's own lab target: Sentra places the token itself (report 2.3.2)


class CheckStatus(StrEnum):
    RUNNING = "running"  # the worker hasn't finished yet
    PASSED = "passed"
    FAILED = "failed"


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
    # Who verified the target, when and how (UC-2.3 step 5); empty while it is unverified.
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    verification_method: Mapped[str | None] = mapped_column(String(20))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # When it was retired and by whom (FR-2.6; UC-2.6). Both are cleared when it is restored.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_by_id: Mapped[uuid.UUID | None] = mapped_column(
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


class ConnectionTest(UUIDPrimaryKey, Base):
    """One connection test (UC-2.2): a single harmless request, and what came back. The result
    and the response time are recorded with the target (step 5)."""

    __tablename__ = "target_connection_tests"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(10), default=CheckStatus.RUNNING)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status_code: Mapped[int | None]
    duration_ms: Mapped[int | None]
    reply_path: Mapped[str | None] = mapped_column(String(300))
    # The reply as plain text, masked and shortened (NFR-3.6): never shown as active content
    reply_excerpt: Mapped[str | None] = mapped_column(Text)
    error_kind: Mapped[str | None] = mapped_column(String(20))
    error_message: Mapped[str | None] = mapped_column(Text)
    # UC-2.2, 4a: the part of the answer that couldn't be read
    unreadable_excerpt: Mapped[str | None] = mapped_column(Text)


class OwnershipVerification(UUIDPrimaryKey, Base):
    """One check of the ownership token (FR-2.3): by the owner with "Check now" (UC-2.3), or by
    Sentra before a campaign run (UC-5.4 step 1). Every check is kept, so the target's history
    shows who verified it, when and how."""

    __tablename__ = "ownership_verifications"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    method: Mapped[str] = mapped_column(String(20))
    trigger: Mapped[str] = mapped_column(String(20))  # "check_now" or "campaign_run"
    checked_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(10), default=CheckStatus.RUNNING)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_location: Mapped[str] = mapped_column(String(500))  # the DNS name or the file's URL
    found: Mapped[str | None] = mapped_column(Text)  # what was there, shortened
    message: Mapped[str | None] = mapped_column(Text)  # the explanation for the user (4a, 4b)

    @property
    def result(self) -> bool:
        return self.status == CheckStatus.PASSED


class ProfileStatus(StrEnum):
    MAPPING = "mapping"  # the discovery requests are being sent (UC-2.4 steps 1-3)
    READY = "ready"  # mapped, waiting for review (step 4)
    PARTIAL = "partial"  # stopped early, e.g. on overload (2a)
    FAILED = "failed"  # nothing could be mapped; enter it by hand
    REVIEWED = "reviewed"  # saved by a person (step 6)


class TargetProfile(UUIDPrimaryKey, Timestamps, Base):
    """The attack surface of a target (FR-2.5): model behaviour, tools and their parameters,
    knowledge sources, authentication, input and output formats and observed rate limits. Every
    entry says whether it was discovered, added by hand or is still unknown (UC-2.4 step 6)."""

    __tablename__ = "target_profiles"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), unique=True
    )
    status: Mapped[str] = mapped_column(String(10))
    version: Mapped[int] = mapped_column(default=1)
    # Who started the mapping, by verifying the target or with "Update profile": the person who
    # is told that the profile is ready (UC-2.4 step 4)
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    mapped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    discovery_requests: Mapped[int] = mapped_column(default=0)
    stop_reason: Mapped[str | None] = mapped_column(Text)
    # {key: {"value": "...", "source": "discovered" | "manual" | "unknown", "note": "..."}}
    entries: Mapped[dict] = mapped_column(JSONB, default=dict)
    # [{"name", "description", "access", "source"}]
    knowledge_sources: Mapped[list] = mapped_column(JSONB, default=list)
    # [{"name", "parameters", "side_effect", "source"}]
    tools: Mapped[list] = mapped_column(JSONB, default=list)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class TargetProfileRevision(UUIDPrimaryKey, Base):
    """Each saved state of a profile, so every change is in the target's history (UC-2.4,
    quality requirement 6)."""

    __tablename__ = "target_profile_revisions"
    __table_args__ = (UniqueConstraint("profile_id", "version"),)

    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("target_profiles.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int]
    kind: Mapped[str] = mapped_column(String(10))  # "mapped" or "reviewed"
    saved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    content: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


class TargetCanary(UUIDPrimaryKey, Base):
    """A canary token planted in a target: a unique marker whose appearance where it must not be
    proves a weakness without harmful content (glossary). A lab target's tokens come from the lab
    itself; for other targets Sentra makes them and the owner plants them. Earlier tokens stay
    recorded (retired), so old evidence can still be checked (UC-11.2)."""

    __tablename__ = "target_canaries"
    __table_args__ = (
        Index(
            "uq_target_canaries_one_current",
            "target_id",
            "slot",
            unique=True,
            postgresql_where=text("retired_at IS NULL"),
        ),
    )

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    slot: Mapped[str] = mapped_column(String(30))  # where it is planted, see canaries.SLOTS
    token: Mapped[str] = mapped_column(String(120))
    topic: Mapped[str | None] = mapped_column(String(200))  # what to ask about to reach it
    source: Mapped[str] = mapped_column(String(10))  # "lab" or "generated"
    planted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
