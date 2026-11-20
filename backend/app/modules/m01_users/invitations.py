"""Team invitations (FR-1.5): invite by e-mail with a role, resend, revoke, accept or decline,
and remove members (UC-1.8 Invite Team Member, UC-1.9 Accept Invitation, UC-1.10 Remove Team
Member).
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.email import send_email
from app.core.errors import AppError, ConflictError, FieldValidationError, NotFoundError
from app.core.models import Organization
from app.core.tenancy import scoped_select
from app.modules.m01_users import emails, organizations, service
from app.modules.m01_users.members import WRONG_PASSWORD, admin_count
from app.modules.m01_users.models import (
    ROLE_LABELS,
    Invitation,
    InvitationStatus,
    Membership,
    Role,
    User,
    UserSession,
    UserStatus,
)
from app.modules.m01_users.security import hash_password, hash_token, new_token, verify_password

VALID_FOR = timedelta(days=7)
NO_LONGER_VALID = (
    "This invitation is no longer valid. Ask your Organization Administrator to send a new one."
)


def _now() -> datetime:
    return datetime.now(UTC)


def is_expired(invitation: Invitation) -> bool:
    return invitation.status == InvitationStatus.PENDING and invitation.expires_at <= _now()


def _notify(background: BackgroundTasks, to: str, message: tuple[str, str]) -> None:
    background.add_task(send_email, to, *message)


# ---------------------------------------------------------------- for administrators (UC-1.8)


def invite(
    db: Session,
    admin: Membership,
    inviter: User,
    email: str,
    role: Role,
    background: BackgroundTasks,
) -> Invitation:
    email = email.strip().lower()
    organization = db.get_one(Organization, admin.organization_id)
    member = db.scalar(
        select(Membership.id)
        .join(User, User.id == Membership.user_id)
        .where(User.email == email, Membership.organization_id == admin.organization_id)
    )
    if member is not None:
        raise FieldValidationError(
            "email", f"This person is already a member of {organization.name}."
        )
    pending = db.scalars(
        scoped_select(Invitation, admin.organization_id).where(
            Invitation.email == email, Invitation.status == InvitationStatus.PENDING
        )
    ).all()
    if any(not is_expired(i) for i in pending):
        raise FieldValidationError(
            "email", "This address already has a pending invitation. Resend it instead."
        )

    raw, token_hash = new_token()
    invitation = Invitation(
        organization_id=admin.organization_id,
        email=email,
        role=role,
        token_hash=token_hash,
        status=InvitationStatus.PENDING,
        expires_at=_now() + VALID_FOR,
        invited_by_id=inviter.id,
    )
    db.add(invitation)
    db.flush()
    _audit(db, invitation, inviter, "invitation.sent", f"Invited {email} as {ROLE_LABELS[role]}")
    db.commit()
    _notify(
        background,
        email,
        emails.invitation(organization.name, inviter.name, ROLE_LABELS[role], raw),
    )
    return invitation


def pending(db: Session, organization_id: uuid.UUID) -> list[Invitation]:
    """Pending and expired invitations, newest first (the Pending invitations tab)."""
    return list(
        db.scalars(
            scoped_select(Invitation, organization_id)
            .where(Invitation.status == InvitationStatus.PENDING)
            .order_by(Invitation.created_at.desc())
        )
    )


def resend(
    db: Session,
    admin: Membership,
    inviter: User,
    invitation_id: uuid.UUID,
    background: BackgroundTasks,
) -> Invitation:
    """UC-1.8, 5a and 5b: a new link with a new expiry date; the old link stops working."""
    invitation = _pending_invitation(db, admin, invitation_id)
    raw, invitation.token_hash = new_token()
    invitation.expires_at = _now() + VALID_FOR
    _audit(
        db, invitation, inviter, "invitation.resent", f"Resent the invitation of {invitation.email}"
    )
    db.commit()
    organization = db.get_one(Organization, admin.organization_id)
    _notify(
        background,
        invitation.email,
        emails.invitation(organization.name, inviter.name, ROLE_LABELS[Role(invitation.role)], raw),
    )
    return invitation


def revoke(db: Session, admin: Membership, invitation_id: uuid.UUID) -> None:
    """UC-1.8, 5a: the link stops working at once."""
    invitation = _pending_invitation(db, admin, invitation_id)
    invitation.status = InvitationStatus.REVOKED
    invitation.closed_at = _now()
    revoker = db.get_one(User, admin.user_id)
    _audit(
        db,
        invitation,
        revoker,
        "invitation.revoked",
        f"Revoked the invitation of {invitation.email}",
    )
    db.commit()


def remove_member(
    db: Session,
    admin: Membership,
    admin_user: User,
    membership_id: uuid.UUID,
    password: str,
    background: BackgroundTasks,
) -> None:
    """UC-1.10: the membership ends, and so do the member's sessions in the organization.
    The member's account and past actions are kept."""
    membership = db.scalar(
        scoped_select(Membership, admin.organization_id).where(Membership.id == membership_id)
    )
    if membership is None:
        raise NotFoundError("Member not found.")
    if not verify_password(admin_user.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)
    if membership.user_id == admin_user.id:
        raise ConflictError("You can't remove yourself from the organization.", code="remove_self")
    user = db.get_one(User, membership.user_id)
    if membership.role == Role.ORG_ADMIN and admin_count(db, admin.organization_id) == 1:
        raise ConflictError(
            f"{user.name} is the only Organization Administrator. "
            "Give another member this role first.",
            code="last_admin",
        )

    db.delete(membership)
    db.execute(
        delete(UserSession).where(
            UserSession.user_id == user.id, UserSession.organization_id == admin.organization_id
        )
    )
    if user.last_organization_id == admin.organization_id:
        user.last_organization_id = None
    audit.record(
        db,
        organization_id=admin.organization_id,
        actor=admin_user,
        action="member.removed",
        summary=f"Removed {user.name} from the organization",
        item=audit.Item("member", user.id, user.name),
        details={"role": ROLE_LABELS[Role(membership.role)]},
    )
    db.commit()
    organization = db.get_one(Organization, admin.organization_id)
    _notify(background, user.email, emails.removed_from(user.name, organization.name))


