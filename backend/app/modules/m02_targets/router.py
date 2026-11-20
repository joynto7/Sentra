import uuid
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import ConflictError
from app.modules.m01_users.deps import current_membership
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.permissions import Action, require
from app.modules.m02_targets import canaries, connection, formats, profile, service, verification
from app.modules.m02_targets.models import (
    ConnectionTest,
    OwnershipVerification,
    Target,
    TargetCanary,
    TargetStatus,
)
from app.modules.m02_targets.schemas import (
    CanaryIn,
    CanaryOut,
    ConnectionSummary,
    ConnectionTestOut,
    CredentialOut,
    CredentialsIn,
    DnsInstructions,
    EndpointCheckIn,
    EndpointCheckOut,
    FileInstructions,
    OwnerOut,
    OwnershipCheckIn,
    OwnershipCheckOut,
    ProfileEntryOut,
    ProfileKnowledgeOut,
    ProfileOut,
    ProfileToolOut,
    TargetIn,
    TargetListOut,
    TargetOut,
    TargetPatch,
    VerificationOut,
)

router = APIRouter(prefix="/targets", tags=["M2 Target Management"])

# Every member may read the organization's targets; registering and changing them needs a role
# that may manage targets (FR-1.6: the AI Application Developer, UC-2.1 and UC-2.5).
can_manage = require(Action.MANAGE_TARGETS)
can_verify = require(Action.VERIFY_TARGETS)
can_test = require(Action.TEST_TARGET_CONNECTIONS)
can_map = require(Action.MAP_TARGET_PROFILES)


def targets_out(db: Session, targets: list[Target]) -> list[TargetOut]:
    """The targets with their owners, verification, last connection test and profile status."""
    ids = [t.id for t in targets]
    people = service.owner_names(db, targets) | _names(db, [t.verified_by_id for t in targets])
    tests = connection.latest_of(db, ids)
    profiles = profile.status_of(db, ids)
    return [target_out(t, people, tests.get(t.id), profiles.get(t.id)) for t in targets]


def target_out(
    target: Target,
    owners: dict[uuid.UUID, str],
    last_test: ConnectionTest | None = None,
    profile_status: str | None = None,
) -> TargetOut:
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
        is_lab=verification.is_lab(target),
        verified_at=target.verified_at,
        verified_by=OwnerOut(id=target.verified_by_id, name=owners[target.verified_by_id])
        if target.verified_by_id in owners
        else None,
        verification_method=target.verification_method,
        last_connection_test=ConnectionSummary(
            status=last_test.status,
            finished_at=last_test.finished_at,
            status_code=last_test.status_code,
            duration_ms=last_test.duration_ms,
        )
        if last_test is not None
        else None,
        profile_status=profile_status,
    )


