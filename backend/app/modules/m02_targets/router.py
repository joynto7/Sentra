import uuid
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership
from app.modules.m01_users.permissions import Action, require
from app.modules.m02_targets import formats, service
from app.modules.m02_targets.models import Target
from app.modules.m02_targets.schemas import (
    CredentialOut,
    CredentialsIn,
    EndpointCheckIn,
    EndpointCheckOut,
    OwnerOut,
    TargetIn,
    TargetListOut,
    TargetOut,
    TargetPatch,
)

router = APIRouter(prefix="/targets", tags=["M2 Target Management"])

# Every member may read the organization's targets; registering and changing them needs a role
# that may manage targets (FR-1.6: the AI Application Developer, UC-2.1 and UC-2.5).
can_manage = require(Action.MANAGE_TARGETS)


def target_out(target: Target, owners: dict[uuid.UUID, str]) -> TargetOut:
    response = target.response_template or {}
    return TargetOut(
        id=target.id,
        name=target.name,
        type=target.type,
        endpoint_url=target.endpoint_url,
        endpoint_host=urlsplit(target.endpoint_url).hostname or "",
        environment=target.environment,
        max_request_rate=target.max_request_rate,
        request_format=service.request_format(target),
        request_template=target.request_template,
        reply_path=response.get("reply") or formats.OPENAI_REPLY_PATH,
        tool_calls_path=response.get("tool_calls"),
        status=target.status,
        owner=OwnerOut(id=target.created_by_id, name=owners[target.created_by_id])
        if target.created_by_id in owners
        else None,
        # Stored credentials are only ever shown masked (FR-2.2).
        credentials=[
            CredentialOut(name=c.name, credential_type=c.credential_type, saved_at=c.created_at)
            for c in target.credentials
        ],
        created_at=target.created_at,
        updated_at=target.updated_at,
    )


@router.get("")
def list_targets(
    tab: Literal["active", "archived"] = "active",
    search: str = "",
    target_type: list[str] = Query(default=[], alias="type"),
    environment: list[str] = Query(default=[]),
    ownership: list[str] = Query(default=[]),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> TargetListOut:
    """The targets page (Screen 16)."""
    items, total, counts = service.list_targets(
        db,
        membership.organization_id,
        tab,
        search,
        target_type,
        environment,
        ownership,
        page,
        page_size,
    )
    owners = service.owner_names(db, items)
    return TargetListOut(
        items=[target_out(t, owners) for t in items],
        total=total,
        page=page,
        page_size=page_size,
        counts=counts,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def register_target(
    data: TargetIn, membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> TargetOut:
    """UC-2.1 Register Target: the target is saved as unverified."""
    target = service.register(db, membership, data)
    return target_out(target, service.owner_names(db, [target]))


@router.post("/check-endpoint")
def check_endpoint(data: EndpointCheckIn, _: Membership = Depends(can_manage)) -> EndpointCheckOut:
    """Step 1 of the registration wizard checks the address first (UC-2.1, 5b)."""
    return EndpointCheckOut(endpoint_url=service.check_endpoint(data.endpoint_url))


@router.get("/{target_id}")
def get_target(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> TargetOut:
    target = service.get_target(db, membership.organization_id, target_id)
    return target_out(target, service.owner_names(db, [target]))


@router.patch("/{target_id}")
def update_target(
    target_id: uuid.UUID,
    data: TargetPatch,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> TargetOut:
    """UC-2.5 Update Target Configuration."""
    target = service.update(db, membership, target_id, data)
    return target_out(target, service.owner_names(db, [target]))


@router.put("/{target_id}/credentials")
def replace_credentials(
    target_id: uuid.UUID,
    data: CredentialsIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> TargetOut:
    """UC-2.5: new credentials replace the stored ones, which are deleted."""
    target = service.replace_credentials(db, membership, target_id, data.credentials)
    return target_out(target, service.owner_names(db, [target]))
