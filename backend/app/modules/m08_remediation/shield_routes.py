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
from app.modules.m06_findings.service import finding_row
from app.modules.m08_remediation import gateways, policies
from app.modules.m08_remediation.models import RuleKind, ShieldGateway, ShieldPolicy
from app.modules.m08_remediation.schemas import (
    DeployIn,
    DeployOut,
    GatewayCheckOut,
    GatewayConfirmIn,
    GatewayConnectIn,
    GatewayHeartbeatIn,
    GatewayList,
    GatewayOut,
    GatewayPolicyOut,
    GatewayRegisterIn,
    GatewaySecretOut,
    GatewayStateOut,
    PolicyList,
    PolicyRuleOut,
    PolicyVersionOut,
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
        requests_blocked=gateway.requests_blocked,
        requests_changed=gateway.requests_changed,
        retrieval_sightings=gateway.retrieval_sightings or {},
        policy_version=gateway.reported_policy_version,
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


# ---------------------------------------------------------------- the policy versions (UC-8.4)


def _version_out(db: Session, policy: ShieldPolicy) -> PolicyVersionOut:
    approver = db.get(User, policy.approved_by_id) if policy.approved_by_id else None
    deployer = db.get(User, policy.deployed_by_id) if policy.deployed_by_id else None
    return PolicyVersionOut(
        version=policy.version,
        state=policy.state,
        state_label=policies.STATE_LABELS[policy.state],
        source=policy.source,
        rule_count=policy.rule_count,
        carried_over=policy.carried_over,
        rules=[
            PolicyRuleOut(
                id=rule.get("id", ""),
                kind=rule.get("kind", ""),
                label=policies.RULE_LABELS[RuleKind(rule["kind"])],
                title=rule.get("title", ""),
                says=policies.says(rule),
                note=rule.get("note") or None,
                finding=(rule.get("from") or {}).get("finding"),
                fix=(rule.get("from") or {}).get("fix"),
            )
            for rule in (policy.document or {}).get("rules") or []
        ],
        trigger_finding=policy.trigger_finding,
        trigger_version=policy.trigger_version,
        based_on_version=policy.based_on_version,
        approved_by=approver.name if approver else None,
        deployed_by=deployer.name if deployer else None,
        deploy_at=policy.deploy_at,
        offered_at=policy.offered_at,
        confirmed_at=policy.confirmed_at,
        failure_reason=policy.failure_reason,
        created_at=policy.created_at,
    )


@router.get("/targets/{target_id}/policy")
def policy_versions(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> PolicyList:
    """Screens 48 and 49: the policy of a target, every version it has had, and the approved
    remediations that are not in it yet."""
    target = db.scalar(
        scoped_select(Target, membership.organization_id).where(Target.id == target_id)
    )
    if target is None:
        raise NotFoundError("That target doesn't exist.")
    gateway = gateways.of_target(db, membership.organization_id, target_id)
    active = policies.current(db, target_id)
    waiting = policies.waiting(db, target_id)
    return PolicyList(
        target_id=target.id,
        target_name=target.name,
        gateway=_out(db, gateway, target) if gateway else None,
        active=_version_out(db, active) if active else None,
        waiting=_version_out(db, waiting) if waiting else None,
        versions=[
            _version_out(db, one)
            for one in policies.versions(db, membership.organization_id, target_id)
        ],
        deployable=policies.deployable(db, membership.organization_id, target),
    )


@router.post("/targets/{target_id}/policy", status_code=status.HTTP_201_CREATED)
def deploy_policy(
    target_id: uuid.UUID,
    data: DeployIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> DeployOut:
    """UC-8.4 steps 1-3 by hand: the developer deploys the approved fixes of a finding, with the
    terms of every guardrail among them, now or in a maintenance window (1a)."""
    user = db.get_one(User, membership.user_id)
    finding = finding_row(db, membership.organization_id, data.finding_code)
    if finding.target_id != target_id:
        raise NotFoundError("That finding doesn't belong to this target.")
    remediation = (
        policies.version_of(db, finding, data.version)
        if data.version
        else policies.newest_approved(db, finding.id) or policies.newest(db, finding.id)
    )
    if remediation is None:
        raise NotFoundError("This finding has no remediation proposal to deploy.")
    policy, left = policies.deploy(
        db,
        membership.organization_id,
        user,
        finding=finding,
        remediation=remediation,
        guardrails={
            one.fix: {
                "applies_to": one.applies_to,
                "action": one.action,
                "terms": one.terms,
                "message": one.message,
            }
            for one in data.guardrails
        },
        at=data.at,
    )
    return DeployOut(policy=_version_out(db, policy), open_in_application=left)


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
        policy_version=policies.offer(db, gateway),
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
        blocked=data.blocked,
        changed=data.changed,
        sightings=data.sightings,
        policy_version=data.policy_version,
    )
    # A gateway that reports the version it was offered has activated it (step 4).
    if data.policy_version:
        policies.confirm(db, gateway, data.policy_version)
    return GatewayStateOut(
        gateway_id=gateway.id,
        policy_version=policies.offer(db, gateway),
        heartbeat_seconds=HEARTBEAT_SECONDS,
    )


@router.get("/policy")
def policy(
    gateway: ShieldGateway = Depends(current_gateway),
    db: Session = Depends(get_db),
) -> GatewayPolicyOut:
    """The policy the gateway enforces: the version it has been offered, or the active one. Until
    a version is deployed it is the empty policy and the gateway only forwards and measures."""
    version, document = policies.document_for(db, gateway)
    return GatewayPolicyOut(version=version, document=document)


@router.post("/confirm")
def confirm_policy(
    data: GatewayConfirmIn,
    gateway: ShieldGateway = Depends(current_gateway),
    db: Session = Depends(get_db),
) -> GatewayStateOut:
    """Step 4: the gateway has activated the version it downloaded. Sentra records the deployment
    with its approver (step 5) and starts what follows it (step 6)."""
    gateways.heartbeat(
        db, gateway, requests=0, added_latency_ms=None, markers=[], policy_version=data.version
    )
    policies.confirm(db, gateway, data.version, rules=data.rules)
    return GatewayStateOut(
        gateway_id=gateway.id,
        policy_version=policies.offer(db, gateway),
        heartbeat_seconds=HEARTBEAT_SECONDS,
    )
