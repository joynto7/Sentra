"""Sentra Shield gateways (FR-8.3, UC-8.1 Connect Shield Gateway).

A gateway runs in the target owner's own environment, in front of the application's endpoint or
between the application and its LLM provider. It connects **outbound** to Sentra: it announces
itself, reports what it sees and reads its policy, so Sentra never opens a connection into that
environment (quality requirement 4). Of its credential only the first characters and a SHA-256 are
kept (NFR-3.1), and it is shown once, when the gateway is registered.

Step 5 decides whether a gateway is really in the traffic path: Sentra sends the harmless
connection test of UC-2.2 through the Target Connector with a one-time marker, and the gateway
reports the markers it has seen. Without that report no policy may be deployed to it (5a1).
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m08_remediation.models import (
    GatewayPosition,
    GatewayStatus,
    ShieldGateway,
)

PREFIX = "sgw_"
SECRET_CHARS = "abcdefghijkmnopqrstuvwxyz23456789"  # no l, 0, 1 or O: a person copies this once
SECRET_LENGTH = 32
SHOWN = len(PREFIX) + 6  # what the pages may show of a credential
HEARTBEAT_SECONDS = 30
# Three missed heartbeats, so one slow window doesn't make a gateway look broken (FR-10.6).
SILENT_AFTER = timedelta(seconds=HEARTBEAT_SECONDS * 3)
CHECK_WINDOW = timedelta(minutes=5)  # how long a test request's marker counts


def _now() -> datetime:
    return datetime.now(UTC)


def new_credential() -> tuple[str, str, str]:
    """The credential, its prefix and its hash. It leaves Sentra once and is never stored."""
    secret = "".join(secrets.choice(SECRET_CHARS) for _ in range(SECRET_LENGTH))
    credential = f"{PREFIX}{secret}"
    return credential, credential[:SHOWN], hashlib.sha256(credential.encode()).hexdigest()


def of_target(
    db: Session, organization_id: uuid.UUID, target_id: uuid.UUID
) -> ShieldGateway | None:
    """The target's gateway, whatever state it is in."""
    return db.scalar(
        scoped_select(ShieldGateway, organization_id).where(ShieldGateway.target_id == target_id)
    )


def active(db: Session, target_id: uuid.UUID) -> ShieldGateway | None:
    """The gateway a policy may be deployed to: connected and in the traffic path (UC-8.4). This
    is what `fixes.active_gateway()` asks, so a fix is only marked for the gateway when one of
    them can really carry it (UC-8.2, 6a)."""
    gateway = db.scalar(select(ShieldGateway).where(ShieldGateway.target_id == target_id))
    if gateway is None:
        return None
    return gateway if state_now(gateway) == GatewayStatus.ACTIVE else None


def state_now(gateway: ShieldGateway, at: datetime | None = None) -> str:
    """Its state, with the silence of a gateway that stopped reporting (FR-10.6). The stored
    status is what Sentra was told; this is what is true now."""
    if gateway.status in (GatewayStatus.REVOKED, GatewayStatus.PENDING):
        return gateway.status
    moment = at or _now()
    if gateway.last_contact_at is None or moment - gateway.last_contact_at > SILENT_AFTER:
        return GatewayStatus.NOT_REPORTING
    return gateway.status


# ---------------------------------------------------------------- the organization's side


