"""The CI/CD security gate (FR-9.4): the endpoints a person configures it with (UC-9.4) and the
two a pipeline calls with its API key (UC-9.5).

Only the two run endpoints take `reader(...)`, so an API key can reach nothing else of Sentra
(UC-9.4, quality requirement 4). A key that is limited to targets may only run a gate of those
targets.
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import NotFoundError, PermissionDeniedError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, require
from app.modules.m02_targets.models import Target
from app.modules.m05_campaigns import lifecycle
from app.modules.m05_campaigns.models import Campaign, CampaignRun
from app.modules.m09_reporting import gates
from app.modules.m09_reporting.api_keys import Actor, reader
from app.modules.m09_reporting.models import (
    ApiKey,
    ApiKeyScope,
    GateRun,
    GateVerdict,
    SecurityGate,
)
from app.modules.m09_reporting.schemas import (
    GateCampaignRef,
    GateIn,
    GateList,
    GateOut,
    GateRunIn,
    GateRunOut,
    GateUpdateIn,
)

router = APIRouter(prefix="/gates", tags=["M9 Security Gates"])

# UC-9.4's actor: a Security Analyst sets the gate up and decides its policy. Everybody else of
# the organization reads it — a developer has to see what blocked their release (UC-9.5), and an
# administrator which gate a key belongs to (UC-9.6).
can_manage = require(Action.MANAGE_SECURITY_GATES)

RECENT_RUNS = 10


def _run_code(db: Session, run_id: uuid.UUID | None) -> tuple[str | None, str | None]:
    if run_id is None:
        return None, None
    run = db.get(CampaignRun, run_id)
    if run is None:
        return None, None
    return lifecycle.code(run, lifecycle.campaign_of(db, run)), run.status


def _started_by(db: Session, gate_run: GateRun) -> str | None:
    if gate_run.started_by_key_id is not None:
        key = db.get(ApiKey, gate_run.started_by_key_id)
        return key.name if key is not None else "an API key"
    if gate_run.started_by_id is not None:
        user = db.get(User, gate_run.started_by_id)
        return user.name if user is not None else None
    return None


def run_out(db: Session, gate: SecurityGate, gate_run: GateRun) -> GateRunOut:
    code, run_status = _run_code(db, gate_run.campaign_run_id)
    compared, _ = _run_code(db, gate_run.compared_run_id)
    return GateRunOut(
        gate=gate.code,
        number=gate_run.number,
        verdict=gate_run.verdict,
        message=gate_run.message,
        run_code=code,
        run_status=run_status,
        build_ref=gate_run.build_ref,
        build_commit=gate_run.build_commit,
        build_url=gate_run.build_url,
        compared_with=compared,
        new_findings=gate_run.new_findings or [],
        breaking=gate_run.breaking or [],
        started_by=_started_by(db, gate_run),
        started_at=gate_run.started_at,
        finished_at=gate_run.finished_at,
    )


def _recent(db: Session, gate: SecurityGate, limit: int = RECENT_RUNS) -> list[GateRunOut]:
    found = db.scalars(
        select(GateRun)
        .where(GateRun.gate_id == gate.id)
        .order_by(GateRun.number.desc())
        .limit(limit)
    ).all()
    return [run_out(db, gate, one) for one in found]


def gate_out(db: Session, gate: SecurityGate) -> GateOut:
    target = db.get(Target, gate.target_id)
    campaign = db.get(Campaign, gate.campaign_id)
    creator = db.get(User, gate.created_by_id) if gate.created_by_id else None
    baseline, _ = _run_code(db, gate.baseline_run_id)
    return GateOut(
        code=gate.code,
        name=gate.name,
        status=gate.status,
        target_id=gate.target_id,
        target_name=target.name if target else "",
        campaign_code=campaign.code if campaign else "",
        campaign_name=campaign.name if campaign else "",
        fail_on=list(gate.fail_on),
        fail_on_reopened=gate.fail_on_reopened,
        policy_words=gates._policy_words(gate),
        baseline_run_code=baseline,
        created_by=creator.name if creator else None,
        created_at=gate.created_at,
        runs=_recent(db, gate),
    )


# ---------------------------------------------------------------- UC-9.4, with a session


@router.get("", response_model=GateList)
def list_gates(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> GateList:
    """Screen 55: the organization's gates, newest first, with their last runs."""
    organization_id = membership.organization_id
    found = db.scalars(
        select(SecurityGate)
        .where(SecurityGate.organization_id == organization_id)
        .order_by(SecurityGate.number.desc())
    ).all()
    taken = {one.campaign_id for one in found}
    query = (
        select(Campaign, Target.name)
        .join(Target, Target.id == Campaign.target_id)
        .where(Campaign.organization_id == organization_id)
        .order_by(Campaign.number.desc())
    )
    if taken:  # one gate per campaign, so a campaign that has one is not offered again
        query = query.where(Campaign.id.not_in(taken))
    return GateList(
        rows=[gate_out(db, one) for one in found],
        campaigns=[
            GateCampaignRef(
                code=campaign.code,
                name=campaign.name,
                target_id=campaign.target_id,
                target_name=target_name,
            )
            for campaign, target_name in db.execute(query).all()
        ],
    )


