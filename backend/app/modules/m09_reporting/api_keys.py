"""The API keys integrations authenticate with (FR-9.5, UC-9.6 Manage API Keys).

A key is shown once, when it is created, and kept only as its first characters and the SHA-256 of
the whole key (NFR-3.1). It carries the scopes it was given and, if the administrator limited it,
the targets it may read; nothing it can hold reaches members, roles or other keys, because the
dependency that accepts a key is used by the endpoints that declare a scope and by nothing else
(UC-9.6, quality requirement 2).
"""

import hashlib
import hmac
import math
import secrets
import string
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.database import get_db
from app.core.errors import FieldValidationError, NotAuthenticatedError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users import deps
from app.modules.m01_users.models import Membership, MembershipStatus, Role, User
from app.modules.m02_targets.models import Target
from app.modules.m09_reporting import notifications
from app.modules.m09_reporting.models import ApiKey, ApiKeyScope

PREFIX = "snt_"
SECRET_CHARS = string.ascii_lowercase + string.digits
SECRET_LENGTH = 32
SHOWN = len(PREFIX) + 8  # what the page shows and what finds the row: snt_3f9a2b1c
MAX_YEARS = 2  # a key may not outlive two years; UC-9.6 step 3 asks for an expiry date
SOON_DAYS = 14  # when the page and the notification call a key "expires soon" (3a1)
USED_EVERY = timedelta(minutes=1)  # how often "last used" is written at most
# What a scope lets a key do, in the words of Screen 56, and what it still waits for.
SCOPE_LABELS = {
    ApiKeyScope.RUN_SECURITY_GATE: "Run security gate",
    ApiKeyScope.READ_GATE_RESULTS: "Read gate results",
    ApiKeyScope.READ_FINDINGS: "Read findings",
    ApiKeyScope.READ_REPORTS: "Read reports",
    ApiKeyScope.LAUNCH_CAMPAIGNS: "Launch campaigns",
}
# The scopes whose endpoints exist today. The others are kept, because an administrator sets a key
# up before the feature arrives, and the page says what each one waits for.
AVAILABLE = {ApiKeyScope.READ_FINDINGS}
WAITING_FOR = {
    ApiKeyScope.RUN_SECURITY_GATE: "the security gate (FR-9.4)",
    ApiKeyScope.READ_GATE_RESULTS: "the security gate (FR-9.4)",
    ApiKeyScope.READ_REPORTS: "the reports (FR-9.1)",
    ApiKeyScope.LAUNCH_CAMPAIGNS: "campaigns through the API (FR-5.3)",
}


def _now() -> datetime:
    return datetime.now(UTC)


def new_key() -> tuple[str, str, str]:
    """A key, its prefix and its hash. The key leaves Sentra once and is never stored."""
    secret = "".join(secrets.choice(SECRET_CHARS) for _ in range(SECRET_LENGTH))
    key = f"{PREFIX}{secret}"
    return key, key[:SHOWN], hashlib.sha256(key.encode()).hexdigest()


def clean_scopes(scopes: list[str]) -> list[str]:
    """The scopes Sentra knows, each once, in the order of Screen 56."""
    wanted = {str(scope) for scope in scopes}
    return [scope.value for scope in ApiKeyScope if scope.value in wanted]


def expires_soon(key: ApiKey, at: datetime | None = None) -> bool:
    return key.revoked_at is None and key.expires_at <= (at or _now()) + timedelta(days=SOON_DAYS)


def state(key: ApiKey, at: datetime | None = None) -> str:
    """What the page says about a key: active, expiring soon, expired or revoked."""
    now = at or _now()
    if key.revoked_at is not None:
        return "revoked"
    if key.expires_at <= now:
        return "expired"
    return "expiring" if expires_soon(key, now) else "active"


# ---------------------------------------------------------------- making and revoking (UC-9.6)


def create(
    db: Session,
    *,
    organization_id: uuid.UUID,
    user: User,
    name: str,
    purpose: str,
    scopes: list[str],
    target_ids: list[uuid.UUID],
    expires_at: datetime,
) -> tuple[ApiKey, str]:
    """Steps 1-5: the key with its scopes, its target limit and its expiry date. It is returned
    once, in plain text, and never again (quality requirement 5)."""
    wanted = clean_scopes(scopes)
    if not name.strip():
        raise FieldValidationError("name", "Give the key a name.")
    if not wanted:
        raise FieldValidationError("scopes", "Choose at least one scope.")
    if expires_at <= _now():
        raise FieldValidationError("expires_at", "Choose a date in the future.")
    if expires_at > _now() + timedelta(days=365 * MAX_YEARS):
        raise FieldValidationError(
            "expires_at", f"A key may not last longer than {MAX_YEARS} years."
        )
    if target_ids:
        found = set(
            db.scalars(
                scoped_select(Target, organization_id).where(Target.id.in_(target_ids))
            ).all()
        )
        if len(found) != len(set(target_ids)):
            raise FieldValidationError("target_ids", "One of the targets doesn't exist.")
    key, prefix, key_hash = new_key()
    row = ApiKey(
        organization_id=organization_id,
        name=name.strip()[:80],
        purpose=purpose.strip()[:300],
        prefix=prefix,
        key_hash=key_hash,
        scopes=wanted,
        target_ids=[str(one) for one in target_ids],
        created_by_id=user.id,
        expires_at=expires_at,
    )
    db.add(row)
    db.flush()
    audit.record(
        db,
        organization_id=organization_id,
        actor=user,
        action="api_key.created",
        summary=f"Created the API key {row.name} ({row.prefix}…)",
        item=audit.Item("api_key", row.id, row.name),
        details={"prefix": row.prefix, "scopes": wanted, "expires_at": expires_at.isoformat()},
    )
    db.commit()
    return row, key