def register(
    db: Session,
    organization_id: uuid.UUID,
    user: User,
    *,
    target_id: uuid.UUID,
    position: str,
) -> tuple[ShieldGateway, str]:
    """Steps 1-2: the position is chosen and Sentra issues the credential, which is returned here
    and never again. Connecting again replaces the credential of the target's one gateway."""
    if position not in tuple(GatewayPosition):
        raise FieldValidationError("position", "Choose where the gateway sits.")
    target = db.scalar(scoped_select(Target, organization_id).where(Target.id == target_id))
    if target is None:
        raise NotFoundError("That target doesn't exist.")
    if target.status != TargetStatus.VERIFIED:
        # A gateway stands in the traffic of an application Sentra may test (FR-5.7, UC-8.1).
        raise ConflictError(
            "Verify that you own this target before you put a gateway in front of it.",
            code="target_not_verified",
        )
    credential, prefix, credential_hash = new_credential()
    gateway = of_target(db, organization_id, target_id)
    if gateway is None:
        gateway = ShieldGateway(organization_id=organization_id, target_id=target_id)
        db.add(gateway)
    gateway.position = position
    gateway.status = GatewayStatus.PENDING
    gateway.credential_prefix = prefix
    gateway.credential_hash = credential_hash
    gateway.gateway_version = None
    gateway.added_latency_ms = None
    gateway.requests_seen = 0
    gateway.check_marker = None
    gateway.check_sent_at = None
    gateway.check_seen_at = None
    gateway.connected_at = None
    gateway.last_contact_at = None
    gateway.revoked_at = None
    gateway.created_by_id = user.id
    db.flush()
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="shield_gateway.registered",
        summary=(
            f"Registered a Sentra Shield gateway for {target.name} ({_position_label(position)})"
        ),
        item=audit.Item("shield_gateway", gateway.id, target.name),
        details={"position": position, "prefix": prefix},
    )
    db.commit()
    db.refresh(gateway)
    return gateway, credential


def revoke(
    db: Session, organization_id: uuid.UUID, user: User, target_id: uuid.UUID
) -> ShieldGateway:
    """The credential stops working at once; the gateway keeps its last policy until it is
    stopped, as it does whenever Sentra cannot be reached."""
    gateway = of_target(db, organization_id, target_id)
    if gateway is None:
        raise NotFoundError("This target has no Sentra Shield gateway.")
    if gateway.status == GatewayStatus.REVOKED:
        raise ConflictError("This gateway is revoked already.", code="already_revoked")
    gateway.status = GatewayStatus.REVOKED
    gateway.revoked_at = _now()
    target = db.get(Target, target_id)
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="shield_gateway.revoked",
        summary=f"Revoked the Sentra Shield gateway of {target.name if target else 'a target'}",
        item=audit.Item("shield_gateway", gateway.id, target.name if target else None),
    )
    db.commit()
    db.refresh(gateway)
    return gateway


def start_check(db: Session, gateway: ShieldGateway) -> str:
    """Step 5, before the request: the marker the connection test carries this time."""
    gateway.check_marker = secrets.token_hex(8)
    gateway.check_sent_at = _now()
    gateway.check_seen_at = None
    db.commit()
    return gateway.check_marker


# What the test request of step 5 has proved. This is not the gateway's status: a gateway that
# connected is "not_in_path" until a request has passed through it, so the status alone cannot tell
# "Sentra is waiting for the gateway" (step 5) from "the gateway never reported the request" (5a1),
# and the wizard of Screen 48 shows a different thing in each case.
CHECK_NONE = "none"  # no test request has been sent yet
CHECK_WAITING = "waiting"  # sent, and the window is still open
CHECK_SEEN = "seen"  # the gateway reported the marker: it is in the traffic path (step 6)
CHECK_EXPIRED = "expired"  # 5a1: the window passed and the marker was never reported
NOT_REPORTED = (
    "The gateway didn't report Sentra's test request. Check that it runs in the traffic of this "
    "application and that it can reach Sentra, then check again."
)


def check_state(db: Session, gateway: ShieldGateway, at: datetime | None = None) -> str:
    """What the test request proved so far. The gateway reports the marker with its next
    heartbeat, so a caller reads this again a moment later.

    A gateway that doesn't report a new test request is no longer in the traffic path, even if an
    earlier request proved that it was: its status goes back to not_in_path, so no policy is
    deployed to a gateway that has been taken out of the path (5a1)."""
    db.refresh(gateway)
    if gateway.check_seen_at is not None:
        return CHECK_SEEN
    if gateway.check_sent_at is None:
        return CHECK_NONE
    if (at or _now()) - gateway.check_sent_at <= CHECK_WINDOW:
        return CHECK_WAITING
    if gateway.status == GatewayStatus.ACTIVE:
        gateway.status = GatewayStatus.NOT_IN_PATH
        db.commit()
        db.refresh(gateway)
    return CHECK_EXPIRED