@router.post("", response_model=GateOut, status_code=status.HTTP_201_CREATED)
def create_gate(
    body: GateIn, membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> GateOut:
    """Steps 1-3: the gate is saved and shows its identifier, which the pipeline then calls."""
    gate = gates.create(
        db,
        membership=membership,
        name=body.name,
        campaign_code=body.campaign_code,
        fail_on=body.fail_on,
        fail_on_reopened=body.fail_on_reopened,
    )
    return gate_out(db, gate)


@router.get("/{code}", response_model=GateOut)
def read_gate(
    code: str, membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> GateOut:
    return gate_out(db, gates.gate_row(db, membership.organization_id, code))


@router.patch("/{code}", response_model=GateOut)
def update_gate(
    code: str,
    body: GateUpdateIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> GateOut:
    gate = gates.update(
        db,
        membership=membership,
        gate=gates.gate_row(db, membership.organization_id, code),
        name=body.name,
        fail_on=body.fail_on,
        fail_on_reopened=body.fail_on_reopened,
        status=body.status,
    )
    return gate_out(db, gate)


# ---------------------------------------------------------------- UC-9.5, with an API key


def _for_actor(db: Session, actor: Actor, code: str) -> SecurityGate:
    """The gate this caller may touch: a key limited to targets reaches only its own (FR-9.5)."""
    gate = gates.gate_row(db, actor.organization_id, code)
    if not actor.allows(gate.target_id):
        raise PermissionDeniedError(
            "This API key is limited to other targets, so it may not run this gate.",
            code="target_not_allowed",
        )
    return gate


@router.post("/{code}/runs", response_model=GateRunOut, status_code=status.HTTP_202_ACCEPTED)
def start_gate_run(
    code: str,
    body: GateRunIn,
    actor: Actor = Depends(reader(ApiKeyScope.RUN_SECURITY_GATE)),
    db: Session = Depends(get_db),
) -> GateRunOut:
    """Step 2: the pipeline starts the gate. The answer is the gate run; its verdict comes when
    the campaign run has ended, which the CLI waits for."""
    gate = _for_actor(db, actor, code)
    user = (
        db.get(User, actor.membership.user_id)
        if actor.membership is not None and actor.key is None
        else None
    )
    gate_run = gates.start(
        db,
        organization_id=actor.organization_id,
        gate=gate,
        key=actor.key,
        user=user,
        build_ref=body.build_ref,
        build_commit=body.build_commit,
        build_url=body.build_url,
    )
    return run_out(db, gate, gate_run)


@router.get("/{code}/runs", response_model=list[GateRunOut])
def list_gate_runs(
    code: str,
    actor: Actor = Depends(reader(ApiKeyScope.READ_GATE_RESULTS)),
    db: Session = Depends(get_db),
) -> list[GateRunOut]:
    gate = _for_actor(db, actor, code)
    return _recent(db, gate, limit=50)


@router.get("/{code}/runs/{number}", response_model=GateRunOut)
def read_gate_run(
    code: str,
    number: int,
    actor: Actor = Depends(reader(ApiKeyScope.READ_GATE_RESULTS)),
    db: Session = Depends(get_db),
) -> GateRunOut:
    """Step 5: what the pipeline waits for. While the run is going on the verdict is `running`."""
    gate = _for_actor(db, actor, code)
    gate_run = db.scalar(
        select(GateRun).where(GateRun.gate_id == gate.id, GateRun.number == number)
    )
    if gate_run is None:
        raise NotFoundError("This gate run doesn't exist.")
    return run_out(db, gate, gate_run)


__all__ = ["router", "GateVerdict"]