def _pending_invitation(db: Session, admin: Membership, invitation_id: uuid.UUID) -> Invitation:
    invitation = db.scalar(
        scoped_select(Invitation, admin.organization_id).where(Invitation.id == invitation_id)
    )
    if invitation is None or invitation.status != InvitationStatus.PENDING:
        raise NotFoundError("Invitation not found.")
    return invitation


# ---------------------------------------------------------------- for the invited person (UC-1.9)


def find(db: Session, raw: str) -> Invitation:
    """A pending, unexpired invitation for the link, or the "no longer valid" error (2a)."""
    invitation = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(raw)))
    if (
        invitation is None
        or invitation.status != InvitationStatus.PENDING
        or is_expired(invitation)
    ):
        raise AppError(NO_LONGER_VALID, code="invitation_invalid", status_code=410)
    return invitation


def accept(
    db: Session, raw: str, user: User, session: UserSession, background: BackgroundTasks
) -> Membership:
    """Steps 4-6 for a logged-in person: only the invited address may accept (3a)."""
    invitation = find(db, raw)
    if user.email != invitation.email:
        raise AppError(
            f"This invitation is for {invitation.email}. Log in with that address to accept it.",
            code="wrong_account",
            status_code=403,
        )
    return _join(db, invitation, user, session, background)


