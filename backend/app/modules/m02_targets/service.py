"""Targets: register, list, read and change them (FR-2.1, FR-2.2, UC-2.1, UC-2.5)."""

import re
import secrets
import uuid
from urllib.parse import urlsplit

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core import addresses, audit
from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import Membership, User
from app.modules.m02_targets import formats
from app.modules.m02_targets.formats import RequestFormat
from app.modules.m02_targets.models import (
    CredentialType,
    Target,
    TargetCredential,
    TargetStatus,
)
from app.modules.m02_targets.schemas import CredentialIn, TargetIn, TargetPatch

MAX_RATE = 600  # requests per minute: an upper limit for every target (FR-5.7)
MAX_CREDENTIALS = 10

NAME_REQUIRED = "Enter a name."
NAME_TOO_LONG = "Use at most 120 characters."
NAME_TAKEN = "A target with this name already exists. Choose another name."
URL_TOO_LONG = "Use at most 2,048 characters."
RATE_RANGE = f"Enter a rate between 1 and {MAX_RATE} requests per minute."
TEMPLATE_REQUIRED = "Describe the request body, with {{message}} where Sentra's message goes."
REPLY_PATH_REQUIRED = "Enter where the reply is, for example $.output.text."
BAD_PATH = "Use a path such as $.output.text."
ONE_WAY = "Choose one way to authenticate: an API key, a bearer token or custom headers."
TOO_MANY = f"Use at most {MAX_CREDENTIALS} headers."
HEADER_NAME = "Use a header name with letters, digits and dashes, such as X-Api-Key."
HEADER_RESERVED = "Sentra sets this header itself. Use another one."
HEADER_TWICE = "Each header can be used only once."
VALUE_REQUIRED = "Enter the secret."
VALUE_LINE_BREAK = "The value can't contain line breaks."
VALUE_TOO_LONG = "Use at most 4,096 characters."
ARCHIVED = "This target is archived. Restore it before changing it."
LAB_ADDRESS = (
    "This address belongs to Sentra's own Security Lab. Sentra adds its lab targets itself, so "
    "it can't be registered here."
)

_HEADER = re.compile(r"[A-Za-z0-9-]{1,100}")
_RESERVED = {"host", "content-length", "content-type", "transfer-encoding", "connection"}


class _Errors:
    """Collects every field error, so the user sees them all at once (UC-2.1, 5a)."""

    def __init__(self) -> None:
        self.details: list[dict[str, str]] = []

    def add(self, field: str, message: str) -> None:
        self.details.append({"field": field, "message": message})

    def raise_if_any(self) -> None:
        if self.details:
            raise AppError(
                "Some fields are invalid.",
                code="validation_error",
                status_code=422,
                details=self.details,
            )


# ---------------------------------------------------------------- reading


def get_target(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> Target:
    """A target of the member's organization. Any other ID gives the same "not found" (NFR-3.3)."""
    target = db.scalar(
        scoped_select(Target, organization_id)
        .where(Target.id == target_id)
        .options(selectinload(Target.credentials))
    )
    if target is None:
        raise NotFoundError("Target not found.")
    return target


def list_targets(
    db: Session,
    organization_id: uuid.UUID,
    tab: str,
    search: str,
    types: list[str],
    environments: list[str],
    ownership: list[str],
    page: int,
    page_size: int,
) -> tuple[list[Target], int, dict[str, int]]:
    """The targets page (Screen 16): the Active or Archived tab, search and filters."""
    archived = Target.status == TargetStatus.ARCHIVED
    counts = {
        "active": _count(db, scoped_select(Target, organization_id).where(~archived)),
        "archived": _count(db, scoped_select(Target, organization_id).where(archived)),
    }
    query = scoped_select(Target, organization_id).where(
        archived if tab == "archived" else ~archived
    )
    if search.strip():
        like = "%" + re.sub(r"([%_\\])", r"\\\1", search.strip()) + "%"
        query = query.where(
            or_(Target.name.ilike(like, escape="\\"), Target.endpoint_url.ilike(like, escape="\\"))
        )
    if types:
        query = query.where(Target.type.in_(types))
    if environments:
        query = query.where(Target.environment.in_(environments))
    if ownership:
        query = query.where(Target.status.in_(ownership))
    total = _count(db, query)
    items = db.scalars(
        query.options(selectinload(Target.credentials))
        .order_by(func.lower(Target.name))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return list(items), total, counts


def owner_names(db: Session, targets: list[Target]) -> dict[uuid.UUID, str]:
    """The names of the people who registered the targets (the Owner column)."""
    ids = {t.created_by_id for t in targets if t.created_by_id}
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(ids))).all())


