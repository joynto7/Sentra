"""UC-11.1 Deploy Lab Target, steps 4 and 5: Sentra adds one of its own lab targets to an
organization and verifies its ownership with the normal check, placing the token itself; the
connection test and the target profile follow as for any target (UC-2.2, UC-2.4).

Users can't register lab addresses themselves (UC-11.1, quality requirement 4), so this is the
only way a lab target becomes a target. Starting a separate lab target for each organization
(steps 2 and 3) and the lab catalogue page come with FR-11.2; until then every organization uses
the one lab target of `docker compose --profile lab up -d`:

    docker compose run --rm api python -m app.modules.m11_lab.registration <analyst e-mail>

The lab target goes to the organization in which that person is a Security Analyst; someone who is
an analyst in several organizations adds --organization "<name>".
"""

import argparse
import secrets
import sys
import uuid
from dataclasses import dataclass
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.config import get_settings
from app.core.errors import ConflictError, PermissionDeniedError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import Membership, MembershipStatus, User
from app.modules.m01_users.permissions import Action, allowed
from app.modules.m02_targets import connection, verification
from app.modules.m02_targets.models import (
    CredentialType,
    Target,
    TargetCredential,
    TargetStatus,
    TargetType,
    VerificationMethod,
)


@dataclass(frozen=True)
class LabTarget:
    key: str
    name: str
    type: TargetType
    endpoint_url: str
    max_request_rate: int


# The lab catalogue (FR-11.1). The support agent, the SQL agent and the document agent join in
# Sprint 4.
CATALOGUE = {
    "rag-chatbot": LabTarget(
        "rag-chatbot",
        "RAG chatbot (lab)",
        TargetType.RAG_APPLICATION,
        "http://lab-rag-chatbot:8080/v1/chat/completions",
        60,
    ),
}
LAB_DISABLED = "The Security Lab isn't enabled in this deployment (LAB_HOSTS is empty)."


def register(
    db: Session, organization_id: uuid.UUID, user: User, key: str = "rag-chatbot"
) -> tuple[Target, bool]:
    """Returns the lab target and whether it was added now. A lab target that the organization
    already has is returned as it is (1a)."""
    lab = CATALOGUE[key]
    if urlsplit(lab.endpoint_url).hostname not in get_settings().lab_hosts:
        raise ConflictError(LAB_DISABLED, code="lab_disabled")
    membership = db.scalar(
        select(Membership).where(
            Membership.organization_id == organization_id, Membership.user_id == user.id
        )
    )
    if (
        membership is None
        or membership.status != MembershipStatus.ACTIVE  # a suspended member (FR-10.1)
        or not allowed(membership.role, Action.USE_SECURITY_LAB)
    ):
        raise PermissionDeniedError("Only a Security Analyst of the organization adds lab targets.")

    existing = db.scalar(
        scoped_select(Target, organization_id).where(
            Target.endpoint_url == lab.endpoint_url, Target.status != TargetStatus.ARCHIVED
        )
    )
    if existing is not None:
        return existing, False

    target = Target(
        organization_id=organization_id,
        name=_free_name(db, organization_id, lab.name),
        type=lab.type,
        endpoint_url=lab.endpoint_url,
        environment="staging",
        max_request_rate=lab.max_request_rate,
        status=TargetStatus.UNVERIFIED,
        verification_token=secrets.token_hex(16),
        created_by_id=user.id,
    )
    db.add(target)
    db.flush()
    credential = TargetCredential(
        target_id=target.id, name="Authorization", credential_type=CredentialType.BEARER_TOKEN
    )
    credential.set_value(get_settings().lab_api_key)
    target.credentials.append(credential)
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="target.registered",
        summary=f"Added the lab target {target.name} from the Security Lab",
        item=audit.Item("target", target.id, target.name),
        details={"lab_target": lab.key, "endpoint_url": lab.endpoint_url},
    )
    db.commit()
    # Step 5: the normal check, with the token placed by Sentra; then the connection test.
    verification.start(db, target, user, VerificationMethod.LAB)
    connection.start(db, target, user.id)
    db.refresh(target)
    return target, True


def _free_name(db: Session, organization_id: uuid.UUID, name: str) -> str:
    taken = {
        t.lower()
        for t in db.scalars(
            select(Target.name).where(
                Target.organization_id == organization_id,
                func.lower(Target.name).startswith(name.lower(), autoescape=True),
            )
        )
    }
    candidate, number = name, 2
    while candidate.lower() in taken:
        candidate, number = f"{name} {number}", number + 1
    return candidate


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Add Sentra's RAG chatbot lab target.")
    parser.add_argument("email", help="the Security Analyst who adds it")
    parser.add_argument("--organization", help="the organization's name, if there are several")
    args = parser.parse_args(argv)

    from app.core.database import SessionLocal
    from app.core.models import Organization
    from app.modules import load_models

    load_models()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == args.email.strip().lower()))
        if user is None:
            print(f"No account uses {args.email}.")
            return 1
        query = (
            select(Organization)
            .join(Membership, Membership.organization_id == Organization.id)
            .where(Membership.user_id == user.id)
        )
        if args.organization:
            wanted = args.organization.strip().lower()
            query = query.where(
                (func.lower(Organization.name) == wanted) | (Organization.slug == wanted)
            )
        organizations = [
            o
            for o in db.scalars(query)
            if allowed(_role(db, o.id, user.id), Action.USE_SECURITY_LAB)
        ]
        if not organizations:
            named = " with that name" if args.organization else ""
            print(f"{user.name} isn't a Security Analyst in any organization{named}.")
            return 1
        if len(organizations) > 1:
            print(f"{user.name} is an analyst in several organizations: add --organization.")
            return 1
        try:
            target, added = register(db, organizations[0].id, user)
        except (ConflictError, PermissionDeniedError) as exc:
            print(exc.message)
            return 1
        where = organizations[0].name
        if not added:
            print(f"{where} already has {target.name} ({target.id}), status {target.status}.")
            return 0
        print(f"Added {target.name} ({target.id}) to {where}, status {target.status}.")
        print("A worker verifies it, tests the connection and maps its profile next.")
    return 0


def _role(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> str:
    return db.scalar(
        select(Membership.role).where(
            Membership.organization_id == organization_id, Membership.user_id == user_id
        )
    )


if __name__ == "__main__":
    sys.exit(main())
