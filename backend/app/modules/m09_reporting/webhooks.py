"""Webhooks (FR-9.6, UC-9.7): selected events sent to the organization's own systems as signed
notifications.

**What a receiver gets.** A JSON body with the event, when it happened, a one-line summary and a
link into Sentra — the same summary a person sees in their notifications — and never evidence,
a reply from a target, or a secret (quality requirement 6). The body is signed with HMAC-SHA256
over `<timestamp>.<body>`, so a receiver can prove it came from Sentra and that it is not a replay
of an old delivery (quality requirement 1).

**Where the events come from.** Every event Sentra tells a person about goes through
`notifications.notify()`, and that is the one place this module is called from. So a webhook can
carry any event of `events.py` without a single other module knowing webhooks exist, and an event
that is added later is available to webhooks the moment it has a label.

**The address.** It is typed by an administrator and called by Sentra, so it goes through
`app/core/addresses.py`, the same check a target endpoint gets, and only over https (step 2,
NFR-3.4). It is **not** sent through the Target Connector: that is the one code path that talks to
targets, and a webhook receiver is not a target.
"""

import hashlib
import hmac
import json
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import addresses, crypto
from app.core.config import get_settings
from app.core.errors import FieldValidationError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import Membership, MembershipStatus, Role, User
from app.modules.m09_reporting.events import BY_KEY
from app.modules.m09_reporting.models import Webhook, WebhookDelivery, WebhookStatus

# The tests replace this with a receiving system of their own, the way the Target Connector's
# network is replaced (tests/conftest.py).
TRANSPORT: httpx.BaseTransport | None = None
TIMEOUT = httpx.Timeout(10.0)

SECRET_BYTES = 32
VERSION = "v1"  # of the signature scheme, so a second one can live beside it later
TEST_EVENT = "webhook.test"
# 6a1: how often a delivery is tried, and how long Sentra waits before each next attempt.
ATTEMPTS = 4
BACKOFF_SECONDS = (30, 300, 1800)
# After this many deliveries that failed in a row, the webhook is switched off and the
# administrators are told (NFR-2.3). A delivery that arrives sets the count back to zero.
FAILURES_BEFORE_DISABLED = 10
RECENT = 20  # the deliveries Screen 57 lists per webhook


def _now() -> datetime:
    return datetime.now(UTC)


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False, transport=TRANSPORT)


# ---------------------------------------------------------------- the webhook (UC-9.7 steps 1-5)


def new_secret() -> str:
    """The signing secret, shown once. It is the receiver's half of every signature."""
    return f"whsec_{secrets.token_urlsafe(SECRET_BYTES)}"


def _context(webhook_id: uuid.UUID) -> str:
    return f"webhook-secret:{webhook_id}"


def _url(value: str) -> str:
    """Step 2: an https address that is not inside Sentra's own network (NFR-3.4)."""
    url = value.strip()
    if not url.lower().startswith("https://"):
        raise FieldValidationError(
            "url", "Enter an https:// address. Sentra does not send events unencrypted."
        )
    try:
        return addresses.check_url(url, allow_private=get_settings().allow_private_targets)
    except addresses.AddressNotAllowed as exc:
        raise FieldValidationError("url", str(exc)) from exc


def _events(wanted: list[str]) -> list[str]:
    """Step 1: the events to send. They are the events of FR-9.3, so a receiver can be sent
    anything a person can be told about, and nothing else."""
    chosen = [key for key in dict.fromkeys(wanted) if key in BY_KEY]
    if not chosen:
        raise FieldValidationError("events", "Choose at least one event to send.")
    return chosen


def _name(value: str) -> str:
    name = value.strip()
    if not name:
        raise FieldValidationError("name", "Give the webhook a name, such as the system it feeds.")
    return name[:80]


