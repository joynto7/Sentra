"""The audit log (FR-10.2, NFR-8.3): every security-relevant action, append-only and tamper-evident.

Every module records its own actions with record(), for example:

    audit.record(db, organization_id=membership.organization_id, actor=user,
                 action="target.registered", summary=f"Registered target {target.name}",
                 item=audit.Item("target", target.id, target.name))

The entry joins the caller's transaction, so an action and its entry are saved together or not at
all (NFR-2.4); the caller commits as usual. Each organization has its own chain of entries, and
platform-wide actions have one more chain. Every entry stores the hash of the entry before it, so
changing or deleting an entry breaks the chain, which verify() detects (NFR-8.3). A database
trigger refuses every UPDATE and DELETE, so not even an administrator can change an entry.

Entries never contain secrets such as passwords, tokens or keys (UC-10.3): `details` holds only
names and settings, and keys that sound like secrets are dropped.
"""

import hashlib
import json
import uuid
from collections.abc import Iterator
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import (
    DDL,
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    event,
    select,
)
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.database import Base
from app.core.models import UUIDPrimaryKey

PLATFORM = "platform"  # the chain of platform-wide actions, which belong to no organization
GENESIS = "0" * 64  # the "previous hash" of the first entry of a chain

# ---------------------------------------------------------------- where a request came from

_source_address: ContextVar[str | None] = ContextVar("audit_source_address", default=None)


class SourceAddressMiddleware:
    """Remembers the address of each API request, so record() can store where an action came
    from without every function passing it on (UC-10.3 step 1: "source address")."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        token = _source_address.set(client[0] if client else None)
        try:
            await self.app(scope, receive, send)
        finally:
            _source_address.reset(token)


def current_source_address() -> str | None:
    return _source_address.get()


# ---------------------------------------------------------------- tables


class AuditChain(Base):
    """The newest entry of one chain, locked while an entry is added, so two actions at the same
    moment never get the same number. It also keeps the result of the last full check."""

    __tablename__ = "audit_chains"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)  # organization id or PLATFORM
    last_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    last_hash: Mapped[str] = mapped_column(String(64), default=GENESIS)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_ok: Mapped[bool | None]
    checked_entries: Mapped[int] = mapped_column(BigInteger, default=0)
    broken_seq: Mapped[int | None] = mapped_column(BigInteger)


class AuditLogEntry(UUIDPrimaryKey, Base):
    """One recorded action. Never changed or deleted (trigger below)."""

    __tablename__ = "audit_log_entries"
    __table_args__ = (
        UniqueConstraint("chain", "seq"),
        Index("ix_audit_log_entries_org_time", "organization_id", "occurred_at"),
        Index("ix_audit_log_entries_org_action", "organization_id", "action"),
        Index("ix_audit_log_entries_org_actor", "organization_id", "actor_id"),
        Index("ix_audit_log_entries_org_item", "organization_id", "item_type", "item_id"),
    )

    chain: Mapped[str] = mapped_column(String(40))
    seq: Mapped[int] = mapped_column(BigInteger)  # 1, 2, 3 … within the chain, without gaps
    # None for platform-wide entries (UC-10.3, 1a)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("organizations.id"))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # "user", "sentra" (an automatic action) or "api_key" (FR-9.5). The ID and name are a copy, not
    # a foreign key: the entry must stay as it was, even when the account changes or goes.
    actor_type: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[uuid.UUID | None]
    actor_name: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(60))  # an event code such as member.role_changed
    summary: Mapped[str] = mapped_column(String(500))  # the action as a sentence
    item_type: Mapped[str | None] = mapped_column(String(30))
    item_id: Mapped[str | None] = mapped_column(String(64))
    item_label: Mapped[str | None] = mapped_column(String(200))
    source_address: Mapped[str | None] = mapped_column(String(45))
    details: Mapped[dict] = mapped_column(JSONB, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64))


# NFR-8.3: entries are append-only. Attached to the table, so the tests' create_all() makes the
# trigger as well as the migration does. Only a retention purge of entries older than the minimum
# period (FR-10.5, NFR-8.3) may delete, and it must say so with SET LOCAL sentra.audit_purge = 'on'.
APPEND_ONLY_FUNCTION = DDL(
    """
