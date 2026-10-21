import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.models import Organization
from app.modules.m01_users import organizations
from app.modules.m01_users.deps import current_session, current_user
from app.modules.m01_users.models import ROLE_LABELS, Membership, Role, User, UserSession
from app.modules.m01_users.schemas import OrganizationCreate, OrganizationOut

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