# ---------------------------------------------------------------- the gateway's own side


def authenticate(db: Session, raw: str) -> ShieldGateway | None:
    """The gateway behind a credential, or None. A revoked one is nobody."""
    credential = raw.strip()
    if not credential.startswith(PREFIX) or len(credential) != len(PREFIX) + SECRET_LENGTH:
        return None
    gateway = db.scalar(
        select(ShieldGateway).where(ShieldGateway.credential_prefix == credential[:SHOWN])
    )
    if gateway is None or gateway.status == GatewayStatus.REVOKED:
        return None
    digest = hashlib.sha256(credential.encode()).hexdigest()
    if not secrets.compare_digest(digest, gateway.credential_hash):
        return None
    return gateway


def connected(db: Session, gateway: ShieldGateway, *, version: str, position: str) -> ShieldGateway:
    """Step 4: the gateway announces itself with its version and the position it was started in.
    A position that doesn't match what was chosen is the gateway's: it is where it really sits."""
    now = _now()
    gateway.gateway_version = version.strip()[:20] or None
    if position in tuple(GatewayPosition):
        gateway.position = position
    gateway.connected_at = gateway.connected_at or now
    gateway.last_contact_at = now
    if gateway.status == GatewayStatus.PENDING:
        # It is connected, but until the test request passes through it, it is not in the path.
        gateway.status = GatewayStatus.NOT_IN_PATH
    db.commit()
    db.refresh(gateway)
    return gateway


def heartbeat(
    db: Session,
    gateway: ShieldGateway,
    *,
    requests: int,
    added_latency_ms: int | None,
    markers: list[str],
    blocked: int = 0,
    changed: int = 0,
    sightings: dict[str, int] | None = None,
    policy_version: int = 0,
) -> ShieldGateway:
    """What the gateway saw since its last heartbeat: how many requests passed through it, how
    many its policy held back, what it added to them (NFR-1.5), the markers of Sentra's own test
    requests (step 5), and the policy version it is enforcing (UC-8.4 step 4)."""
    now = _now()
    gateway.last_contact_at = now
    gateway.requests_seen += max(0, requests)
    gateway.requests_blocked += max(0, blocked)
    gateway.requests_changed += max(0, changed)
    gateway.reported_policy_version = max(0, policy_version)
    if sightings:
        gateway.retrieval_sightings = _sightings(gateway.retrieval_sightings, sightings)
    if added_latency_ms is not None:
        gateway.added_latency_ms = max(0, int(added_latency_ms))
    if gateway.check_marker and gateway.check_marker in markers:
        gateway.check_seen_at = now
        gateway.status = GatewayStatus.ACTIVE
    db.commit()
    db.refresh(gateway)
    return gateway


def _sightings(before: dict | None, window: dict[str, int]) -> dict[str, int]:
    """What the gateway has seen in all, the most-seen sources first. A policy holds at most 50
    rules, so 50 sources is everything it could ever have been told to watch."""
    seen = dict(before or {})
    for source, count in window.items():
        seen[source] = seen.get(source, 0) + max(0, int(count))
    return dict(sorted(seen.items(), key=lambda one: (-one[1], one[0]))[:50])


def _position_label(position: str) -> str:
    return (
        "in front of the endpoint"
        if position == GatewayPosition.IN_FRONT
        else "between the application and its LLM provider"
    )


POSITION_LABELS = {
    GatewayPosition.IN_FRONT: "In front of the endpoint",
    GatewayPosition.BEFORE_MODEL: "Between the app and its LLM provider",
}
STATUS_LABELS = {
    GatewayStatus.PENDING: "Waiting for the gateway",
    GatewayStatus.NOT_IN_PATH: "Not in the traffic path",
    GatewayStatus.ACTIVE: "Active",
    GatewayStatus.NOT_REPORTING: "Not reporting",
    GatewayStatus.REVOKED: "Revoked",
}
