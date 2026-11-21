"""The Sentra Shield gateways of an organization (FR-8.3, UC-8.1): Screen 47 and the wizard of
Screen 48, and the three endpoints the gateway itself uses.

The gateway's own endpoints take its credential as a bearer token and nothing else: a credential
can report a gateway and read that gateway's policy, and can reach nothing else in Sentra.
"""

import uuid

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import NotAuthenticatedError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, require
from app.modules.m02_targets.models import Target
from app.modules.m08_remediation import gateways
from app.modules.m08_remediation.models import ShieldGateway
from app.modules.m08_remediation.schemas import (
    GatewayCheckOut,
    GatewayConnectIn,
    GatewayHeartbeatIn,
    GatewayList,
    GatewayOut,
    GatewayPolicyOut,
    GatewayRegisterIn,
    GatewaySecretOut,
    GatewayStateOut,
)

router = APIRouter(prefix="/shield", tags=["M8 Sentra Shield"])

# UC-8.1's actor: the developer of the application, who can change its deployment.
can_manage = require(Action.MANAGE_SHIELD)
HEARTBEAT_SECONDS = gateways.HEARTBEAT_SECONDS


def _out(db: Session, gateway: ShieldGateway, target: Target | None = None) -> GatewayOut:
    target = target or db.get(Target, gateway.target_id)
    state = gateways.state_now(gateway)
    return GatewayOut(
        id=gateway.id,
        target_id=gateway.target_id,
        target_name=target.name if target else "",
        target_environment=target.environment if target else "",
        position=gateway.position,
        position_label=gateways.POSITION_LABELS[gateway.position],
        status=state,
        status_label=gateways.STATUS_LABELS[state],
        credential_prefix=gateway.credential_prefix,
        gateway_version=gateway.gateway_version,
        added_latency_ms=gateway.added_latency_ms,
        requests_seen=gateway.requests_seen,
        in_traffic_path=gateway.check_seen_at is not None,
        connected_at=gateway.connected_at,
        last_contact_at=gateway.last_contact_at,
        created_at=gateway.created_at,
    )


@router.get("")
def list_gateways(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> GatewayList:
    """Screen 47: every target of the organization, with its gateway when it has one."""
    targets = list(
        db.scalars(scoped_select(Target, membership.organization_id).order_by(Target.name))
    )
    rows = {
        gateway.target_id: gateway
        for gateway in db.scalars(scoped_select(ShieldGateway, membership.organization_id))
    }
    return GatewayList(
        rows=[_out(db, rows[one.id], one) for one in targets if one.id in rows],
        targets_without_gateway=[
            {"id": str(one.id), "name": one.name} for one in targets if one.id not in rows
        ],
        heartbeat_seconds=HEARTBEAT_SECONDS,
    )


@router.post("/targets/{target_id}", status_code=status.HTTP_201_CREATED)
def register(
    target_id: uuid.UUID,
    data: GatewayRegisterIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> GatewaySecretOut:
    """UC-8.1 steps 1-2. The credential is in this answer and in no other: Sentra keeps only its
    first characters and a SHA-256 (NFR-3.1)."""
    user = db.get_one(User, membership.user_id)
    gateway, credential = gateways.register(
        db, membership.organization_id, user, target_id=target_id, position=data.position
    )
    return GatewaySecretOut(gateway=_out(db, gateway), credential=credential)


@router.post("/targets/{target_id}/check")
def check(
    target_id: uuid.UUID,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> GatewayCheckOut:
    """Step 5: one harmless request to the target, which the gateway has to report. The answer
    says what Sentra knows at once; the gateway reports the marker in its next heartbeat, so the
    page asks again until the window has passed (5a1)."""
    from app.modules.m08_remediation import shield_check

    gateway = gateways.of_target(db, membership.organization_id, target_id)
    if gateway is None:
        raise NotFoundError("This target has no Sentra Shield gateway.")
    return shield_check.run(db, gateway)


@router.get("/targets/{target_id}/check")
def check_state(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> GatewayCheckOut:
    """The state of the test request, which the wizard of Screen 48 follows."""
    gateway = gateways.of_target(db, membership.organization_id, target_id)
    if gateway is None:
        raise NotFoundError("This target has no Sentra Shield gateway.")
    state = gateways.check_state(db, gateway)
    return GatewayCheckOut(
        gateway=_out(db, gateway),
        seen=state == gateways.CHECK_SEEN,
        waiting=state == gateways.CHECK_WAITING,
        message=gateways.NOT_REPORTED if state == gateways.CHECK_EXPIRED else None,
    )


@router.post("/targets/{target_id}/revoke")
def revoke(
    target_id: uuid.UUID,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> GatewayOut:
    """The credential stops working at once (UC-8.1, 4a: it stays valid until it is revoked)."""
    user = db.get_one(User, membership.user_id)
    return _out(db, gateways.revoke(db, membership.organization_id, user, target_id))


# ---------------------------------------------------------------- the gateway's own endpoints


def current_gateway(request: Request, db: Session = Depends(get_db)) -> ShieldGateway:
    """The gateway behind the credential in the Authorization header, and nothing else."""
    header = request.headers.get("authorization", "")
    raw = header[7:] if header.lower().startswith("bearer ") else ""
    gateway = gateways.authenticate(db, raw) if raw else None
    if gateway is None:
        raise NotAuthenticatedError(
            "This gateway credential is not valid.", code="invalid_gateway_credential"
        )
    return gateway


@router.post("/connect")
def connect(
    data: GatewayConnectIn,
    gateway: ShieldGateway = Depends(current_gateway),
    db: Session = Depends(get_db),
) -> GatewayStateOut:
    """Step 4: the gateway announces itself, outbound, with its version and its position."""
    gateways.connected(db, gateway, version=data.version, position=data.position)
    return GatewayStateOut(
        gateway_id=gateway.id,
        policy_version=0,  # no policy exists until FR-8.3 deploys one (task A-S4-03)
        heartbeat_seconds=HEARTBEAT_SECONDS,
    )


@router.post("/heartbeat")
def heartbeat(
    data: GatewayHeartbeatIn,
    gateway: ShieldGateway = Depends(current_gateway),
    db: Session = Depends(get_db),
) -> GatewayStateOut:
    """What the gateway saw in its window: how many requests, what it added to them (NFR-1.5),
    and the markers of Sentra's test requests (step 5)."""
    gateways.heartbeat(
        db,
        gateway,
        requests=data.requests,
        added_latency_ms=data.added_latency_ms,
        markers=data.markers,
    )
    return GatewayStateOut(
        gateway_id=gateway.id,
        policy_version=0,
        heartbeat_seconds=HEARTBEAT_SECONDS,
    )


@router.get("/policy")
def policy(
    gateway: ShieldGateway = Depends(current_gateway),
) -> GatewayPolicyOut:
    """The policy the gateway enforces. Until FR-8.3 deploys the first version (task A-S4-03) it
    is the empty policy: the gateway forwards every request unchanged and reports what it sees."""
    return GatewayPolicyOut(version=0, document={"rules": []})
