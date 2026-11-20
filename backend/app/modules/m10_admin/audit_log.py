"""Reviewing the audit log (FR-10.2, UC-10.3): list and filter, open one entry, check the hash
chain and export it for external auditors. Recording entries is app/core/audit.py.

Organization Administrators see only their organization's chain; Platform Administrators see the
platform chain, which holds platform-wide actions and none of an organization's content
(UC-10.3, 1a; NFR-3.3).
"""

import csv
import io
import json
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Select, false, func, or_, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.audit import AuditLogEntry
from app.core.email import send_email
from app.core.errors import NotFoundError
from app.core.models import Organization
from app.modules.m10_admin import actions

# How old the last full check of the chain may be before the page checks it again.
RECHECK_AFTER = timedelta(hours=1)


@dataclass
class Filters:
    start: datetime | None = None
    end: datetime | None = None
    actor_id: uuid.UUID | None = None
    group: str = ""
    item_type: str = ""
    item_id: str = ""
    search: str = ""


def _query(organization_id: uuid.UUID | None, filters: Filters) -> Select[tuple[AuditLogEntry]]:
    query = select(AuditLogEntry).where(AuditLogEntry.chain == audit.chain_key(organization_id))
    if filters.start:
        query = query.where(AuditLogEntry.occurred_at >= filters.start)
    if filters.end:
        query = query.where(AuditLogEntry.occurred_at < filters.end)
    if filters.actor_id:
        query = query.where(AuditLogEntry.actor_id == filters.actor_id)
    if filters.group:
        starts = actions.prefixes(filters.group)
        matches = [AuditLogEntry.action.startswith(prefix) for prefix in starts]
        query = query.where(or_(*matches) if matches else false())
    if filters.item_type:
        query = query.where(AuditLogEntry.item_type == filters.item_type)
    if filters.item_id:
        query = query.where(AuditLogEntry.item_id == filters.item_id)
    if filters.search.strip():
        like = "%" + re.sub(r"([%_\\])", r"\\\1", filters.search.strip()) + "%"
        query = query.where(
            or_(
                AuditLogEntry.summary.ilike(like, escape="\\"),
                AuditLogEntry.item_label.ilike(like, escape="\\"),
                AuditLogEntry.actor_name.ilike(like, escape="\\"),
                AuditLogEntry.action.ilike(like, escape="\\"),
            )
        )
    return query


