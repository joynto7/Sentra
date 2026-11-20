"""Module 10, governance part (Azizul): the audit log (FR-10.2) for Organization Administrators,
and the platform audit log for Platform Administrators (UC-10.3, 1a).

The organization always comes from the session, never from the request (NFR-3.3).
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.audit import AuditLogEntry, digest
from app.core.database import get_db
from app.modules.m01_users.deps import current_user, platform_admin
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, require
from app.modules.m10_admin import audit_log
from app.modules.m10_admin.schemas import (
    ActorOut,
    AuditEntryDetail,
    AuditEntryOut,
    AuditExportIn,
    AuditFiltersOut,
    AuditLogPage,
    IntegrityOut,
    ItemOut,
)

router = APIRouter(prefix="/admin", tags=["M10 Administration"])
can_view = require(Action.VIEW_AUDIT_LOG)  # Organization Administrators (FR-1.6)


def entry_out(entry: AuditLogEntry) -> AuditEntryOut:
    return AuditEntryOut(
        id=entry.id,
        seq=entry.seq,
        occurred_at=entry.occurred_at,
        actor=ActorOut(type=entry.actor_type, id=entry.actor_id, name=entry.actor_name),
        action=entry.action,
        summary=entry.summary,
        item=ItemOut(type=entry.item_type, id=entry.item_id, label=entry.item_label or "")
        if entry.item_type
        else None,
        source_address=entry.source_address,
    )


def detail_out(entry: AuditLogEntry) -> AuditEntryDetail:
    return AuditEntryDetail(
        **entry_out(entry).model_dump(),
        details=entry.details,
        prev_hash=entry.prev_hash,
        entry_hash=entry.entry_hash,
        hash_matches=digest(entry) == entry.entry_hash,
    )


def integrity_out(result) -> IntegrityOut | None:
    if result is None:
        return None
    return IntegrityOut(
        verified=result.ok,
        checked_at=result.checked_at,
        entries=result.entries,
        broken_seq=result.broken_seq,
    )


def _filters(
    start: datetime | None = None,
    end: datetime | None = None,
    actor_id: uuid.UUID | None = None,
    group: str = Query(default="", max_length=40),
    item_type: str = Query(default="", max_length=30),
    item_id: str = Query(default="", max_length=64),
    search: str = Query(default="", max_length=200),
) -> audit_log.Filters:
    return audit_log.Filters(start, end, actor_id, group, item_type, item_id, search)


def _page(
    db: Session,
    organization_id: uuid.UUID | None,
    filters: audit_log.Filters,
    page: int,
    page_size: int,
) -> AuditLogPage:
    items, total = audit_log.list_entries(db, organization_id, filters, page, page_size)
    return AuditLogPage(
        items=[entry_out(entry) for entry in items],
        total=total,
        page=page,
        page_size=page_size,
        integrity=integrity_out(audit_log.integrity(db, organization_id)),
    )


def _download(body: bytes, media_type: str, name: str) -> Response:
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def _export_filters(data: AuditExportIn) -> audit_log.Filters:
    return audit_log.Filters(
        data.start, data.end, data.actor_id, data.group, data.item_type, data.item_id, data.search
    )


# ---------------------------------------------------------------- the organization's log


@router.get("/audit-log")
def list_audit_log(
    filters: audit_log.Filters = Depends(_filters),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    membership: Membership = Depends(can_view),
    db: Session = Depends(get_db),
) -> AuditLogPage:
    """UC-10.3 steps 1-2: the organization's entries, newest first."""
    return _page(db, membership.organization_id, filters, page, page_size)


@router.get("/audit-log/filters")
def audit_log_filters(
    membership: Membership = Depends(can_view), db: Session = Depends(get_db)
) -> AuditFiltersOut:
    return AuditFiltersOut.model_validate(audit_log.filter_options(db, membership.organization_id))


@router.post("/audit-log/integrity")
def check_audit_log(
    membership: Membership = Depends(can_view), db: Session = Depends(get_db)
) -> IntegrityOut:
    """A full check of the hash chain now (NFR-8.3)."""
    return integrity_out(audit_log.check(db, membership.organization_id))


@router.post("/audit-log/export")
def export_audit_log(
    data: AuditExportIn,
    membership: Membership = Depends(can_view),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Response:
    """UC-10.3 steps 4-6: CSV or JSON, with the hashes for external verification."""
    return _download(
        *audit_log.export(db, membership.organization_id, _export_filters(data), data.format, user)
    )


@router.get("/audit-log/{entry_id}")
def get_audit_entry(
    entry_id: uuid.UUID, membership: Membership = Depends(can_view), db: Session = Depends(get_db)
) -> AuditEntryDetail:
    """UC-10.3 step 3: one entry with its details and hashes."""
    return detail_out(audit_log.get_entry(db, membership.organization_id, entry_id))


# ---------------------------------------------------------------- the platform log (UC-10.3, 1a)


@router.get("/platform/audit-log")
def list_platform_audit_log(
    filters: audit_log.Filters = Depends(_filters),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _: User = Depends(platform_admin),
    db: Session = Depends(get_db),
) -> AuditLogPage:
    """Platform-wide entries, without the content of the organizations."""
    return _page(db, None, filters, page, page_size)


@router.get("/platform/audit-log/filters")
def platform_audit_log_filters(
    _: User = Depends(platform_admin), db: Session = Depends(get_db)
) -> AuditFiltersOut:
    return AuditFiltersOut.model_validate(audit_log.filter_options(db, None))


@router.post("/platform/audit-log/integrity")
def check_platform_audit_log(
    _: User = Depends(platform_admin), db: Session = Depends(get_db)
) -> IntegrityOut:
    return integrity_out(audit_log.check(db, None))


@router.post("/platform/audit-log/export")
def export_platform_audit_log(
    data: AuditExportIn, user: User = Depends(platform_admin), db: Session = Depends(get_db)
) -> Response:
    return _download(*audit_log.export(db, None, _export_filters(data), data.format, user))


@router.get("/platform/audit-log/{entry_id}")
def get_platform_audit_entry(
    entry_id: uuid.UUID, _: User = Depends(platform_admin), db: Session = Depends(get_db)
) -> AuditEntryDetail:
    return detail_out(audit_log.get_entry(db, None, entry_id))
