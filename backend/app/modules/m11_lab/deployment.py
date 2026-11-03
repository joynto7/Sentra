"""The Security Lab (FR-11.2, Screen 65): deploying a lab target in an organization (UC-11.1) and
resetting it to its original state (UC-11.2).

Sentra has no way to start a container, and must not have one: a container that can start
containers can become root on the host. So the Lab zone itself — an isolated network with no route
out, holding only synthetic data — is started once by whoever runs Sentra
(`docker compose --profile lab up -d`), and **Deploy** does everything that is Sentra's: it claims
the lab target for the organization, places the ownership token itself, verifies it, runs the
connection test, reads the planted canary tokens and marks it ready. When the zone is not running,
Deploy says so and names the command (UC-11.1, 2a1).

A reset is the lab target's own `POST /lab/reset`: it throws away what the testing changed,
restores its synthetic data from its image and plants new canary tokens. That is a better reset
than restarting a container, because only the application knows what its original state was.
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import Membership, User
from app.modules.m02_targets import canaries, connection
from app.modules.m02_targets import lifecycle as target_lifecycle
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m11_lab import catalogue, registration
from app.modules.m11_lab.models import LabDeployment, LabState
from app.workers import jobs
from app.workers.connector import lab as connector_lab
from app.workers.connector.errors import TargetUnreachable

log = logging.getLogger("uvicorn.error")

ISOLATION = (
    "Lab targets run in an isolated zone with synthetic data, simulated tools and no internet "
    "access. They belong to this organization only, and a reset restores the original state and "
    "plants new canary tokens."
)
DEPLOY_JOB = "lab.deploy"
RESET_JOB = "lab.reset"
RUN_IN_PROGRESS = (
    "{code} is running against {name}. Wait until it has ended, or stop it, before resetting."
)
NOT_DEPLOYED = "This lab target isn't deployed in your organization."
RESET_FAILED = (
    "The lab target didn't answer after the reset. Sentra tried twice and has marked it not ready."
)


@dataclass
class CardVulnerability:
    id: str
    title: str
    category: str
    description: str


@dataclass
class Card:
    """One lab target as Screen 65 shows it."""

    key: str
    name: str
    about: str
    type: str
    memory_mb: int
    minutes: int
    deployed: bool
    target_id: uuid.UUID | None = None
    state: str | None = None  # LabState, once it is deployed
    state_label: str = ""
    status: str | None = None  # the target's own status (UC-2.3)
    vulnerabilities: int = 0
    categories: list[str] = field(default_factory=list)
    canaries: int = 0
    last_reset_at: datetime | None = None
    resets: int = 0
    last_error: str | None = None
    active_run: str | None = None  # the campaign run that is using it (UC-11.2, 1a)


@dataclass
class Lab:
    cards: list[Card]
    isolation: str = ISOLATION


STATE_LABELS = {
    LabState.DEPLOYING: "Deploying",
    LabState.READY: "Ready",
    LabState.RESETTING: "Resetting",
    LabState.NOT_READY: "Not ready",
}


def _may(db: Session, membership: Membership) -> None:
    from app.modules.m01_users.permissions import Action, allowed

    if not allowed(membership.role, Action.USE_SECURITY_LAB):
        raise PermissionDeniedError("Only a Security Analyst uses the Security Lab.")


def _deployment(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> LabDeployment:
    row = db.scalar(
        scoped_select(LabDeployment, organization_id).where(LabDeployment.target_id == target_id)
    )
    if row is None:
        raise NotFoundError(NOT_DEPLOYED)
    return row


def _run_code(running) -> str:
    """R-238-2, the way M5 writes a campaign run's code."""
    from app.modules.m05_campaigns import lifecycle as campaign_lifecycle

    return campaign_lifecycle.code(*running)


def _categories(known: list[dict]) -> list[str]:
    return sorted({item.get("category", "") for item in known if item.get("category")})