def _count(db: Session, query: Select) -> int:
    return db.scalar(select(func.count()).select_from(query.subquery()))


# ---------------------------------------------------------------- changing


def check_endpoint(url: str) -> str:
    """Wizard step 1 checks the address before the user goes on (UC-2.1, 5b)."""
    errors = _Errors()
    url = _endpoint(errors, url)
    errors.raise_if_any()
    return url


def register(db: Session, membership: Membership, data: TargetIn) -> Target:
    """UC-2.1: validate, encrypt the credentials and save the target as unverified."""
    errors = _Errors()
    name = _name(db, errors, membership.organization_id, data.name)
    url = _endpoint(errors, data.endpoint_url)
    rate = _rate(errors, data.max_request_rate)
    request_template, response_template = _format(
        errors, data.request_format, data.request_template, data.reply_path, data.tool_calls_path
    )
    credentials = _credentials(errors, data.credentials)
    errors.raise_if_any()

    target = Target(
        organization_id=membership.organization_id,
        name=name,
        type=data.type,
        endpoint_url=url,
        environment=data.environment,
        max_request_rate=rate,
        request_template=request_template,
        response_template=response_template,
        status=TargetStatus.UNVERIFIED,
        verification_token=secrets.token_hex(16),  # proves ownership later (FR-2.3)
        created_by_id=membership.user_id,
    )
    db.add(target)
    db.flush()  # gives the target its ID, which every encrypted credential is bound to
    _store(target, credentials)
    _audit(
        db,
        membership,
        target,
        "target.registered",
        f"Registered target {target.name}",
        {"endpoint_url": url, "environment": target.environment, "type": target.type},
    )
    db.commit()
    _test_connection(db, target, membership.user_id)  # step 7
    return get_target(db, membership.organization_id, target.id)


def update(db: Session, membership: Membership, target_id: uuid.UUID, data: TargetPatch) -> Target:
    """UC-2.5: change the settings. A new endpoint makes the target unverified (FR-2.6)."""
    given = data.model_fields_set
    # 3b1: the endpoint decides where Sentra sends, so a run in progress stops it from changing
    target = _changeable(db, membership, target_id, sending="endpoint_url" in given)
    errors = _Errors()
    name, rate, url = target.name, target.max_request_rate, target.endpoint_url
    if "name" in given:
        name = _name(db, errors, membership.organization_id, data.name or "", target.id)
    if "max_request_rate" in given:
        rate = _rate(errors, data.max_request_rate)
    if "endpoint_url" in given:
        url = _endpoint(errors, data.endpoint_url or "")
    templates = (target.request_template, target.response_template)
    if given & {"request_format", "request_template", "reply_path", "tool_calls_path"}:
        current = target.response_template or {}
        templates = _format(
            errors,
            data.request_format or request_format(target),
            data.request_template if "request_template" in given else target.request_template,
            data.reply_path if "reply_path" in given else current.get("reply"),
            data.tool_calls_path if "tool_calls_path" in given else current.get("tool_calls"),
        )
    errors.raise_if_any()

    changed = [
        field
        for field, before, after in [
            ("name", target.name, name),
            ("max_request_rate", target.max_request_rate, rate),
            ("environment", target.environment, data.environment or target.environment),
            ("request_format", (target.request_template, target.response_template), templates),
            ("endpoint_url", target.endpoint_url, url),
        ]
        if before != after
    ]
    target.name, target.max_request_rate = name, rate
    if data.environment is not None:
        target.environment = data.environment
    target.request_template, target.response_template = templates
    summary = f"Changed the configuration of target {target.name}"
    if url != target.endpoint_url:
        target.endpoint_url = url
        target.status = TargetStatus.UNVERIFIED  # ownership must be proved again (FR-2.6)
        target.verification_token = secrets.token_hex(16)
        target.verified_at = target.verified_by_id = target.verification_method = None
        summary += "; its new endpoint must be verified again"
    if changed:
        _audit(db, membership, target, "target.updated", summary, {"changed": changed})
    db.commit()
    if {"endpoint_url", "request_format"} & set(changed):
        _test_connection(db, target, membership.user_id)  # UC-2.2, after a configuration change
    return get_target(db, membership.organization_id, target.id)