def revoke(db: Session, organization_id: uuid.UUID, user: User, key_id: uuid.UUID) -> ApiKey:
    """1a1: the key is refused from this moment on, and stays listed with its reason to exist."""
    row = db.scalar(scoped_select(ApiKey, organization_id).where(ApiKey.id == key_id))
    if row is None:
        raise NotFoundError("API key not found.")
    if row.revoked_at is None:
        row.revoked_at = _now()
        row.revoked_by_id = user.id
        audit.record(
            db,
            organization_id=organization_id,
            actor=user,
            action="api_key.revoked",
            summary=f"Revoked the API key {row.name} ({row.prefix}…)",
            item=audit.Item("api_key", row.id, row.name),
            details={"prefix": row.prefix},
        )
        db.commit()
    return row


def keys_of(db: Session, organization_id: uuid.UUID) -> list[ApiKey]:
    """The organization's keys, the newest first; a revoked key stays in the list."""
    return list(
        db.scalars(scoped_select(ApiKey, organization_id).order_by(ApiKey.created_at.desc()))
    )


# ---------------------------------------------------------------- authenticating with a key


def authenticate(db: Session, raw: str) -> ApiKey | None:
    """The key behind an Authorization header, or None. A revoked or expired key is nobody."""
    key = raw.strip()
    if not key.startswith(PREFIX) or len(key) != len(PREFIX) + SECRET_LENGTH:
        return None
    row = db.scalar(select(ApiKey).where(ApiKey.prefix == key[:SHOWN]))
    if row is None:
        return None
    if not hmac.compare_digest(row.key_hash, hashlib.sha256(key.encode()).hexdigest()):
        return None
    now = _now()
    if row.revoked_at is not None or row.expires_at <= now:
        return None
    if row.last_used_at is None or now - row.last_used_at > USED_EVERY:
        row.last_used_at = now
        db.commit()
    return row


@dataclass
class Actor:
    """Who is asking: a member with a session, or an integration with a key."""

    organization_id: uuid.UUID
    membership: Membership | None = None
    key: ApiKey | None = None

    @property
    def target_ids(self) -> list[uuid.UUID]:
        """The targets a key is limited to; empty means every target of the organization."""
        return [uuid.UUID(one) for one in (self.key.target_ids if self.key else [])]

    def allows(self, target_id: uuid.UUID | None) -> bool:
        limit = self.target_ids
        return not limit or (target_id is not None and target_id in limit)


def _bearer(request: Request) -> str:
    header = request.headers.get("authorization", "")
    return header[7:] if header.lower().startswith("bearer ") else ""


def reader(scope: ApiKeyScope):
    """A dependency for an endpoint an integration may use: a member's session as before, or a
    key that holds this scope (FR-9.5). An endpoint without such a dependency can never be
    reached with a key."""

    def dependency(request: Request, db: Session = Depends(get_db)) -> Actor:
        raw = _bearer(request)
        if raw:
            key = authenticate(db, raw)
            if key is None:
                raise NotAuthenticatedError("This API key is not valid.", code="invalid_api_key")
            if scope.value not in key.scopes:
                raise NotAuthenticatedError(
                    f"This API key may not {SCOPE_LABELS[scope].lower()}.", code="scope_missing"
                )
            return Actor(organization_id=key.organization_id, key=key)
        # No key: the browser's session, through M1's own dependencies, so a member sees exactly
        # what they see everywhere else (the suspended and no-organization answers included).
        membership = deps.current_membership(deps.current_session(request, db), db)
        return Actor(organization_id=membership.organization_id, membership=membership)

    return dependency


def with_key(request: Request, db: Session = Depends(get_db)) -> ApiKey:
    """For the one endpoint only a key may call: GET /api-keys/me, which lets an integration
    check its key before it uses it."""
    key = authenticate(db, _bearer(request))
    if key is None:
        raise NotAuthenticatedError("This API key is not valid.", code="invalid_api_key")
    return key


# ---------------------------------------------------------------- the expiry warning (3a1)


def expiring(db: Session, at: datetime | None = None) -> list[ApiKey]:
    """The keys that expire within the next two weeks and whose administrators were not told yet."""
    now = at or _now()
    return list(
        db.scalars(
            select(ApiKey).where(
                ApiKey.revoked_at.is_(None),
                ApiKey.expiry_notified_at.is_(None),
                ApiKey.expires_at > now,
                ApiKey.expires_at <= now + timedelta(days=SOON_DAYS),
            )
        )
    )


def notify_expiring(db: Session, at: datetime | None = None) -> int:
    """UC-9.6, 3a1: tells the organization's administrators once that a key is about to expire, so
    the integration can be given a new one before it stops working. The scheduler of FR-5.3 calls
    it daily once J-S3-01 is merged; until then it is called by hand and by its test."""
    now = at or _now()
    told = 0
    for key in expiring(db, now):
        admins = [
            membership.user_id
            for membership in db.scalars(
                select(Membership).where(
                    Membership.organization_id == key.organization_id,
                    Membership.role == Role.ORG_ADMIN,
                    Membership.status == MembershipStatus.ACTIVE,
                )
            )
        ]
        days = max(1, math.ceil((key.expires_at - now) / timedelta(days=1)))
        notifications.notify(
            db,
            event="api_key_expiring",
            user_ids=admins,
            organization_id=key.organization_id,
            text=f"The API key {key.name} ({key.prefix}…) expires in {days} "
            f"{'day' if days == 1 else 'days'}. Create a new one for the integration before then.",
            subject=f"API key {key.name} expires soon",
            link="/integrations",
        )
        key.expiry_notified_at = now
        told += 1
    if told:
        db.commit()
    return told