def cards(db: Session, organization_id: uuid.UUID) -> Lab:
    """UC-11.1 step 1 and UC-11.2: the catalogue with, for each lab target this organization has
    deployed, its readiness, what it reported about itself and whether a run is using it."""
    deployed = {
        row.lab_key: row
        for row in db.scalars(scoped_select(LabDeployment, organization_id))
        if row.lab_key in catalogue.CATALOGUE
    }
    found = []
    for lab in catalogue.available():
        row = deployed.get(lab.key)
        card = Card(
            key=lab.key,
            name=lab.name,
            about=lab.about,
            type=lab.type,
            memory_mb=lab.memory_mb,
            minutes=lab.minutes,
            deployed=row is not None,
        )
        if row is not None:
            target = db.get(Target, row.target_id)
            running = target_lifecycle.active_run(db, target.id) if target is not None else None
            card.target_id = row.target_id
            card.state = row.state
            card.state_label = STATE_LABELS[LabState(row.state)]
            card.status = target.status if target is not None else None
            card.name = target.name if target is not None else lab.name
            card.vulnerabilities = len(row.known_vulnerabilities)
            card.categories = _categories(row.known_vulnerabilities)
            card.canaries = len(canaries.current(db, row.target_id))
            card.last_reset_at = row.last_reset_at
            card.resets = row.resets
            card.last_error = row.last_error
            card.active_run = _run_code(running) if running is not None else None
        found.append(card)
    return Lab(cards=found)


def vulnerabilities(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> list[dict]:
    """UC-11.1 step 1: the documented weaknesses of a deployed lab target, as the application
    itself reported them (FR-11.1)."""
    return _deployment(db, organization_id, target_id).known_vulnerabilities


# ---------------------------------------------------------------- deploy (UC-11.1)


def deploy(db: Session, membership: Membership, user: User, key: str) -> Card:
    """UC-11.1 steps 2 and 4-6, with 1a and 2a: the lab target becomes a verified target of this
    organization, its ownership token is placed by Sentra, its connection is tested and a worker
    reads what it reports about itself. A lab target the organization already has is returned as
    it is and can be reset (1a1); a Lab zone that isn't running leaves the card "Not ready" with
    the command to start it (2a1)."""
    _may(db, membership)
    if key not in catalogue.CATALOGUE:
        raise NotFoundError("Sentra has no such lab target.")
    lab = catalogue.entry(key)
    if not lab.available:
        raise ConflictError(catalogue.LAB_DISABLED, code="lab_disabled")

    organization_id = membership.organization_id
    existing = db.scalar(
        scoped_select(LabDeployment, organization_id).where(LabDeployment.lab_key == key)
    )
    if existing is not None:  # 1a1
        if existing.state == LabState.NOT_READY:
            # It was deployed but could not be reached. Deploy tries again from where it stopped.
            existing.state, existing.last_error = LabState.DEPLOYING, None
            db.commit()
            if not jobs.start(db, DEPLOY_JOB, existing.id):
                existing.state, existing.last_error = LabState.NOT_READY, jobs.QUEUE_DOWN
                db.commit()
        return _card(db, organization_id, key)

    target, _ = registration.register(db, organization_id, user, key)
    row = LabDeployment(
        organization_id=organization_id,
        target_id=target.id,
        lab_key=key,
        state=LabState.DEPLOYING,
    )
    db.add(row)
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="target.lab_deployed",
        summary=f"Deployed the lab target {target.name}",
        item=audit.Item("target", target.id, target.name),
        details={"lab_target": key},
    )
    db.commit()
    # Only a worker reaches a target (deployment 2.5.5), so reading what the lab target reports
    # about itself is a job, like its ownership check and its connection test.
    if not jobs.start(db, DEPLOY_JOB, row.id):
        row.state, row.last_error = LabState.NOT_READY, jobs.QUEUE_DOWN
        db.commit()
    return _card(db, organization_id, key)


def finish_deploy(db: Session, deployment_id: uuid.UUID) -> None:
    """UC-11.1 step 2 on a worker: what the lab target says about itself — its planted canary
    tokens and its documented weaknesses — and then it is ready. A Lab zone that isn't running
    leaves it not ready and says what to start (2a1); pressing Deploy again tries once more."""
    row = db.get(LabDeployment, deployment_id)
    if row is None or row.state != LabState.DEPLOYING:
        return
    target = db.get(Target, row.target_id)
    if target is None:
        return
    try:
        _read_state(db, target, row)
    except TargetUnreachable:
        row.state = LabState.NOT_READY
        row.last_error = catalogue.ZONE_DOWN.format(name=target.name)
        db.commit()
        return
    row.state = LabState.READY
    db.commit()