def create(
    db: Session,
    *,
    organization_id: uuid.UUID,
    user: User,
    name: str,
    url: str,
    events: list[str],
) -> tuple[Webhook, str]:
    """Steps 1-3. The webhook starts inactive: it is activated by a test event the receiving
    system confirms (step 4). Returns the secret once; it is never readable again."""
    # The id is made here, not by the insert: the secret is bound to it, so it has to exist
    # before the row does (app/core/crypto.py binds every value to its own context).
    webhook_id = uuid.uuid4()
    secret = new_secret()
    webhook = Webhook(
        id=webhook_id,
        organization_id=organization_id,
        name=_name(name),
        url=_url(url),
        events=_events(events),
        secret=crypto.encrypt(secret, _context(webhook_id)),
        status=WebhookStatus.INACTIVE,
        created_by_id=user.id,
    )
    db.add(webhook)
    db.flush()
    return webhook, secret


def update(
    db: Session,
    organization_id: uuid.UUID,
    webhook_id: uuid.UUID,
    *,
    name: str | None = None,
    url: str | None = None,
    events: list[str] | None = None,
    status: str | None = None,
) -> Webhook:
    """What an administrator may change. A new address has to prove itself again, so changing it
    sets the webhook back to inactive — the old address confirmed a test event, the new one has
    not."""
    webhook = row(db, organization_id, webhook_id)
    if name is not None:
        webhook.name = _name(name)
    if events is not None:
        webhook.events = _events(events)
    if url is not None and _url(url) != webhook.url:
        webhook.url = _url(url)
        webhook.verified_at = None
        webhook.status = WebhookStatus.INACTIVE
    if status is not None:
        if status not in (WebhookStatus.ACTIVE, WebhookStatus.PAUSED):
            raise FieldValidationError("status", "A webhook is active or paused.")
        if status == WebhookStatus.ACTIVE and webhook.verified_at is None:
            raise FieldValidationError(
                "status", "Send a test event first, so the receiving system can confirm it."
            )
        webhook.status = status
        if status == WebhookStatus.ACTIVE:
            webhook.failures = 0
            webhook.disabled_at = None
    db.flush()
    return webhook


def rotate_secret(db: Session, organization_id: uuid.UUID, webhook_id: uuid.UUID) -> str:
    """A new signing secret, shown once. The old one stops working at that moment, so the
    receiving system is given the new one before the next event arrives."""
    webhook = row(db, organization_id, webhook_id)
    secret = new_secret()
    webhook.secret = crypto.encrypt(secret, _context(webhook.id))
    webhook.secret_created_at = _now()
    db.flush()
    return secret


def delete(db: Session, organization_id: uuid.UUID, webhook_id: uuid.UUID) -> Webhook:
    webhook = row(db, organization_id, webhook_id)
    db.delete(webhook)
    db.flush()
    return webhook


def row(db: Session, organization_id: uuid.UUID, webhook_id: uuid.UUID) -> Webhook:
    webhook = db.scalar(scoped_select(Webhook, organization_id).where(Webhook.id == webhook_id))
    if webhook is None:
        raise NotFoundError("Webhook not found.")
    return webhook


def webhooks_of(db: Session, organization_id: uuid.UUID) -> list[Webhook]:
    return list(
        db.scalars(scoped_select(Webhook, organization_id).order_by(Webhook.created_at.desc()))
    )


def deliveries_of(
    db: Session, organization_id: uuid.UUID, webhook_id: uuid.UUID, limit: int = RECENT
) -> list[WebhookDelivery]:
    return list(
        db.scalars(
            scoped_select(WebhookDelivery, organization_id)
            .where(WebhookDelivery.webhook_id == webhook_id)
            .order_by(WebhookDelivery.created_at.desc())
            .limit(limit)
        )
    )


# ---------------------------------------------------------------- what is sent, and how