CREATE OR REPLACE FUNCTION sentra_audit_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('sentra.audit_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Audit log entries can''t be changed or deleted.'
        USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql
"""
)
APPEND_ONLY_TRIGGER = DDL(
    "CREATE TRIGGER audit_log_entries_append_only BEFORE UPDATE OR DELETE ON audit_log_entries "
    "FOR EACH ROW EXECUTE FUNCTION sentra_audit_append_only()"
)
event.listen(AuditLogEntry.__table__, "after_create", APPEND_ONLY_FUNCTION)
event.listen(AuditLogEntry.__table__, "after_create", APPEND_ONLY_TRIGGER)


# ---------------------------------------------------------------- recording


class Actor(Protocol):
    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class Item:
    """What an action affected, so the audit log can link to it (UC-10.3 step 3)."""

    type: str  # target, member, invitation, organization, test, suite, campaign, finding …
    id: uuid.UUID | str | None
    label: str


# Keys whose values must never reach the audit log (UC-10.3, quality requirement 4).
_SECRET_KEYS = {"password", "new_password", "secret", "token", "value", "api_key", "credentials"}


def _clean(details: dict | None) -> dict:
    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items() if k.lower() not in _SECRET_KEYS}
        if isinstance(value, list | tuple):
            return [clean(v) for v in value]
        if isinstance(value, uuid.UUID | datetime):
            return str(value)
        return value

    return clean(details or {})


def chain_key(organization_id: uuid.UUID | None) -> str:
    return str(organization_id) if organization_id else PLATFORM


def digest(entry: AuditLogEntry) -> str:
    """SHA-256 of the entry's content and the previous entry's hash, as canonical JSON (sorted
    keys, no spaces). An auditor can recompute it from an export (UC-10.3 step 5)."""
    payload = {
        "chain": entry.chain,
        "seq": entry.seq,
        "occurred_at": entry.occurred_at.astimezone(UTC).isoformat(timespec="microseconds"),
        "actor_type": entry.actor_type,
        "actor_id": str(entry.actor_id) if entry.actor_id else None,
        "actor_name": entry.actor_name,
        "action": entry.action,
        "summary": entry.summary,
        "item_type": entry.item_type,
        "item_id": entry.item_id,
        "item_label": entry.item_label,
        "source_address": entry.source_address,
        "details": entry.details,
        "prev_hash": entry.prev_hash,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


_UNSET: Any = object()


def record(
    db: Session,
    *,
    organization_id: uuid.UUID | None,
    action: str,
    summary: str,
    actor: Actor | None = None,
    actor_type: str | None = None,
    actor_name: str | None = None,
    item: Item | None = None,
    details: dict | None = None,
    source_address: str | None = _UNSET,
) -> AuditLogEntry:
    """Adds one entry to the chain of `organization_id` (None = the platform chain). Without an
    actor the action is Sentra's own, such as an automatic deletion. The caller commits."""
    key = chain_key(organization_id)
    db.execute(insert(AuditChain).values(key=key).on_conflict_do_nothing(index_elements=["key"]))
    head = db.scalar(select(AuditChain).where(AuditChain.key == key).with_for_update())
    entry = AuditLogEntry(
        chain=key,
        seq=head.last_seq + 1,
        organization_id=organization_id,
        occurred_at=datetime.now(UTC),
        actor_type=actor_type or ("user" if actor is not None else "sentra"),
        actor_id=actor.id if actor is not None else None,
        actor_name=(actor_name or (actor.name if actor is not None else "Sentra"))[:200],
        action=action,
        summary=summary[:500],
        item_type=item.type if item else None,
        item_id=str(item.id) if item and item.id is not None else None,
        item_label=item.label[:200] if item else None,
        source_address=current_source_address() if source_address is _UNSET else source_address,
        details=_clean(details),
        prev_hash=head.last_hash,
    )
    entry.entry_hash = digest(entry)
    head.last_seq, head.last_hash = entry.seq, entry.entry_hash
    db.add(entry)
    return entry


def record_in_each(
    db: Session, organization_ids: list[uuid.UUID], **fields: Any
) -> list[AuditLogEntry]:
    """The same action in several organizations' logs, e.g. the login of a member of two
    organizations: each organization's administrators see it in their own log."""
    return [record(db, organization_id=oid, **fields) for oid in dict.fromkeys(organization_ids)]


# ---------------------------------------------------------------- checking


@dataclass
class Integrity:
    ok: bool
    entries: int
    checked_at: datetime
    broken_seq: int | None = None  # the first entry that doesn't fit the chain


def _entries(db: Session, key: str) -> Iterator[AuditLogEntry]:
    query = select(AuditLogEntry).where(AuditLogEntry.chain == key).order_by(AuditLogEntry.seq)
    yield from db.scalars(query.execution_options(yield_per=1000))


def verify(db: Session, organization_id: uuid.UUID | None) -> Integrity:
    """Checks the whole chain: every entry's hash, its link to the entry before it, and that no
    number is missing. Stores the result for the "Hash chain verified" line of Screen 58."""
    key = chain_key(organization_id)
    count, broken, previous = 0, None, None
    for entry in _entries(db, key):
        count += 1
        linked = (
            entry.prev_hash == previous.entry_hash and entry.seq == previous.seq + 1
            if previous is not None
            else True  # the oldest kept entry starts the check (older ones may be purged)
        )
        if broken is None and (not linked or digest(entry) != entry.entry_hash):
            broken = entry.seq
        previous = entry
    head = db.get(AuditChain, key)
    newest_missing = (
        previous is not None
        and head is not None
        and (head.last_seq != previous.seq or head.last_hash != previous.entry_hash)
    )
    if broken is None and newest_missing:
        broken = previous.seq  # the newest entries were removed
    result = Integrity(
        ok=broken is None, entries=count, checked_at=datetime.now(UTC), broken_seq=broken
    )
    if head is not None:
        head.checked_at, head.checked_ok = result.checked_at, result.ok
        head.checked_entries, head.broken_seq = count, broken
        db.commit()
    return result


def last_check(db: Session, organization_id: uuid.UUID | None) -> Integrity | None:
    head = db.get(AuditChain, chain_key(organization_id))
    if head is None or head.checked_at is None:
        return None
    return Integrity(
        ok=bool(head.checked_ok),
        entries=head.checked_entries,
        checked_at=head.checked_at,
        broken_seq=head.broken_seq,
    )
