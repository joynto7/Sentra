"""Scope approval of a campaign (FR-5.2, UC-5.2), which is **optional**: until an organization
turns it on, nothing here stands in anyone's way.

Where it is on, a campaign waits for a Security Manager to look at what it will do — its target,
its test suites, its attempt budget, its rate, its time window, its schedule and what it is
estimated to cost — and to approve or reject it. The decision is recorded with the manager and the
moment (FR-10.2, quality requirement 4), the analyst is told (FR-9.3), and only an approved
campaign can be launched, by hand (UC-5.3) or by its schedule (FR-5.3).

Three rules decide everything here:

- **The organization decides.** The requirement is one flag on the organization. Turning it on
  makes every campaign need a decision — including the ones that already existed, which have
  never been submitted; turning it off lets the campaigns that were waiting run again.
- **A campaign's scope is fixed when it is created.** There is no way to edit a campaign (Screen
  34 creates one, and a different scope is a different campaign), so of the things UC-5.2's 5a
  names — scope, budget, schedule — only the schedule can still change, and changing it on an
  approved campaign asks for a new approval.
- **Nobody approves their own campaign** (quality requirement 3), not even a Security Manager.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import (
    ConflictError,
    FieldValidationError,
    PermissionDeniedError,
)
from app.core.models import Organization
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import Membership, MembershipStatus, Role, User
from app.modules.m01_users.permissions import Action, allowed
from app.modules.m05_campaigns import scheduling
from app.modules.m05_campaigns.models import (
    ApprovalAction,
    ApprovalStatus,
    Campaign,
    CampaignApproval,
)

AWAITING = (
    "This campaign is waiting for a Security Manager's approval, so it can't be launched yet."
)
REJECTED = (
    "A Security Manager rejected this campaign's scope. Change the campaign and ask for approval "
    "again."
)
NOT_SUBMITTED = (
    "{organization} requires a Security Manager to approve a campaign's scope, and this campaign "
    "has never been submitted. Submit it for approval first."
)
NO_MANAGER = (
    "{organization} has no Security Manager, so nobody could approve a campaign. Give someone the "
    "Security Manager role first (Screen 09)."
)
OWN_CAMPAIGN = "You can't approve campaigns you created."
NOT_A_MANAGER = "Only a Security Manager approves a campaign's scope."
NO_REASON = "Say why you are rejecting it, so the analyst knows what to change."
NOTHING_TO_DECIDE = "This campaign isn't waiting for a decision."
ALREADY_WAITING = "This campaign is already waiting for a Security Manager's decision."
ALREADY_APPROVED = "This campaign is already approved."
NOT_REQUIRED_HERE = "This organization doesn't require scope approval, so there is nothing to ask."
SCHEDULE_CHANGED = "The schedule was changed, so the campaign needs a new approval."


# ---------------------------------------------------------------- the organization's requirement


def required(db: Session, organization_id: uuid.UUID) -> bool:
    return bool(db.get_one(Organization, organization_id).requires_scope_approval)


def managers(db: Session, organization_id: uuid.UUID) -> list[uuid.UUID]:
    """The Security Managers who may decide (UC-5.2 step 1)."""
    return list(
        db.scalars(
            select(Membership.user_id).where(
                Membership.organization_id == organization_id,
                Membership.role == Role.SECURITY_MANAGER,
                Membership.status == MembershipStatus.ACTIVE,
            )
        ).all()
    )


def administrators(db: Session, organization_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(Membership.user_id).where(
                Membership.organization_id == organization_id,
                Membership.role == Role.ORG_ADMIN,
                Membership.status == MembershipStatus.ACTIVE,
            )
        ).all()
    )


def set_policy(db: Session, organization: Organization, admin: User, wanted: bool) -> None:
    """An Organization Administrator turns the requirement on or off (FR-5.2).

    Turning it on needs a Security Manager in the organization: without one, no campaign could
    ever be launched again. Turning it off releases the campaigns that were waiting — the
    organization has dropped the requirement, so they are launchable again, and their history
    stays in `campaign_approvals`.
    """
    if organization.requires_scope_approval == wanted:
        return
    if wanted and not managers(db, organization.id):
        raise ConflictError(
            NO_MANAGER.format(organization=organization.name), code="no_security_manager"
        )
    organization.requires_scope_approval = wanted
    released = 0
    if not wanted:
        waiting = db.scalars(
            scoped_select(Campaign, organization.id).where(
                Campaign.approval_status.in_(
                    [ApprovalStatus.AWAITING_APPROVAL, ApprovalStatus.REJECTED]
                )
            )
        ).all()
        for campaign in waiting:
            campaign.approval_status = ApprovalStatus.NOT_REQUIRED
        released = len(waiting)
    audit.record(
        db,
        organization_id=organization.id,
        actor=admin,
        action="organization.scope_approval_changed",
        summary=(
            "Campaigns now need a Security Manager's approval"
            if wanted
            else "Campaigns no longer need a Security Manager's approval"
        ),
        item=audit.Item("organization", organization.id, organization.name),
        details={
            "before": {"requires_scope_approval": not wanted},
            "after": {"requires_scope_approval": wanted},
            "campaigns_released": released,
        },
    )
    db.commit()


# ---------------------------------------------------------------- a new campaign (UC-5.1 step 7)


def initial_status(db: Session, organization_id: uuid.UUID) -> str:
    """What a campaign's approval status is the moment it is created."""
    if required(db, organization_id):
        return ApprovalStatus.AWAITING_APPROVAL
    return ApprovalStatus.NOT_REQUIRED


