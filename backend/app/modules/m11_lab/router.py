"""The Security Lab (FR-11.1, FR-11.2): the lab catalogue, deploying a lab target in the
organization and resetting it (UC-11.1, UC-11.2, Screen 65).

Only a Security Analyst of the organization uses the lab, and each organization sees only its own
lab targets (NFR-3.3). Users can't register Lab zone addresses themselves (UC-11.1, quality
requirement 4): this is the only door into the Lab zone.
"""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership, current_user
from app.modules.m01_users.models import Membership, User
from app.modules.m11_lab import deployment
from app.modules.m11_lab.schemas import KnownVulnerability, LabCardOut, LabOut

router = APIRouter(prefix="/lab", tags=["M11 Security Lab"])


def _out(card: deployment.Card) -> LabCardOut:
    return LabCardOut(**card.__dict__)


@router.get("")
def security_lab(
    membership: Membership = Depends(current_membership), db: Session = Depends(get_db)
) -> LabOut:
    """Screen 65: the lab catalogue with the readiness of every lab target this organization has
    deployed (UC-11.1 step 1, UC-11.2 step 1). Every member may read it."""
    found = deployment.cards(db, membership.organization_id)
    return LabOut(cards=[_out(card) for card in found.cards], isolation=found.isolation)


@router.post("/targets/{key}/deploy", status_code=201)
def deploy_lab_target(
    key: str,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> LabCardOut:
    """UC-11.1: the lab target becomes a verified target of this organization, with its canary
    tokens and its connection tested. A lab target the organization already has comes back as it
    is (1a1); a Lab zone that isn't running answers `409 lab_zone_down` with what to start (2a1)."""
    return _out(deployment.deploy(db, membership, user, key))


@router.post("/targets/{target_id}/reset")
def reset_lab_target(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> LabCardOut:
    """UC-11.2: the lab target goes back to its original state and gets new canary tokens. It is
    marked resetting at once and the work runs on a worker; a campaign run that is in progress
    refuses the reset (1a1)."""
    return _out(deployment.start_reset(db, membership, user, target_id))


@router.get("/targets/{target_id}/vulnerabilities")
def known_vulnerabilities(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[KnownVulnerability]:
    """UC-11.1 step 1: what this lab target is documented to be vulnerable to (FR-11.1), as the
    application itself reported it."""
    found = deployment.vulnerabilities(db, membership.organization_id, target_id)
    return [KnownVulnerability(**item) for item in found]