def body_of(event: str, payload: dict, delivery_id: uuid.UUID, at: datetime) -> bytes:
    """The JSON a receiver gets. `payload` is already a summary; nothing is added to it here."""
    return json.dumps(
        {
            "id": str(delivery_id),
            "event": event,
            "created_at": at.isoformat(),
            "data": payload,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()


def signature(secret: str, timestamp: str, body: bytes) -> str:
    """HMAC-SHA256 over `<timestamp>.<body>` (quality requirement 1). The timestamp is signed
    with the body, so an old delivery cannot be replayed as a new one."""
    signed = f"{timestamp}.".encode() + body
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"{VERSION}={digest}"


def headers_for(secret: str, event: str, delivery_id: uuid.UUID, body: bytes) -> dict[str, str]:
    timestamp = str(int(time.time()))
    return {
        "Content-Type": "application/json",
        "User-Agent": "Sentra-Webhooks/1.0",
        "X-Sentra-Event": event,
        "X-Sentra-Delivery": str(delivery_id),
        "X-Sentra-Timestamp": timestamp,
        "X-Sentra-Signature": signature(secret, timestamp, body),
    }


def send(
    db: Session,
    *,
    organization_id: uuid.UUID,
    event: str,
    text: str,
    link: str | None = None,
    data: dict | None = None,
) -> list[WebhookDelivery]:
    """Step 6: one event to every active webhook of the organization that asked for it.

    Called by `notifications.notify()` after it has committed its own work, so a webhook that
    cannot be reached never holds up what a person sees. The caller commits.
    """
    from app.workers import jobs

    made = []
    for webhook in db.scalars(
        select(Webhook).where(
            Webhook.organization_id == organization_id,
            Webhook.status == WebhookStatus.ACTIVE,
            Webhook.events.contains([event]),
        )
    ).all():
        delivery = WebhookDelivery(
            organization_id=organization_id,
            webhook_id=webhook.id,
            event=event,
            payload=summary(event, text, link, data),
        )
        db.add(delivery)
        made.append(delivery)
    if made:
        db.flush()
        ids = [one.id for one in made]
        db.commit()
        for delivery_id in ids:
            jobs.start(db, JOB, delivery_id, 0)
    return made


def summary(event: str, text: str, link: str | None, data: dict | None) -> dict:
    """What travels: the event in words, a link, and whatever named values the event has — a
    finding's code and severity, a run's number. Never a message, a reply or a secret."""
    body = {
        "event": event,
        "label": BY_KEY[event].label if event in BY_KEY else event,
        "summary": text[:300],
        "link": link,
    }
    if data:
        body |= {key: value for key, value in data.items() if value is not None}
    return body


JOB = "webhooks.deliver"


def deliver(db: Session, delivery_id: uuid.UUID, attempt: int = 0) -> WebhookDelivery:
    """One attempt at one delivery. 6a: a failure is tried again after a longer and longer wait,
    and a webhook whose deliveries keep failing is switched off and its administrators told."""
    from app.workers import jobs

    delivery = db.get(WebhookDelivery, delivery_id)
    if delivery is None or delivery.delivered_at is not None:
        return delivery
    webhook = db.get(Webhook, delivery.webhook_id)
    if webhook is None or webhook.status not in (WebhookStatus.ACTIVE, WebhookStatus.INACTIVE):
        return delivery

    delivery.attempts = attempt + 1
    status, duration, error = _post(webhook, delivery.event, delivery.id, delivery.payload)
    delivery.status_code = status
    delivery.duration_ms = duration
    delivery.error = error

    if error is None:
        delivery.delivered_at = _now()
        webhook.failures = 0
        db.commit()
        return delivery

    if delivery.attempts < ATTEMPTS:
        db.commit()
        jobs.start(
            db,
            JOB,
            delivery.id,
            delivery.attempts,
            countdown=BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)],
        )
        return delivery

    # Every attempt is spent: this delivery counts against the webhook (6a1).
    webhook.failures += 1
    if webhook.failures >= FAILURES_BEFORE_DISABLED and webhook.status == WebhookStatus.ACTIVE:
        webhook.status = WebhookStatus.DISABLED
        webhook.disabled_at = _now()
        db.commit()
        _tell_administrators(db, webhook)
    else:
        db.commit()
    return delivery