def after_created(db: Session, membership: Membership, campaign: Campaign) -> None:
    """UC-5.2 step 1: a campaign created where approval is required is submitted by the act of
    creating it (Screen 34's button says "Submit for approval"), and the Security Managers are
    told at once. Called after the campaign is committed."""
    if campaign.approval_status != ApprovalStatus.AWAITING_APPROVAL:
        return
    _step(db, campaign, ApprovalAction.SUBMITTED, membership.user_id, None)
    _audit(db, campaign, membership, "campaign.scope_submitted", "Submitted the scope of")
    db.commit()
    _tell_managers(db, campaign, ApprovalAction.SUBMITTED)


# ---------------------------------------------------------------- asking again (3a1)


def submit(db: Session, membership: Membership, code: str, note: str | None) -> Campaign:
    """The analyst asks for a decision: after a rejection and a change (3a1), or for a campaign
    that was created before the organization required approval."""
    campaign = _campaign(db, membership.organization_id, code)
    if not required(db, membership.organization_id):
        raise ConflictError(NOT_REQUIRED_HERE, code="approval_not_required")
    if campaign.approval_status == ApprovalStatus.AWAITING_APPROVAL:
        raise ConflictError(ALREADY_WAITING, code="awaiting_approval")
    if campaign.approval_status == ApprovalStatus.APPROVED:
        raise ConflictError(ALREADY_APPROVED, code="already_approved")
    campaign.approval_status = ApprovalStatus.AWAITING_APPROVAL
    _step(db, campaign, ApprovalAction.SUBMITTED, membership.user_id, _clean(note))
    _audit(db, campaign, membership, "campaign.scope_submitted", "Submitted the scope of")
    db.commit()
    _tell_managers(db, campaign, ApprovalAction.SUBMITTED)
    return campaign


# ---------------------------------------------------------------- the decision (steps 3 and 3a)


def decide(
    db: Session, membership: Membership, code: str, approve: bool, reason: str | None
) -> Campaign:
    """UC-5.2 steps 3 and 4, or 3a: the Security Manager's decision, recorded with them and the
    moment, and the analyst is told."""
    campaign = _campaign(db, membership.organization_id, code)
    if not allowed(membership.role, Action.APPROVE_CAMPAIGN_SCOPE):
        raise PermissionDeniedError(NOT_A_MANAGER)
    if campaign.created_by_id is not None and campaign.created_by_id == membership.user_id:
        raise PermissionDeniedError(OWN_CAMPAIGN)  # quality requirement 3
    if campaign.approval_status != ApprovalStatus.AWAITING_APPROVAL:
        raise ConflictError(NOTHING_TO_DECIDE, code="nothing_to_decide")
    reason = _clean(reason)
    if not approve and not reason:
        raise FieldValidationError("reason", NO_REASON)

    campaign.approval_status = ApprovalStatus.APPROVED if approve else ApprovalStatus.REJECTED
    action = ApprovalAction.APPROVED if approve else ApprovalAction.REJECTED
    _step(db, campaign, action, membership.user_id, reason)
    _audit(
        db,
        campaign,
        membership,
        "campaign.scope_approved" if approve else "campaign.scope_rejected",
        "Approved the scope of" if approve else "Rejected the scope of",
        reason=reason,
    )
    db.commit()
    _tell_creator(db, campaign, membership, approve, reason)
    return campaign