def list_entries(
    db: Session, organization_id: uuid.UUID | None, filters: Filters, page: int, page_size: int
) -> tuple[list[AuditLogEntry], int]:
    """Newest first, one page at a time (UC-10.3 steps 1-2, NFR-6.2)."""
    query = _query(organization_id, filters)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = db.scalars(
        query.order_by(AuditLogEntry.seq.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return list(items), total


def filter_options(db: Session, organization_id: uuid.UUID | None) -> dict:
    """The people, action groups and kinds of item that occur in the log, for the filters."""
    key = audit.chain_key(organization_id)
    people = db.execute(
        select(AuditLogEntry.actor_id, func.max(AuditLogEntry.actor_name))
        .where(AuditLogEntry.chain == key, AuditLogEntry.actor_id.is_not(None))
        .group_by(AuditLogEntry.actor_id)
        .order_by(func.max(AuditLogEntry.actor_name))
    ).all()
    found = db.scalars(
        select(AuditLogEntry.action).where(AuditLogEntry.chain == key).distinct()
    ).all()
    groups = {actions.group_of(action) for action in found} - {None}
    item_types = db.scalars(
        select(AuditLogEntry.item_type)
        .where(AuditLogEntry.chain == key, AuditLogEntry.item_type.is_not(None))
        .distinct()
        .order_by(AuditLogEntry.item_type)
    ).all()
    return {
        "actors": [{"id": actor_id, "name": name} for actor_id, name in people],
        "groups": [
            {"key": key, "label": label}
            for key, (label, _) in actions.GROUPS.items()
            if key in groups
        ],
        "item_types": list(item_types),
    }


def get_entry(db: Session, organization_id: uuid.UUID | None, entry_id: uuid.UUID) -> AuditLogEntry:
    entry = db.scalar(
        select(AuditLogEntry).where(
            AuditLogEntry.id == entry_id, AuditLogEntry.chain == audit.chain_key(organization_id)
        )
    )
    if entry is None:  # also an entry of another organization (NFR-3.3)
        raise NotFoundError("Audit log entry not found.")
    return entry


def integrity(db: Session, organization_id: uuid.UUID | None) -> audit.Integrity | None:
    """The last full check of the chain, repeated when it is older than an hour. None while the
    log is still empty."""
    last = audit.last_check(db, organization_id)
    if last is None or datetime.now(UTC) - last.checked_at > RECHECK_AFTER:
        if db.get(audit.AuditChain, audit.chain_key(organization_id)) is None:
            return None
        last = check(db, organization_id)
    return last


def check(db: Session, organization_id: uuid.UUID | None) -> audit.Integrity:
    """A full check of the chain. If it fails, the Platform Administrators are alerted (UC-10.3,
    5a); the alert names the organization and the entry, never their content."""
    result = audit.verify(db, organization_id)
    if not result.ok:
        _alert_platform_admins(db, organization_id, result)
    return result


def _alert_platform_admins(
    db: Session, organization_id: uuid.UUID | None, result: audit.Integrity
) -> None:
    from app.modules.m01_users.models import User  # Module 1 owns accounts

    where = "the platform audit log"
    if organization_id is not None:
        organization = db.get(Organization, organization_id)
        where = f"the audit log of {organization.name if organization else organization_id}"
    for admin in db.scalars(select(User).where(User.platform_admin.is_(True))):
        send_email(
            admin.email,
            "Sentra: an audit log failed its integrity check",
            f"Hello {admin.name},\n\nThe hash chain of {where} doesn't match from entry "
            f"{result.broken_seq} on: an entry may have been changed or removed outside Sentra. "
            "Exports mark the affected entries as not verifiable.\n",
        )


# ---------------------------------------------------------------- export


EXPORT_FIELDS = [
    "seq",
    "occurred_at",
    "actor_type",
    "actor_id",
    "actor_name",
    "action",
    "summary",
    "item_type",
    "item_id",
    "item_label",
    "source_address",
    "details",
    "prev_hash",
    "entry_hash",
    "verified",
]


def _row(entry: AuditLogEntry, broken_from: int | None) -> dict:
    verified = audit.digest(entry) == entry.entry_hash and (
        broken_from is None or entry.seq < broken_from
    )
    return {
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
        "entry_hash": entry.entry_hash,
        "verified": verified,
    }


def export(
    db: Session,
    organization_id: uuid.UUID | None,
    filters: Filters,
    file_format: str,
    actor,
) -> tuple[bytes, str, str]:
    """UC-10.3 steps 4-6: the filtered entries with their hashes, after a full check of the chain,
    so an auditor can recompute every hash (SHA-256 of the canonical JSON of the entry, which
    includes the previous entry's hash). The export is itself recorded. Returns the file, its
    media type and its name."""
    result = check(db, organization_id)
    entries = db.scalars(_query(organization_id, filters).order_by(AuditLogEntry.seq)).all()
    rows = [_row(entry, None if result.ok else result.broken_seq) for entry in entries]
    now = datetime.now(UTC)
    stamp = now.strftime("%Y%m%d-%H%M")
    audit.record(
        db,
        organization_id=organization_id,
        actor=actor,
        action="audit.exported",
        summary=f"Exported {len(rows)} audit log entries as {file_format.upper()}",
        details={"format": file_format, "entries": len(rows), "chain_verified": result.ok},
    )
    db.commit()

    if file_format == "json":
        document = {
            "exported_at": now.isoformat(timespec="seconds"),
            "chain": audit.chain_key(organization_id),
            "integrity": {
                "verified": result.ok,
                "checked_entries": result.entries,
                "broken_from_seq": result.broken_seq,
                "method": "entry_hash = SHA-256 of the canonical JSON (sorted keys, no spaces) of "
                "chain, seq, occurred_at, actor_type, actor_id, actor_name, action, summary, "
                "item_type, item_id, item_label, source_address, details and prev_hash; "
                "prev_hash is the entry_hash of the entry before it",
            },
            "entries": rows,
        }
        body = json.dumps(document, indent=1, ensure_ascii=False).encode()
        return body, "application/json", f"sentra-audit-log-{stamp}.json"

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=EXPORT_FIELDS)
    writer.writeheader()
    for row in rows:
        writer.writerow({**row, "details": json.dumps(row["details"], sort_keys=True)})
    return buffer.getvalue().encode(), "text/csv", f"sentra-audit-log-{stamp}.csv"