def _names(db: Session, ids: list[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


def _one(db: Session, target: Target) -> TargetOut:
    return targets_out(db, [target])[0]


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
    return TargetListOut(
        items=targets_out(db, items),
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
    return _one(db, target)


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
    return _one(db, target)


@router.patch("/{target_id}")
def update_target(
    target_id: uuid.UUID,
    data: TargetPatch,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> TargetOut:
    """UC-2.5 Update Target Configuration."""
    target = service.update(db, membership, target_id, data)
    return _one(db, target)


@router.put("/{target_id}/credentials")
def replace_credentials(
    target_id: uuid.UUID,
    data: CredentialsIn,
    membership: Membership = Depends(can_manage),
    db: Session = Depends(get_db),
) -> TargetOut:
    """UC-2.5: new credentials replace the stored ones, which are deleted."""
    target = service.replace_credentials(db, membership, target_id, data.credentials)
    return _one(db, target)


# ---------------------------------------------------------------- connection test (FR-2.4)


def connection_out(test: ConnectionTest) -> ConnectionTestOut:
    return ConnectionTestOut.model_validate(test)


@router.post("/{target_id}/connection-tests", status_code=status.HTTP_202_ACCEPTED)
def test_connection(
    target_id: uuid.UUID, membership: Membership = Depends(can_test), db: Session = Depends(get_db)
) -> ConnectionTestOut:
    """UC-2.2 Test Target Connection: one harmless request, sent by a worker. The page follows
    the test until its status is no longer "running"."""
    target = service.get_target(db, membership.organization_id, target_id)
    return connection_out(connection.start(db, target, membership.user_id))


@router.get("/{target_id}/connection-tests")
def list_connection_tests(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> list[ConnectionTestOut]:
    """The latest connection tests, newest first (UC-2.2 step 5)."""
    target = service.get_target(db, membership.organization_id, target_id)
    return [connection_out(t) for t in connection.recent(db, target.id)]


@router.get("/{target_id}/connection-tests/{test_id}")
def get_connection_test(
    target_id: uuid.UUID,
    test_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> ConnectionTestOut:
    target = service.get_target(db, membership.organization_id, target_id)
    return connection_out(connection.get(db, target, test_id))


# ---------------------------------------------------------------- ownership (FR-2.3)


def check_out(check: OwnershipVerification, names: dict[uuid.UUID, str]) -> OwnershipCheckOut:
    out = OwnershipCheckOut.model_validate(check)
    out.checked_by = names.get(check.checked_by_id) if check.checked_by_id else None
    return out


@router.get("/{target_id}/verification")
def get_verification(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> VerificationOut:
    """Screen 19's ownership card: the token, the two methods and the latest checks (UC-2.3 step
    1). The token isn't a secret: it is published on the target's own domain."""
    target = service.get_target(db, membership.organization_id, target_id)
    checks = verification.recent(db, target.id)
    names = _names(db, [c.checked_by_id for c in checks] + [target.verified_by_id])
    ip_endpoint = verification.is_ip_address(target)
    return VerificationOut(
        status=target.status,
        token=target.verification_token,
        is_lab=verification.is_lab(target),
        ip_endpoint=ip_endpoint,
        dns=None
        if ip_endpoint
        else DnsInstructions(
            name=verification.dns_name(target), value=verification.txt_value(target)
        ),
        file=FileInstructions(url=verification.file_url(target), content=target.verification_token),
        verified_at=target.verified_at,
        verified_by=names.get(target.verified_by_id) if target.verified_by_id else None,
        method=target.verification_method,
        recent_checks=[check_out(c, names) for c in checks],
    )


@router.post("/{target_id}/verification/checks", status_code=status.HTTP_202_ACCEPTED)
def check_ownership(
    target_id: uuid.UUID,
    data: OwnershipCheckIn,
    membership: Membership = Depends(can_verify),
    db: Session = Depends(get_db),
) -> OwnershipCheckOut:
    """UC-2.3 step 3, "Check now". A worker fetches the token; the page follows the check. Only a
    successful check verifies a target: no endpoint sets the status directly (NFR-8.1)."""
    target = service.get_target(db, membership.organization_id, target_id)
    user = db.get_one(User, membership.user_id)
    check = verification.start(db, target, user, data.method)
    return check_out(check, {user.id: user.name})


@router.get("/{target_id}/verification/checks/{check_id}")
def get_ownership_check(
    target_id: uuid.UUID,
    check_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> OwnershipCheckOut:
    target = service.get_target(db, membership.organization_id, target_id)
    check = verification.get(db, target, check_id)
    return check_out(check, _names(db, [check.checked_by_id]))


# ---------------------------------------------------------------- profile (FR-2.5)


def canary_out(canary: TargetCanary) -> CanaryOut:
    slot = canaries.BY_KEY[canary.slot]
    return CanaryOut(
        slot=canary.slot,
        label=slot.label,
        where=slot.where,
        token=canary.token,
        topic=canary.topic,
        topic_label=slot.topic_label,
        source=canary.source,
        planted=canary.planted_at is not None,
        planted_at=canary.planted_at,
    )


def profile_out(db: Session, target: Target) -> ProfileOut:
    found = profile.find(db, target.id)
    order = {slot.key: i for i, slot in enumerate(canaries.SLOTS)}
    tokens = sorted(
        (c for c in canaries.current(db, target.id) if c.slot in order),
        key=lambda c: order[c.slot],
    )
    if found is None:  # not mapped yet: it is mapped after the verification (UC-2.3 step 6)
        return ProfileOut(
            status="not_mapped",
            version=0,
            mapped_at=None,
            discovery_requests=0,
            stop_reason=None,
            entries=[],
            tools=[],
            knowledge_sources=[],
            reviewed_at=None,
            reviewed_by=None,
            canaries=[canary_out(c) for c in tokens],
        )
    entries = found.entries or {}
    reviewer = _names(db, [found.reviewed_by_id])
    return ProfileOut(
        status=found.status,
        version=found.version,
        mapped_at=found.mapped_at,
        discovery_requests=found.discovery_requests,
        stop_reason=found.stop_reason,
        entries=[
            ProfileEntryOut(
                key=key,
                label=label,
                value=entries.get(key, {}).get("value", ""),
                source=entries.get(key, {}).get("source", profile.UNKNOWN),
                note=entries.get(key, {}).get("note", ""),
            )
            for key, label in profile.LABELS.items()
        ],
        tools=[ProfileToolOut(**t) for t in found.tools or []],
        knowledge_sources=[ProfileKnowledgeOut(**k) for k in found.knowledge_sources or []],
        reviewed_at=found.reviewed_at,
        reviewed_by=reviewer.get(found.reviewed_by_id) if found.reviewed_by_id else None,
        canaries=[canary_out(c) for c in tokens],
    )


@router.get("/{target_id}/profile")
def get_profile(
    target_id: uuid.UUID,
    membership: Membership = Depends(current_membership),
    db: Session = Depends(get_db),
) -> ProfileOut:
    """The Target Profile page (Screen 21)."""
    target = service.get_target(db, membership.organization_id, target_id)
    return profile_out(db, target)


@router.post("/{target_id}/profile/mapping", status_code=status.HTTP_202_ACCEPTED)
def map_profile(
    target_id: uuid.UUID, membership: Membership = Depends(can_map), db: Session = Depends(get_db)
) -> ProfileOut:
    """UC-2.4 "Update profile": a worker maps the target again. Entries added by hand stay."""
    target = service.get_target(db, membership.organization_id, target_id)
    if target.status == TargetStatus.ARCHIVED:
        raise ConflictError(service.ARCHIVED, code="target_archived")
    profile.start_mapping(db, target, requested_by=membership.user_id)
    return profile_out(db, target)


@router.put("/{target_id}/profile")
def save_profile(
    target_id: uuid.UUID,
    data: profile.ProfileIn,
    membership: Membership = Depends(can_map),
    db: Session = Depends(get_db),
) -> ProfileOut:
    """UC-2.4 steps 5-6: the reviewed profile. Changed and added entries become "added
    manually"."""
    target = service.get_target(db, membership.organization_id, target_id)
    if target.status == TargetStatus.ARCHIVED:
        raise ConflictError(service.ARCHIVED, code="target_archived")
    profile.save(db, target, db.get_one(User, membership.user_id), data)
    return profile_out(db, target)


@router.put("/{target_id}/profile/canaries/{slot}")
def set_canary(
    target_id: uuid.UUID,
    slot: str,
    data: CanaryIn,
    membership: Membership = Depends(can_map),
    db: Session = Depends(get_db),
) -> CanaryOut:
    """The owner marks a canary token as planted, and says what to ask about to reach it."""
    target = service.get_target(db, membership.organization_id, target_id)
    if target.status == TargetStatus.ARCHIVED:
        raise ConflictError(service.ARCHIVED, code="target_archived")
    user = db.get_one(User, membership.user_id)
    return canary_out(profile.set_planted(db, target, user, slot, data.planted, data.topic))