def register_and_accept(
    db: Session,
    raw: str,
    name: str,
    password: str,
    accept_terms: bool,
    user_agent: str | None,
    ip_address: str | None,
    background: BackgroundTasks,
) -> tuple[Membership, service.LoginStep, str]:
    """Step 3 for a person without an account. The invitation link already proved the e-mail
    address, so no separate verification e-mail is needed. Returns the membership, the next step
    and its raw token: the session token, or the token of the login's second step."""
    invitation = find(db, raw)
    if not accept_terms:
        raise FieldValidationError("accept_terms", service.TERMS_REQUIRED)
    service.check_password(password, invitation.email, "password")
    user = db.scalar(select(User).where(User.email == invitation.email))
    if user is not None and user.status != UserStatus.UNVERIFIED:
        raise ConflictError(
            "An account already exists for this address. Log in to accept the invitation.",
            code="account_exists",
        )
    if user is None:
        user = User(email=invitation.email)
        db.add(user)
    user.name = name.strip()
    user.password_hash = hash_password(password)
    user.status = UserStatus.ACTIVE
    user.email_verified_at = _now()
    user.terms_accepted_at = _now()
    db.flush()
    if db.get_one(Organization, invitation.organization_id).mfa_required:
        # The organization requires two-step verification, so it is set up before the first
        # session (UC-1.2, 3b and UC-1.4, 1a).
        membership = _join(db, invitation, user, None, background)
        return membership, service.LoginStep.MFA_SETUP, service.start_second_step(db, user)
    raw_session = service.start_session(db, user, user_agent, ip_address)
    db.flush()
    session = db.scalar(
        select(UserSession).where(UserSession.token_hash == hash_token(raw_session))
    )
    return _join(db, invitation, user, session, background), service.LoginStep.DONE, raw_session


def decline(db: Session, raw: str, background: BackgroundTasks) -> None:
    """4a: the invitation is closed and the administrator is told."""
    invitation = find(db, raw)
    _close(invitation, InvitationStatus.DECLINED)
    audit.record(
        db,
        organization_id=invitation.organization_id,
        actor_type="person",
        actor_name=invitation.email,
        action="invitation.declined",
        summary=f"{invitation.email} declined the invitation",
        item=audit.Item("invitation", invitation.id, invitation.email),
    )
    db.commit()
    _tell_inviter(db, invitation, background, accepted=False)


def _join(
    db: Session,
    invitation: Invitation,
    user: User,
    session: UserSession | None,
    background: BackgroundTasks,
) -> Membership:
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.organization_id == invitation.organization_id
        )
    )
    if membership is None:
        membership = Membership(
            user_id=user.id, organization_id=invitation.organization_id, role=invitation.role
        )
        db.add(membership)
    _close(invitation, InvitationStatus.ACCEPTED)
    db.flush()
    role = ROLE_LABELS[Role(invitation.role)]
    audit.record(
        db,
        organization_id=invitation.organization_id,
        actor=user,
        action="member.joined",
        summary=f"Accepted the invitation and joined as {role}",
        item=audit.Item("member", user.id, user.name),
        details={"role": role},
    )
    if session is not None:
        organizations.switch(db, user, session, invitation.organization_id)  # step 6; commits
    else:  # no session yet: the organization opens after the second step of the login
        user.last_organization_id = invitation.organization_id
        db.commit()
    _tell_inviter(db, invitation, background, accepted=True)
    return membership


def _audit(db: Session, invitation: Invitation, actor: User, action: str, summary: str) -> None:
    audit.record(
        db,
        organization_id=invitation.organization_id,
        actor=actor,
        action=action,
        summary=summary,
        item=audit.Item("invitation", invitation.id, invitation.email),
        details={"role": ROLE_LABELS[Role(invitation.role)]},
    )


def _close(invitation: Invitation, status: InvitationStatus) -> None:
    invitation.status = status
    invitation.closed_at = _now()


def _tell_inviter(
    db: Session, invitation: Invitation, background: BackgroundTasks, accepted: bool
) -> None:
    inviter = db.get(User, invitation.invited_by_id) if invitation.invited_by_id else None
    if inviter is not None:
        organization = db.get_one(Organization, invitation.organization_id)
        _notify(
            background,
            inviter.email,
            emails.invitation_answered(inviter.name, invitation.email, organization.name, accepted),
        )
