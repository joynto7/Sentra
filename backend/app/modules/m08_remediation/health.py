"""Module 8's part of System Health (FR-10.6, UC-10.9 steps 1-2 and 4a; Screen 63): the Sentra
Shield gateways.

The Monitoring component (m10_admin/health.py) finds this file by itself and calls
`components(db, thresholds)` whenever its page is opened or the clock ticks, so the gateways are a
row of Screen 63 like the workers and the queue: how many are connected, how many report, and when
each one was last heard from (step 2). A gateway that has been silent for longer than the Platform
Administrator's threshold (`gateway_silence_minutes`, step 3) makes the row an alert, which the
Monitoring component raises and sends to the Platform Administrators (step 4).

4a1, telling the target's developers and administrators, is here too, because only this module
knows whose gateway it is: `tell_about_silence()`, which the clock runs every minute
(schedules.py). The gateway keeps enforcing the last policy it read while it is cut off; that is
the gateway's own behaviour (shield/), and nothing here has to do it.

The platform's page shows operational data only (NFR-3.3): a gateway is named by the first
characters of its credential and by its version, never by its target or by anything its traffic
held. The people of the organization are told the target's name, because it is theirs.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.audit import AuditLogEntry
from app.modules.m01_users.models import Membership, MembershipStatus, Role
from app.modules.m02_targets.models import Target
from app.modules.m08_remediation.models import GatewayStatus, ShieldGateway
from app.modules.m10_admin.health import (
    ALERT,
    LABELS,
    OPERATIONAL,
    Component,
    Thresholds,
    thresholds,
)

SILENT = "shield_gateway.silent"  # the audit action of 4a1: one entry for each silence
LISTED = 3  # the gateways the row names, the longest silent first; the others are counted
NOBODY_YET = "No gateway is connected"


def components(db: Session, limits: Thresholds) -> list[Component]:
    """Steps 1-2: the gateways' row. Only a gateway that has connected can stop reporting; one
    that was only registered (pending) or whose credential was revoked is not watched."""
    now = datetime.now(UTC)
    watched = sorted(_connected(db), key=_last_contact)
    if not watched:
        return [
            Component(key="shield", label=LABELS["shield"], status=OPERATIONAL, lines=[NOBODY_YET])
        ]
    minutes = limits.gateway_silence_minutes
    silent = [g for g in watched if now - _last_contact(g) > timedelta(minutes=minutes)]
    lines = [f"{len(watched) - len(silent)} of {len(watched)} heard from in the last {minutes} min"]
    for gateway in watched[:LISTED]:
        version = f" · {gateway.gateway_version}" if gateway.gateway_version else ""
        ago = _ago(now - _last_contact(gateway))
        lines.append(f"{gateway.credential_prefix}…{version} · last contact {ago} ago")
    if len(watched) > LISTED:
        lines.append(f"and {len(watched) - LISTED} more")
    return [
        Component(
            key="shield",
            label=LABELS["shield"],
            status=ALERT if silent else OPERATIONAL,
            lines=lines,
            alert_kind="silent",
            summary=(
                "A Sentra Shield gateway has been silent for more than "
                f"{limits.gateway_silence_minutes} min"
            ),
            effect=(
                "The gateway keeps enforcing its last policy, but Sentra can't see what it blocks "
                "or give it a new policy version until it reports again. The target's developers "
                "and administrators have been told."
            ),
            detail={
                "gateways": [gateway.credential_prefix for gateway in silent],
                "silence_minutes": limits.gateway_silence_minutes,
            },
        )
    ]


def tell_about_silence(db: Session, at: datetime | None = None) -> int:
    """4a1: the AI Application Developers and the Organization Administrators of a target whose
    gateway has been silent for longer than the threshold hear about it, once for each silence.
    The organization's audit log keeps that they were told, and it is also what remembers it: a
    gateway that reports again and later goes silent again is a new silence. Returns how many
    gateways were reported."""
    from app.modules.m09_reporting.notifications import notify

    now = at or datetime.now(UTC)
    minutes = thresholds(db).gateway_silence_minutes
    reported = 0
    for gateway in _connected(db):
        since = _last_contact(gateway)
        if now - since <= timedelta(minutes=minutes) or _told(db, gateway, since):
            continue
        target = db.get(Target, gateway.target_id)
        name = target.name if target is not None else "a target"
        people = _people(db, gateway.organization_id)
        audit.record(
            db,
            organization_id=gateway.organization_id,
            action=SILENT,
            summary=f"The Sentra Shield gateway of {name} stopped reporting",
            item=audit.Item("shield_gateway", gateway.id, name),
            details={
                "last_contact_at": since.isoformat(),
                "silence_minutes": minutes,
                "people_told": len(people),
            },
            source_address=None,
        )
        db.commit()
        reported += 1
        if not people:
            continue
        notify(
            db,
            event="shield_gateway_silent",
            user_ids=people,
            organization_id=gateway.organization_id,
            text=(
                f"The Sentra Shield gateway of {name} hasn't reported since "
                f"{since:%d %b %Y, %H:%M} UTC. It keeps enforcing its last policy, but Sentra "
                "can't see what it blocks or give it a new policy version until it reports "
                "again. Check that it is running and can reach Sentra."
            ),
            subject=f"Sentra Shield gateway of {name} stopped reporting",
            link=f"/targets/{gateway.target_id}/shield",
        )
    return reported


def _connected(db: Session) -> list[ShieldGateway]:
    return list(
        db.scalars(
            select(ShieldGateway).where(
                ShieldGateway.status.not_in((GatewayStatus.PENDING, GatewayStatus.REVOKED))
            )
        )
    )


def _last_contact(gateway: ShieldGateway) -> datetime:
    return gateway.last_contact_at or gateway.connected_at or gateway.created_at


def _told(db: Session, gateway: ShieldGateway, since: datetime) -> bool:
    """Whether this silence, which began at `since`, has been reported already."""
    return (
        db.scalar(
            select(AuditLogEntry.id)
            .where(
                AuditLogEntry.organization_id == gateway.organization_id,
                AuditLogEntry.action == SILENT,
                AuditLogEntry.item_id == str(gateway.id),
                AuditLogEntry.occurred_at >= since,
            )
            .limit(1)
        )
        is not None
    )


def _people(db: Session, organization_id: uuid.UUID) -> list[uuid.UUID]:
    """The target's developers and administrators of 4a1: the organization's active members with
    the role AI Application Developer or Organization Administrator."""
    return list(
        db.scalars(
            select(Membership.user_id).where(
                Membership.organization_id == organization_id,
                Membership.status == MembershipStatus.ACTIVE,
                Membership.role.in_((Role.TARGET_OWNER, Role.ORG_ADMIN)),
            )
        )
    )


def _ago(gap: timedelta) -> str:
    seconds = max(0, int(gap.total_seconds()))
    if seconds < 60:
        return f"{seconds} s"
    if seconds < 3_600:
        return f"{seconds // 60} min"
    if seconds < 86_400:
        return f"{seconds // 3_600} h"
    return f"{seconds // 86_400} days"