def replace_credentials(
    db: Session, membership: Membership, target_id: uuid.UUID, new: list[CredentialIn]
) -> Target:
    """UC-2.5 step 4: encrypt the new credentials and delete the replaced ones."""
    target = _changeable(db, membership, target_id, sending=True)  # 3b1
    errors = _Errors()
    credentials = _credentials(errors, new)
    errors.raise_if_any()
    target.credentials.clear()
    db.flush()  # the old rows are deleted before new ones with the same header names are added
    _store(target, credentials)
    # Only the header names: a secret never reaches the audit log (UC-10.3).
    _audit(
        db,
        membership,
        target,
        "target.credentials_replaced",
        f"Replaced the credentials of target {target.name}",
        {"headers": [name for name, _, _ in credentials]},
    )
    db.commit()
    _test_connection(db, target, membership.user_id)  # UC-2.2, after a configuration change
    return get_target(db, membership.organization_id, target.id)


def request_format(target: Target) -> RequestFormat:
    return (
        RequestFormat.OPENAI_CHAT if target.request_template is None else RequestFormat.CUSTOM_JSON
    )


def _test_connection(db: Session, target: Target, user_id: uuid.UUID) -> None:
    """Sentra tests the connection itself after a registration or a change (UC-2.2 trigger); the
    page shows the result when the worker has finished."""
    from app.modules.m02_targets import connection

    connection.start(db, target, user_id)


def _changeable(
    db: Session, membership: Membership, target_id: uuid.UUID, *, sending: bool = False
) -> Target:
    """The target, if it may be changed at all. `sending` is for the endpoint and the credentials:
    they decide where and how Sentra sends, so they may not change while a campaign run of the
    target is in progress (UC-2.5, 3b1)."""
    from app.modules.m02_targets import lifecycle

    target = get_target(db, membership.organization_id, target_id)
    if target.status == TargetStatus.ARCHIVED:
        raise ConflictError(ARCHIVED, code="target_archived")
    if sending and (blocked := lifecycle.running_text(db, target.id)):
        raise ConflictError(blocked, code="run_in_progress")
    return target


def _audit(
    db: Session, membership: Membership, target: Target, action: str, summary: str, details: dict
) -> None:
    audit.record(
        db,
        organization_id=membership.organization_id,
        actor=db.get_one(User, membership.user_id),
        action=action,
        summary=summary,
        item=audit.Item("target", target.id, target.name),
        details=details,
    )


def _store(target: Target, credentials: list[tuple[str, CredentialType, str]]) -> None:
    for name, credential_type, value in credentials:
        credential = TargetCredential(
            target_id=target.id, name=name, credential_type=credential_type
        )
        credential.set_value(value)
        target.credentials.append(credential)


# ---------------------------------------------------------------- validation


def _name(
    db: Session,
    errors: _Errors,
    organization_id: uuid.UUID,
    name: str,
    exclude: uuid.UUID | None = None,
) -> str:
    name = " ".join(name.split())
    if not name:
        errors.add("name", NAME_REQUIRED)
    elif len(name) > 120:
        errors.add("name", NAME_TOO_LONG)
    else:
        taken = scoped_select(Target, organization_id).where(
            func.lower(Target.name) == name.lower()
        )
        if exclude is not None:
            taken = taken.where(Target.id != exclude)
        if db.scalar(taken) is not None:
            errors.add("name", NAME_TAKEN)
    return name


