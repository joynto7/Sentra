"""The webhooks of an organization (FR-9.6, UC-9.7), for Screen 57."""

import uuid

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.database import get_db
from app.modules.m01_users.deps import recent_password_confirmation
from app.modules.m01_users.models import Membership, User, UserSession
from app.modules.m01_users.permissions import Action, require
from app.modules.m09_reporting import webhooks
from app.modules.m09_reporting.events import EVENTS
from app.modules.m09_reporting.models import Webhook, WebhookDelivery
from app.modules.m09_reporting.schemas import (
    WebhookCreated,
    WebhookDeliveryOut,
    WebhookIn,
    WebhookList,
    WebhookOut,
    WebhookSecretOut,
    WebhookTestOut,
    WebhookUpdateIn,
)

router = APIRouter(prefix="/webhooks", tags=["M9 Webhooks"])

# UC-9.7's actor: an Organization Administrator, the same person who manages the API keys.
can_manage = require(Action.MANAGE_API_KEYS_AND_WEBHOOKS)


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _out(db: Session, webhook: Webhook, people: dict[uuid.UUID, str]) -> WebhookOut:
    last = db.scalar(
        select(WebhookDelivery)
        .where(WebhookDelivery.webhook_id == webhook.id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(1)
    )
    return WebhookOut(
        id=webhook.id,
        name=webhook.name,
        url=webhook.url,
        events=webhook.events,
        status=webhook.status,
        verified_at=webhook.verified_at,
        secret_created_at=webhook.secret_created_at,
        secret_is_old=webhooks.stale_secret(webhook),
        failures=webhook.failures,
        disabled_at=webhook.disabled_at,
        created_at=webhook.created_at,
        created_by=people.get(webhook.created_by_id or uuid.UUID(int=0)),
        last_delivery=_delivery(last) if last is not None else None,
    )


def _delivery(delivery: WebhookDelivery) -> WebhookDeliveryOut:
    return WebhookDeliveryOut(
        id=delivery.id,
        event=delivery.event,
        payload=delivery.payload,
        attempts=delivery.attempts,
        status_code=delivery.status_code,
        duration_ms=delivery.duration_ms,
        error=delivery.error,
        delivered_at=delivery.delivered_at,
        created_at=delivery.created_at,
    )


def _people(db: Session, rows: list[Webhook]) -> dict[uuid.UUID, str]:
    wanted = {one.created_by_id for one in rows}
    wanted.discard(None)
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


@router.get("")
def list_webhooks(
    membership: Membership = Depends(can_manage), db: Session = Depends(get_db)
) -> WebhookList:
    """Screen 57: the endpoints with the events they carry and how their last delivery went."""
    rows = webhooks.webhooks_of(db, membership.organization_id)
    people = _people(db, rows)
    return WebhookList(
        webhooks=[_out(db, one, people) for one in rows],
        events=[{"key": event.key, "label": event.label} for event in EVENTS],
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_webhook(
    data: WebhookIn,
    request: Request,
    membership: Membership = Depends(can_manage),
    session: UserSession = Depends(recent_password_confirmation),
    db: Session = Depends(get_db),
) -> WebhookCreated:
    """Steps 1-3: the address, the events and the signing secret, which is shown once."""
    user = db.get_one(User, membership.user_id)
    webhook, secret = webhooks.create(
        db,
        organization_id=membership.organization_id,
        user=user,
        name=data.name,
        url=data.url,
        events=data.events,
    )
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=user,
        action="webhook.created",
        summary=f"Added the webhook {webhook.name}",
        item=audit.Item("webhook", webhook.id, webhook.name),
        details={"url": webhook.url, "events": webhook.events},
        source_address=_ip(request),
    )
    db.commit()
    return WebhookCreated(webhook=_out(db, webhook, {user.id: user.name}), secret=secret)


@router.post("/{webhook_id}/test")
def test_webhook(
    webhook_id: uuid.UUID,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> WebhookTestOut:
    """Step 4: a signed test event. The receiving system confirms it by answering 2xx, and the
    webhook becomes active (step 5); 4a1 shows what it answered instead."""
    delivery = webhooks.test(db, membership.organization_id, webhook_id)
    webhook = webhooks.row(db, membership.organization_id, webhook_id)
    db.commit()
    return WebhookTestOut(
        ok=delivery.error is None,
        message=delivery.error
        or f"The receiving system answered {delivery.status_code} in {delivery.duration_ms} ms.",
        webhook=_out(db, webhook, _people(db, [webhook])),
        delivery=_delivery(delivery),
    )


@router.patch("/{webhook_id}")
def update_webhook(
    webhook_id: uuid.UUID,
    data: WebhookUpdateIn,
    request: Request,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> WebhookOut:
    """The events, the name, the address, and switching it off or on again."""
    user = db.get_one(User, membership.user_id)
    webhook = webhooks.update(
        db,
        membership.organization_id,
        webhook_id,
        name=data.name,
        url=data.url,
        events=data.events,
        status=data.status,
    )
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=user,
        action="webhook.changed",
        summary=f"Changed the webhook {webhook.name} ({webhook.status})",
        item=audit.Item("webhook", webhook.id, webhook.name),
        details={"events": webhook.events, "status": webhook.status},
        source_address=_ip(request),
    )
    db.commit()
    return _out(db, webhook, _people(db, [webhook]))


@router.post("/{webhook_id}/secret")
def rotate_secret(
    webhook_id: uuid.UUID,
    request: Request,
    membership: Membership = Depends(can_manage),
    session: UserSession = Depends(recent_password_confirmation),
    db: Session = Depends(get_db),
) -> WebhookSecretOut:
    """A new signing secret, shown once. The old one stops working at that moment."""
    user = db.get_one(User, membership.user_id)
    secret = webhooks.rotate_secret(db, membership.organization_id, webhook_id)
    webhook = webhooks.row(db, membership.organization_id, webhook_id)
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=user,
        action="webhook.secret_rotated",
        summary=f"Rotated the signing secret of the webhook {webhook.name}",
        item=audit.Item("webhook", webhook.id, webhook.name),
        source_address=_ip(request),
    )
    db.commit()
    return WebhookSecretOut(secret=secret, webhook=_out(db, webhook, _people(db, [webhook])))


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_webhook(
    webhook_id: uuid.UUID,
    request: Request,
    membership: Membership = Depends(can_manage),
    session: UserSession = Depends(recent_password_confirmation),
    db: Session = Depends(get_db),
) -> None:
    user = db.get_one(User, membership.user_id)
    webhook = webhooks.delete(db, membership.organization_id, webhook_id)
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=user,
        action="webhook.deleted",
        summary=f"Removed the webhook {webhook.name}",
        item=audit.Item("webhook", webhook.id, webhook.name),
        source_address=_ip(request),
    )
    db.commit()


@router.get("/{webhook_id}/deliveries")
def list_deliveries(
    webhook_id: uuid.UUID,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> list[WebhookDeliveryOut]:
    """ "Recent deliveries" of Screen 57: what was sent, what came back and how often it was
    tried."""
    webhooks.row(db, membership.organization_id, webhook_id)  # 404 before anything is read
    return [
        _delivery(one) for one in webhooks.deliveries_of(db, membership.organization_id, webhook_id)
    ]