# ---------------------------------------------------------------- a change afterwards (5a)


def after_schedule_change(db: Session, membership: Membership, campaign: Campaign) -> None:
    """5a and quality requirement 5a: a change to an approved campaign needs a new approval. The
    schedule is the only part of a campaign that can change after it was created."""
    if campaign.approval_status != ApprovalStatus.APPROVED:
        return
    campaign.approval_status = ApprovalStatus.AWAITING_APPROVAL
    _step(db, campaign, ApprovalAction.SCOPE_CHANGED, membership.user_id, SCHEDULE_CHANGED)
    _audit(db, campaign, membership, "campaign.scope_submitted", "Changed and resubmitted")
    db.commit()
    _tell_managers(db, campaign, ApprovalAction.SCOPE_CHANGED)


# ---------------------------------------------------------------- the launch check (UC-5.3)


def check_before_launch(db: Session, campaign: Campaign) -> None:
    """Step 2 of UC-5.3: a campaign that needs a decision and hasn't got one does not run. A
    schedule and a pipeline come through the same door (FR-5.3, FR-9.5)."""
    if campaign.approval_status == ApprovalStatus.APPROVED:
        return
    organization = db.get_one(Organization, campaign.organization_id)
    if not organization.requires_scope_approval:
        return  # FR-5.2 is optional: this organization doesn't ask for it
    if campaign.approval_status == ApprovalStatus.AWAITING_APPROVAL:
        raise ConflictError(AWAITING, code="awaiting_approval")
    if campaign.approval_status == ApprovalStatus.REJECTED:
        raise ConflictError(REJECTED, code="approval_rejected")
    raise ConflictError(
        NOT_SUBMITTED.format(organization=organization.name), code="approval_missing"
    )


# ---------------------------------------------------------------- what Screen 35 shows


def view(db: Session, membership: Membership, code: str) -> dict:
    """UC-5.2 step 2: everything the decision needs on one screen — the scope as the campaign's
    own page shows it, who asked and when, the steps so far, and whether this user may decide."""
    from app.modules.m05_campaigns import service

    campaign = _campaign(db, membership.organization_id, code)
    reason = _why_not(db, membership, campaign)
    return {
        "campaign": service.get_campaign(db, membership.organization_id, code),
        "required": required(db, membership.organization_id),
        "timeline": timeline(db, campaign),
        "can_decide": reason is None,
        "cannot_decide_reason": reason,
    }


def timeline(db: Session, campaign: Campaign) -> list[dict]:
    """The campaign's approval from the beginning: it was created, submitted, decided on."""
    names = _names(db, campaign)
    steps = [
        {
            "action": "created",
            "actor": names.get(campaign.created_by_id),
            "note": None,
            "at": campaign.created_at,
        }
    ]
    rows = db.scalars(
        select(CampaignApproval)
        .where(CampaignApproval.campaign_id == campaign.id)
        .order_by(CampaignApproval.created_at, CampaignApproval.id)
    ).all()
    steps += [
        {
            "action": row.action,
            "actor": names.get(row.actor_id),
            "note": row.note,
            "at": row.created_at,
        }
        for row in rows
    ]
    return steps


def decided_by(db: Session, campaign: Campaign) -> dict | None:
    """The decision that is in force, for the campaign's own page: who and when."""
    row = db.scalar(
        select(CampaignApproval)
        .where(
            CampaignApproval.campaign_id == campaign.id,
            CampaignApproval.action.in_([ApprovalAction.APPROVED, ApprovalAction.REJECTED]),
        )
        .order_by(CampaignApproval.created_at.desc(), CampaignApproval.id.desc())
    )
    if row is None or campaign.approval_status not in (
        ApprovalStatus.APPROVED,
        ApprovalStatus.REJECTED,
    ):
        return None
    return {
        "action": row.action,
        "actor": _names(db, campaign).get(row.actor_id),
        "note": row.note,
        "at": row.created_at,
    }


# ---------------------------------------------------------------- the small parts


def _campaign(db: Session, organization_id: uuid.UUID, code: str) -> Campaign:
    from app.modules.m05_campaigns.runs import campaign_row

    return campaign_row(db, organization_id, code)


def _clean(note: str | None) -> str | None:
    text = (note or "").strip()
    return text[:2000] or None