def _endpoint(errors: _Errors, url: str) -> str:
    if len(url) > 2048:
        errors.add("endpoint_url", URL_TOO_LONG)
        return url
    # Only lab targets that Sentra adds itself may use lab addresses (UC-11.1, quality
    # requirement 4), also where private addresses are allowed.
    if _host(url) in get_settings().lab_hosts:
        errors.add("endpoint_url", LAB_ADDRESS)
        return url
    try:
        return addresses.check_url(url, allow_private=get_settings().allow_private_targets)
    except addresses.AddressNotAllowed as exc:
        errors.add("endpoint_url", str(exc))
        return url


def _host(url: str) -> str:
    try:
        return urlsplit(url.strip()).hostname or ""
    except ValueError:  # e.g. an unclosed [ of an IPv6 address; check_url names the problem
        return ""


def _rate(errors: _Errors, rate: int | None) -> int:
    if rate is None or not 1 <= rate <= MAX_RATE:
        errors.add("max_request_rate", RATE_RANGE)
        return 0
    return rate


def _format(
    errors: _Errors,
    request_format_: RequestFormat,
    request_template: str | None,
    reply_path: str | None,
    tool_calls_path: str | None,
) -> tuple[str | None, dict | None]:
    """Returns (request_template, response_template); both None for the OpenAI-compatible API."""
    if request_format_ == RequestFormat.OPENAI_CHAT:
        return None, None
    template = (request_template or "").strip()
    if not template:
        errors.add("request_template", TEMPLATE_REQUIRED)
    elif problem := formats.template_problem(template):
        errors.add("request_template", problem)
    reply = (reply_path or "").strip()
    if not reply:
        errors.add("reply_path", REPLY_PATH_REQUIRED)
    elif formats.parse_path(reply) is None:
        errors.add("reply_path", BAD_PATH)
    tool_calls = (tool_calls_path or "").strip() or None
    if tool_calls and formats.parse_path(tool_calls) is None:
        errors.add("tool_calls_path", BAD_PATH)
    response = {"reply": reply}
    if tool_calls:
        response["tool_calls"] = tool_calls
    return template, response


def _credentials(
    errors: _Errors, credentials: list[CredentialIn]
) -> list[tuple[str, CredentialType, str]]:
    """API key in a named header, a bearer token, custom headers, or none (Screen 18)."""
    kinds = {c.credential_type for c in credentials}
    if len(kinds) > 1 or (
        kinds & {CredentialType.API_KEY, CredentialType.BEARER_TOKEN} and len(credentials) > 1
    ):
        errors.add("credentials", ONE_WAY)
        return []
    if len(credentials) > MAX_CREDENTIALS:
        errors.add("credentials", TOO_MANY)
        return []

    result, seen = [], set()
    for i, credential in enumerate(credentials):
        name = credential.name.strip()
        value = credential.value.strip()
        if credential.credential_type == CredentialType.BEARER_TOKEN:
            name = "Authorization"
            value = re.sub(r"(?i)^bearer\s+", "", value)  # "Bearer " is added when it is sent
        elif not _HEADER.fullmatch(name):
            errors.add(f"credentials.{i}.name", HEADER_NAME)
        elif name.lower() in _RESERVED:
            errors.add(f"credentials.{i}.name", HEADER_RESERVED)
        elif name.lower() in seen:
            errors.add(f"credentials.{i}.name", HEADER_TWICE)
        seen.add(name.lower())
        if not value:
            errors.add(f"credentials.{i}.value", VALUE_REQUIRED)
        elif any(ch in value for ch in "\r\n\0"):  # would let a value add its own headers
            errors.add(f"credentials.{i}.value", VALUE_LINE_BREAK)
        elif len(value) > 4096:
            errors.add(f"credentials.{i}.value", VALUE_TOO_LONG)
        result.append((name, credential.credential_type, value))
    return result