def _read_state(db: Session, target: Target, row: LabDeployment) -> None:
    """What the lab target says about itself: its planted canary tokens, which M2 records and
    retires the earlier ones of (UC-11.2, quality requirement 4), and its known vulnerabilities."""
    state = connector_lab.lab_state(target)
    canaries.sync_lab(db, target, state.get("slots", []))
    row.known_vulnerabilities = state.get("known_vulnerabilities", [])
    row.last_error = None
    db.commit()


# ---------------------------------------------------------------- reset (UC-11.2)


def start_reset(db: Session, membership: Membership, user: User, target_id: uuid.UUID) -> Card:
    """UC-11.2 step 1 and 1a: the lab target is marked resetting, so no campaign run can use it,
    and the work itself runs as a job. A run that is in progress refuses a manual reset."""
    _may(db, membership)
    organization_id = membership.organization_id
    row = _deployment(db, organization_id, target_id)
    target = db.get(Target, target_id)
    if target is None or target.status == TargetStatus.ARCHIVED:
        raise NotFoundError(NOT_DEPLOYED)
    running = target_lifecycle.active_run(db, target_id)
    if running is not None:  # 1a1
        raise ConflictError(
            RUN_IN_PROGRESS.format(code=_run_code(running), name=target.name),
            code="run_in_progress",
        )
    if row.state == LabState.RESETTING:
        return _card(db, organization_id, row.lab_key)

    row.state = LabState.RESETTING
    row.last_error = None
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="target.lab_reset_started",
        summary=f"Started a reset of the lab target {target.name}",
        item=audit.Item("target", target.id, target.name),
        details={"lab_target": row.lab_key},
    )
    db.commit()
    if not jobs.start(db, RESET_JOB, row.id):
        row.state = LabState.NOT_READY
        row.last_error = jobs.QUEUE_DOWN
        db.commit()
    return _card(db, organization_id, row.lab_key)


def run_reset(db: Session, deployment_id: uuid.UUID) -> None:
    """UC-11.2 steps 2-6 and 5a, on a worker: the lab target restores itself and plants new canary
    tokens, Sentra reads them, tests the connection and marks it ready. A reset that doesn't come
    back is tried once more; after that the target stays not ready and the analyst sees why."""
    row = db.get(LabDeployment, deployment_id)
    if row is None or row.state != LabState.RESETTING:
        return
    target = db.get(Target, row.target_id)
    if target is None:
        return
    problem = None
    for attempt in (1, 2):  # 5a1: Sentra repeats the reset once
        try:
            connector_lab.reset(target)
            _read_state(db, target, row)
            problem = None
            break
        except TargetUnreachable as exc:
            problem = str(exc)
            log.warning("The reset of lab target %s failed (try %s): %s", target.name, attempt, exc)
    if problem is not None:
        row.state, row.last_error = LabState.NOT_READY, RESET_FAILED
        db.commit()
        return

    row.state = LabState.READY
    row.resets += 1
    row.last_reset_at = datetime.now(UTC)
    audit.record(
        db,
        organization_id=row.organization_id,
        action="target.lab_reset",
        summary=f"Reset the lab target {target.name} to its original state",
        item=audit.Item("target", target.id, target.name),
        details={"lab_target": row.lab_key, "canaries": len(canaries.current(db, target.id))},
        source_address=None,
    )
    db.commit()
    connection.start(db, target, None)  # step 5: the normal connection test


def before_run(db: Session, target_id: uuid.UUID) -> bool:
    """Whether a campaign run may use this lab target now (UC-11.2 step 1): a target that is
    resetting or not ready is not tested. A target that is not a lab target is never in the way."""
    row = db.scalar(select(LabDeployment).where(LabDeployment.target_id == target_id))
    return row is None or row.state == LabState.READY


def _card(db: Session, organization_id: uuid.UUID, key: str) -> Card:
    found = next((card for card in cards(db, organization_id).cards if card.key == key), None)
    if found is None:
        raise NotFoundError(NOT_DEPLOYED)
    return found
