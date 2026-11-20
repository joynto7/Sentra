"""The first steps of a new organization (Screen 07; UC-1.6 step 6, UC-7.3 2a; NFR-4.1): which of
the five setup steps are done, read from what the organization already has. Every member may
read them; the page shows each step's action only to the roles that may take it (FR-1.6).

1. Create your organization: always done here.
2. Invite your team: another member, or an invitation that is still open.
3. Add something to test: a target that isn't archived.
4. Verify ownership: a verified target.
5. Run your first campaign: a campaign run of the organization has finished.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.audit import AuditLogEntry, chain_key
from app.core.models import Organization
from app.modules.m01_users.models import Invitation, InvitationStatus, Membership, User
from app.modules.m02_targets.models import Target, TargetStatus


@dataclass
class TargetRef:
    id: uuid.UUID
    name: str


@dataclass
class FirstSteps:
    organization: str
    created_at: datetime
    created_by: str | None
    members: int
    open_invitations: int
    first_target: TargetRef | None  # the first target registered (step 3)
    unverified_target: TargetRef | None  # the target to verify next (step 4)
    verified_target: TargetRef | None  # the target for the first campaign (step 5)
    campaign_run_finished: bool
    done: list[str] = field(default_factory=list)


def _creator(db: Session, organization: Organization) -> str | None:
    """Who created the organization: the first entry of its audit log (UC-1.6 step 5), or, for an
    organization older than the audit log, its first administrator."""
    entry = db.scalar(
        select(AuditLogEntry)
        .where(
            AuditLogEntry.chain == chain_key(organization.id),
            AuditLogEntry.action == "organization.created",
        )
        .order_by(AuditLogEntry.seq)
        .limit(1)
    )
    if entry is not None:
        return entry.actor_name
    return db.scalar(
        select(User.name)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.organization_id == organization.id)
        .order_by(Membership.created_at)
        .limit(1)
    )


def _first(db: Session, organization_id: uuid.UUID, *conditions) -> TargetRef | None:
    target = db.scalar(
        select(Target)
        .where(Target.organization_id == organization_id, *conditions)
        .order_by(Target.created_at)
        .limit(1)
    )
    return TargetRef(target.id, target.name) if target else None


def _campaign_run_finished(db: Session, organization_id: uuid.UUID) -> bool:
    """Step 5. Campaign runs come with FR-5.4 (Joynto's J-S2-02); until they exist, no run can
    have finished."""
    return False


def first_steps(db: Session, organization_id: uuid.UUID) -> FirstSteps:
    organization = db.get_one(Organization, organization_id)
    members = db.scalar(
        select(func.count())
        .select_from(Membership)
        .where(Membership.organization_id == organization_id)
    )
    open_invitations = db.scalar(
        select(func.count())
        .select_from(Invitation)
        .where(
            Invitation.organization_id == organization_id,
            Invitation.status == InvitationStatus.PENDING,
            Invitation.expires_at > datetime.now(UTC),
        )
    )
    active = Target.status != TargetStatus.ARCHIVED
    unverified = _first(db, organization_id, Target.status == TargetStatus.UNVERIFIED)
    verified = _first(db, organization_id, Target.status == TargetStatus.VERIFIED)
    any_target = _first(db, organization_id, active)
    steps = FirstSteps(
        organization=organization.name,
        created_at=organization.created_at,
        created_by=_creator(db, organization),
        members=members or 0,
        open_invitations=open_invitations or 0,
        first_target=any_target,
        unverified_target=unverified,
        verified_target=verified,
        campaign_run_finished=_campaign_run_finished(db, organization_id),
    )
    steps.done = [
        name
        for name, ok in [
            ("organization", True),
            ("team", steps.members > 1 or steps.open_invitations > 0),
            ("target", any_target is not None),
            ("verification", verified is not None),
            ("campaign_run", steps.campaign_run_finished),
        ]
        if ok
    ]
    return steps