def _step(
    db: Session, campaign: Campaign, action: str, actor_id: uuid.UUID | None, note: str | None
) -> None:
    db.add(
        CampaignApproval(
            organization_id=campaign.organization_id,
            campaign_id=campaign.id,
            action=action,
            actor_id=actor_id,
            note=note,
        )
    )


def _audit(
    db: Session,
    campaign: Campaign,
    membership: Membership,
    action: str,
    summary: str,
    reason: str | None = None,
) -> None:
    audit.record(
        db,
        organization_id=campaign.organization_id,
        actor=db.get_one(User, membership.user_id),
        action=action,
        summary=f"{summary} campaign {campaign.code} {campaign.name}",
        item=audit.Item("campaign", campaign.id, campaign.code),
        details={"reason": reason} if reason else {},
    )


def _why_not(db: Session, membership: Membership, campaign: Campaign) -> str | None:
    """Why this user cannot decide on this campaign, or None if they can."""
    if not allowed(membership.role, Action.APPROVE_CAMPAIGN_SCOPE):
        return NOT_A_MANAGER
    if campaign.created_by_id is not None and campaign.created_by_id == membership.user_id:
        return OWN_CAMPAIGN
    if campaign.approval_status != ApprovalStatus.AWAITING_APPROVAL:
        return NOTHING_TO_DECIDE
    return None


def _names(db: Session, campaign: Campaign) -> dict[uuid.UUID | None, str]:
    ids = {campaign.created_by_id} | {
        row.actor_id
        for row in db.scalars(
            select(CampaignApproval).where(CampaignApproval.campaign_id == campaign.id)
        ).all()
    }
    ids.discard(None)
    if not ids:
        return {}
    rows = db.scalars(select(User).where(User.id.in_(ids))).all()
    return {user.id: user.name for user in rows}


def _scope_in_words(db: Session, campaign: Campaign) -> str:
    from app.modules.m02_targets.models import Target

    target = db.get(Target, campaign.target_id)
    schedule = scheduling.view(db, campaign)
    parts = [
        f"{target.name if target else 'an archived target'}",
        f"{len(campaign.suites)} test suites",
        f"{campaign.attempt_budget:,} attempts",
        f"{campaign.request_rate} per minute",
    ]
    if schedule is not None and schedule.get("summary"):
        parts.append(str(schedule["summary"]).lower())
    return ", ".join(parts)


def _tell_managers(db: Session, campaign: Campaign, action: str) -> None:
    """Step 1: the Security Managers hear that a campaign awaits their decision. With none left
    in the organization, the Organization Administrators hear it instead — only they can appoint
    one, and without that the campaign would wait for ever."""
    from app.modules.m09_reporting.notifications import notify

    people = managers(db, campaign.organization_id)
    for_admins = not people
    if for_admins:
        people = administrators(db, campaign.organization_id)
    if not people:
        return
    changed = action == ApprovalAction.SCOPE_CHANGED
    what = "was changed and needs a new approval" if changed else "is waiting for your approval"
    if for_admins:
        what += ", and the organization has no Security Manager who could give it"
    notify(
        db,
        event="approval_requested",
        user_ids=people,
        organization_id=campaign.organization_id,
        subject=f"Campaign {campaign.code} needs approval",
        text=(f"Campaign {campaign.code} {campaign.name} {what}: {_scope_in_words(db, campaign)}."),
        link=f"/campaigns/{campaign.code}/approval",
    )


def _tell_creator(
    db: Session, campaign: Campaign, membership: Membership, approve: bool, reason: str | None
) -> None:
    """Step 4: the analyst who asked hears the decision."""
    from app.modules.m09_reporting.notifications import notify

    if campaign.created_by_id is None:
        return
    manager = db.get_one(User, membership.user_id)
    if approve:
        text = (
            f"{manager.name} approved the scope of campaign {campaign.code} {campaign.name}. "
            "It can run now."
        )
    else:
        text = (
            f"{manager.name} rejected the scope of campaign {campaign.code} {campaign.name}: "
            f"{reason} Change the campaign and ask for approval again."
        )
    notify(
        db,
        event="campaign_scope_decided",
        user_ids=[campaign.created_by_id],
        organization_id=campaign.organization_id,
        subject=f"Campaign {campaign.code} {'approved' if approve else 'rejected'}",
        text=text,
        link=f"/campaigns/{campaign.code}",
    )
