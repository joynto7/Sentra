"""Organizations and memberships (FR-1.4, UC-1.6): create, list, switch, current."""

import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import FieldValidationError, NotFoundError
from app.core.models import Organization
from app.modules.m01_users.models import Membership, Role, User, UserSession

NAME_REQUIRED = "Enter an organization name."
NAME_TOO_LONG = "Use at most 120 characters."


def _slug(db: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "organization"
    slug, n = base, 2
    while db.scalar(select(Organization.id).where(Organization.slug == slug)) is not None:
        slug, n = f"{base}-{n}", n + 1
    return slug


def create(db: Session, user: User, session: UserSession, name: str) -> Membership:
    """UC-1.6: the creator becomes the first Organization Administrator."""
    name = " ".join(name.split())
    if not name:
        raise FieldValidationError("name", NAME_REQUIRED)
    if len(name) > 120:
        raise FieldValidationError("name", NAME_TOO_LONG)
    organization = Organization(name=name, slug=_slug(db, name))
    db.add(organization)
    db.flush()
    membership = Membership(user_id=user.id, organization_id=organization.id, role=Role.ORG_ADMIN)
    db.add(membership)
    _open(user, session, organization.id)
    audit.record(
        db,
        organization_id=organization.id,
        actor=user,
        action="organization.created",
        summary=f"Created the organization {organization.name}",
        item=audit.Item("organization", organization.id, organization.name),
    )
    db.commit()
    return membership


def memberships(db: Session, user: User) -> list[tuple[Membership, Organization]]:
    rows = db.execute(
        select(Membership, Organization)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.name)
    )
    return [(m, o) for m, o in rows]


def switch(db: Session, user: User, session: UserSession, organization_id: uuid.UUID) -> Membership:
    """Only organizations the user belongs to can be opened. Any other ID gives the same
    'not found', so the answer reveals nothing about other organizations (NFR-3.3)."""
    membership = _membership(db, user.id, organization_id)
    if membership is None:
        raise NotFoundError("Organization not found.")
    _open(user, session, organization_id)
    db.commit()
    return membership


def current(db: Session, session: UserSession) -> Membership | None:
    """The organization this browser works in: the one opened in this session, else the one
    used last, else the oldest membership. None if the user belongs to no organization."""
    user = db.get_one(User, session.user_id)
    for candidate in (session.organization_id, user.last_organization_id):
        if candidate is not None and (m := _membership(db, user.id, candidate)) is not None:
            if session.organization_id != candidate:
                _open(user, session, candidate)
                db.commit()
            return m
    first = db.scalar(
        select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)
    )
    if first is not None:
        _open(user, session, first.organization_id)
        db.commit()
    return first


def mfa_required_by(db: Session, user: User) -> list[str]:
    """The names of the user's organizations that require two-step verification (FR-1.2, UC-1.7).
    If there is one, the user can't log in without it (UC-1.2, 3b)."""
    return list(
        db.scalars(
            select(Organization.name)
            .join(Membership, Membership.organization_id == Organization.id)
            .where(Membership.user_id == user.id, Organization.mfa_required)
            .order_by(Organization.name)
        )
    )


def _membership(db: Session, user_id: uuid.UUID, organization_id: uuid.UUID) -> Membership | None:
    return db.scalar(
        select(Membership).where(
            Membership.user_id == user_id, Membership.organization_id == organization_id
        )
    )


def _open(user: User, session: UserSession, organization_id: uuid.UUID) -> None:
    session.organization_id = organization_id
    user.last_organization_id = organization_id
