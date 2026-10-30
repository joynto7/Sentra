"""The API keys of an organization (FR-9.5, UC-9.6) and the one endpoint a key calls itself."""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.tenancy import scoped_select
from app.modules.m01_users.deps import recent_password_confirmation
from app.modules.m01_users.models import Membership, User, UserSession
from app.modules.m01_users.permissions import Action, require
from app.modules.m02_targets.models import Target
from app.modules.m09_reporting import api_keys
from app.modules.m09_reporting.models import ApiKey, ApiKeyScope
from app.modules.m09_reporting.schemas import (
    ApiKeyCreated,
    ApiKeyIn,
    ApiKeyList,
    ApiKeyMe,
    ApiKeyOut,
)

router = APIRouter(prefix="/api-keys", tags=["M9 API Keys"])

# UC-9.6's actor: only an Organization Administrator makes, reads or revokes a key.
can_manage = require(Action.MANAGE_API_KEYS_AND_WEBHOOKS)


def _names(db: Session, organization_id: uuid.UUID) -> dict[uuid.UUID, str]:
    return dict(
        db.execute(
            select(Target.id, Target.name).where(Target.organization_id == organization_id)
        ).all()
    )


def _people(db: Session, keys: list[ApiKey]) -> dict[uuid.UUID, str]:
    wanted = {key.created_by_id for key in keys} | {key.revoked_by_id for key in keys}
    wanted.discard(None)
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


def _out(key: ApiKey, targets: dict, people: dict) -> ApiKeyOut:
    return ApiKeyOut(
        id=key.id,
        name=key.name,
        purpose=key.purpose,
        prefix=key.prefix,
        scopes=list(key.scopes),
        scope_labels=[api_keys.SCOPE_LABELS[ApiKeyScope(one)] for one in key.scopes],
        targets=[{"id": one, "name": targets.get(uuid.UUID(one), "")} for one in key.target_ids],
        created_by=people.get(key.created_by_id),
        created_at=key.created_at,
        expires_at=key.expires_at,
        revoked_at=key.revoked_at,
        revoked_by=people.get(key.revoked_by_id),
        last_used_at=key.last_used_at,
        state=api_keys.state(key),
    )


@router.get("")
def list_keys(
    membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> ApiKeyList:
    """Screen 56: the organization's keys with their scopes, limits and dates. The key itself is
    never among them (NFR-3.1)."""
    keys = api_keys.keys_of(db, membership.organization_id)
    targets = _names(db, membership.organization_id)
    people = _people(db, keys)
    return ApiKeyList(
        rows=[_out(key, targets, people) for key in keys],
        scopes=[
            {
                "value": scope.value,
                "label": api_keys.SCOPE_LABELS[scope],
                "available": scope in api_keys.AVAILABLE,
                "waiting_for": api_keys.WAITING_FOR.get(scope),
            }
            for scope in ApiKeyScope
        ],
        targets=[
            {"id": target.id, "name": target.name}
            for target in db.scalars(
                scoped_select(Target, membership.organization_id).order_by(Target.name)
            )
        ],
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_key(
    data: ApiKeyIn,
    membership: Membership = Depends(can_manage),
    session: UserSession = Depends(recent_password_confirmation),
    db: Session = Depends(get_db),
) -> ApiKeyCreated:
    """UC-9.6 steps 1-5. The password has to have been confirmed in the last ten minutes
    (NFR-3.5), and the key is in the answer once — Sentra keeps only its hash."""
    user = db.get_one(User, membership.user_id)
    key, plain = api_keys.create(
        db,
        organization_id=membership.organization_id,
        user=user,
        name=data.name,
        purpose=data.purpose,
        scopes=data.scopes,
        target_ids=data.target_ids,
        expires_at=data.expires_at,
    )
    targets = _names(db, membership.organization_id)
    return ApiKeyCreated(**_out(key, targets, {user.id: user.name}).model_dump(), key=plain)


@router.get("/me")
def whoami(key: ApiKey = Depends(api_keys.with_key), db: Session = Depends(get_db)) -> ApiKeyMe:
    """What this key may do, for an integration to check before it runs. Only a key reaches it."""
    targets = _names(db, key.organization_id)
    return ApiKeyMe(
        name=key.name,
        scopes=list(key.scopes),
        scope_labels=[api_keys.SCOPE_LABELS[ApiKeyScope(one)] for one in key.scopes],
        targets=[{"id": one, "name": targets.get(uuid.UUID(one), "")} for one in key.target_ids],
        expires_at=key.expires_at,
        expires_soon=api_keys.expires_soon(key),
    )


@router.post("/{key_id}/revoke")
def revoke_key(
    key_id: uuid.UUID,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> ApiKeyOut:
    """UC-9.6, 1a1: the key stops working at once and stays listed with the date."""
    user = db.get_one(User, membership.user_id)
    key = api_keys.revoke(db, membership.organization_id, user, key_id)
    return _out(key, _names(db, membership.organization_id), {user.id: user.name})