def _post(
    webhook: Webhook, event: str, delivery_id: uuid.UUID, payload: dict
) -> tuple[int | None, int | None, str | None]:
    """The request itself. Returns the status, how long it took, and what went wrong, if
    anything. Anything other than a 2xx is a failure the receiver's own words explain."""
    secret = crypto.decrypt(webhook.secret, _context(webhook.id))
    body = body_of(event, payload, delivery_id, _now())
    started = time.monotonic()
    try:
        # The address is checked again here, not only when it was saved: a host name can point
        # somewhere else later (NFR-3.4, the same rule the Target Connector follows).
        url = addresses.check_url(webhook.url, allow_private=get_settings().allow_private_targets)
        with _client() as client:
            answer = client.post(
                url, content=body, headers=headers_for(secret, event, delivery_id, body)
            )
    except addresses.AddressNotAllowed as exc:
        return None, None, str(exc)
    except httpx.HTTPError as exc:
        return None, int((time.monotonic() - started) * 1000), f"{type(exc).__name__}: {exc}"[:300]
    duration = int((time.monotonic() - started) * 1000)
    if 200 <= answer.status_code < 300:
        return answer.status_code, duration, None
    return answer.status_code, duration, _refusal(answer)


def _refusal(answer: httpx.Response) -> str:
    """What the receiving system said, short enough to show and never more than it said (4a1)."""
    text = (answer.text or "").strip().replace("\n", " ")
    said = f" {text[:200]}" if text else ""
    return f"The receiving system answered {answer.status_code}.{said}"


def test(db: Session, organization_id: uuid.UUID, webhook_id: uuid.UUID) -> WebhookDelivery:
    """Step 4: a signed test event, sent now and waited for. The receiving system confirms it by
    answering 2xx, and the webhook becomes active (step 5); 4a1 keeps it inactive and shows what
    the system answered."""
    webhook = row(db, organization_id, webhook_id)
    delivery = WebhookDelivery(
        organization_id=organization_id,
        webhook_id=webhook.id,
        event=TEST_EVENT,
        payload={
            "event": TEST_EVENT,
            "label": "Test event",
            "summary": f"A test event from Sentra for the webhook {webhook.name}.",
            "link": None,
        },
        attempts=1,
    )
    db.add(delivery)
    db.flush()
    status, duration, error = _post(webhook, TEST_EVENT, delivery.id, delivery.payload)
    delivery.status_code = status
    delivery.duration_ms = duration
    delivery.error = error
    if error is None:
        delivery.delivered_at = _now()
        webhook.verified_at = _now()
        webhook.failures = 0
        webhook.disabled_at = None
        webhook.status = WebhookStatus.ACTIVE
    db.flush()
    return delivery


def _tell_administrators(db: Session, webhook: Webhook) -> None:
    """6a1: the people who can do something about it are told — in a notification, not through
    the webhook that just stopped working."""
    from app.modules.m09_reporting import notifications

    admins = list(
        db.scalars(
            select(Membership.user_id).where(
                Membership.organization_id == webhook.organization_id,
                Membership.role == Role.ORG_ADMIN,
                Membership.status == MembershipStatus.ACTIVE,
            )
        )
    )
    if not admins:
        return
    notifications.notify(
        db,
        event="webhook_disabled",
        user_ids=admins,
        organization_id=webhook.organization_id,
        subject=f"Webhook disabled: {webhook.name}",
        text=(
            f"Sentra switched off the webhook {webhook.name} after "
            f"{webhook.failures} deliveries that could not be sent. No events are going to it."
        ),
        link="/integrations/webhooks",
        webhooks=False,  # a webhook that is off cannot carry the news that it is off
    )


def stale_secret(webhook: Webhook, at: datetime | None = None) -> bool:
    """Only for the page's wording: a secret that has been in use for over a year is old enough
    to be worth rotating. Nothing is enforced; it is the organization's decision."""
    return webhook.secret_created_at < (at or _now()) - timedelta(days=365)
