import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.models import Organization
from app.modules.m01_users import getting_started, onboarding, organizations
from app.modules.m01_users.deps import current_membership, current_session, current_user
from app.modules.m01_users.models import ROLE_LABELS, Membership, Role, User, UserSession
from app.modules.m01_users.schemas import (
    FirstStepsOut,
    FirstStepTarget,
    OnboardingIn,
    OnboardingOut,
    OrganizationCreate,
    OrganizationOut,
)

router = APIRouter(prefix="/organizations", tags=["M1 Organizations"])


def organization_out(
    membership: Membership, organization: Organization, current_id=None
) -> OrganizationOut:
    return OrganizationOut(
        id=organization.id,
        name=organization.name,
        slug=organization.slug,
        role=membership.role,
        role_label=ROLE_LABELS[Role(membership.role)],
        is_current=organization.id == current_id,
        status=membership.status,
        onboarding_done=bool((membership.onboarding or {}).get("done")),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_organization(
    data: OrganizationCreate,
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> OrganizationOut:
    """UC-1.6 Create Organization: the creator becomes its Organization Administrator."""
    membership = organizations.create(db, user, session, data.name)
    organization = db.get_one(Organization, membership.organization_id)
    return organization_out(membership, organization, organization.id)


@router.get("/current/getting-started")
def first_steps(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> FirstStepsOut:
    """Screen 07 Getting started: the five first steps and which are done. Every member may read
    them; the organization comes from the session (NFR-3.3)."""
    steps = getting_started.first_steps(db, membership.organization_id)
    targets = ("first_target", "unverified_target", "verified_target")
    return FirstStepsOut(
        **{
            **steps.__dict__,
            **{
                name: FirstStepTarget(**getattr(steps, name).__dict__)
                if getattr(steps, name)
                else None
                for name in targets
            },
        }
    )


@router.get("")
def list_organizations(
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> list[OrganizationOut]:
    """The organizations the user belongs to (the organization menu)."""
    current = organizations.current(db, session)
    current_id = current.organization_id if current else None
    return [organization_out(m, o, current_id) for m, o in organizations.memberships(db, user)]


@router.post("/{organization_id}/switch")
def switch_organization(
    organization_id: uuid.UUID,
    user: User = Depends(current_user),
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
) -> OrganizationOut:
    membership = organizations.switch(db, user, session, organization_id)
    organization = db.get_one(Organization, organization_id)
    return organization_out(membership, organization, organization_id)


def _onboarding_out(membership: Membership) -> OnboardingOut:
    return OnboardingOut(**onboarding.state(membership), ask=onboarding.next_question(membership))


@router.get("/current/onboarding")
def get_onboarding(membership: Membership = Depends(current_membership)) -> OnboardingOut:
    """Where the logged-in person is in the first-run setup of the current organization."""
    return _onboarding_out(membership)


@router.put("/current/onboarding")
def save_onboarding(
    data: OnboardingIn,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> OnboardingOut:
    """Keeps the step reached and the choices made so far; nothing else changes."""
    onboarding.save(db, membership, data.step, data.answers)
    return _onboarding_out(membership)


@router.post("/current/onboarding/complete")
def complete_onboarding(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> OnboardingOut:
    onboarding.finish(db, membership, skipped=False)
    return _onboarding_out(membership)


@router.post("/current/onboarding/skip")
def skip_onboarding(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> OnboardingOut:
    """Leaving the setup for now. It is not asked again; the first steps stay on the dashboard."""
    onboarding.finish(db, membership, skipped=True)
    return _onboarding_out(membership)


@router.post("/current/onboarding/restart")
def restart_onboarding(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> OnboardingOut:
    """Opens the setup again, for someone who skipped it or wants to go through it once more."""
    onboarding.restart(db, membership)
    return _onboarding_out(membership)
