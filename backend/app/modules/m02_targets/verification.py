"""Ownership verification (FR-2.3, UC-2.3): before any campaign can run, the owner proves control
of the target by publishing its unique token on the endpoint's own domain, as a DNS TXT record or
as a file at a well-known URL. Sentra checks it when the owner selects "Check now" and again before
every campaign run, and records who verified the target, when and how.

No role, not even the Platform Administrator, can mark a target verified without a successful
check (NFR-8.1): nothing else sets the status to verified.

Sentra's own lab targets get their token placed by Sentra itself (report 2.3.2) and are then
checked through the well-known file like any other target.
"""

import ipaddress
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit, urlunsplit

import dns.exception
import dns.resolver
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import ConflictError, FieldValidationError, NotFoundError
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import (
    CheckStatus,
    OwnershipVerification,
    Target,
    TargetStatus,
    VerificationMethod,
)
from app.workers import jobs

TXT_PREFIX = "sentra-verification="
WELL_KNOWN_PATH = "/.well-known/sentra-verification.txt"
FOUND_LIMIT = 200  # characters of what was found that the explanation shows
STILL_RUNNING = timedelta(seconds=60)  # a running check is reused instead of starting another
ALREADY_VERIFIED = "This target is already verified."


def _now() -> datetime:
    return datetime.now(UTC)


def host(target: Target) -> str:
    return urlsplit(target.endpoint_url).hostname or ""


def is_ip_address(target: Target) -> bool:
    try:
        ipaddress.ip_address(host(target))
    except ValueError:
        return False
    return True


def is_lab(target: Target) -> bool:
    from app.workers.connector.lab import is_lab as lab_host

    return lab_host(target)


def dns_name(target: Target) -> str:
    return f"_sentra-verify.{host(target)}"


def txt_value(target: Target) -> str:
    return f"{TXT_PREFIX}{target.verification_token}"


def file_url(target: Target) -> str:
    parts = urlsplit(target.endpoint_url)
    return urlunsplit((parts.scheme, parts.netloc, WELL_KNOWN_PATH, "", ""))


def location(target: Target, method: str) -> str:
    return dns_name(target) if method == VerificationMethod.DNS_TXT_RECORD else file_url(target)


# ---------------------------------------------------------------- starting a check


def start(
    db: Session, target: Target, user: User, method: VerificationMethod
) -> OwnershipVerification:
    """UC-2.3 step 3: "Check now". The check runs on a worker, which reaches the target."""
    if target.status == TargetStatus.ARCHIVED:
        raise ConflictError("This target is archived. Restore it before verifying it.")
    if target.status == TargetStatus.VERIFIED:
        raise ConflictError(ALREADY_VERIFIED, code="already_verified")
    running = next(iter(recent(db, target.id, 1)), None)
    if (
        running is not None
        and running.status == CheckStatus.RUNNING
        and running.created_at > _now() - STILL_RUNNING
    ):
        return running
    if is_lab(target):
        method = VerificationMethod.LAB  # Sentra places the token itself
    elif method == VerificationMethod.LAB:
        raise FieldValidationError("method", "Only Sentra's own lab targets use this method.")
    elif method == VerificationMethod.DNS_TXT_RECORD and is_ip_address(target):
        raise FieldValidationError(
            "method",
            "The endpoint is an IP address, which has no DNS records. Use the well-known file.",
        )
    check = OwnershipVerification(
        target_id=target.id,
        method=method,
        trigger="check_now",
        checked_by_id=user.id,
        checked_location=location(target, method),
    )
    db.add(check)
    db.commit()
    if not jobs.start(db, "targets.check_ownership", check.id):
        check.status, check.message, check.finished_at = CheckStatus.FAILED, jobs.QUEUE_DOWN, _now()
        db.commit()
    db.refresh(check)
    return check


def get(db: Session, target: Target, check_id: uuid.UUID) -> OwnershipVerification:
    check = db.scalar(
        select(OwnershipVerification).where(
            OwnershipVerification.id == check_id, OwnershipVerification.target_id == target.id
        )
    )
    if check is None:
        raise NotFoundError("Ownership check not found.")
    return check


def recent(db: Session, target_id: uuid.UUID, limit: int = 5) -> list[OwnershipVerification]:
    return list(
        db.scalars(
            select(OwnershipVerification)
            .where(OwnershipVerification.target_id == target_id)
            .order_by(OwnershipVerification.created_at.desc(), OwnershipVerification.id)
            .limit(limit)
        )
    )


# ---------------------------------------------------------------- checking (in the worker)


@dataclass
class Outcome:
    ok: bool
    found: str | None
    message: str


def run(db: Session, check_id: uuid.UUID) -> None:
    """Steps 4-6 and 4a, 4b for a "Check now"."""
    check = db.get(OwnershipVerification, check_id)
    if check is None or check.status != CheckStatus.RUNNING:
        return
    target = db.get_one(Target, check.target_id)
    _finish(db, target, check, _check(target, check.method))


def recheck(db: Session, target: Target) -> OwnershipVerification:
    """Before every campaign run (UC-5.4 step 1, FR-2.3): the same check, at once. If the token is
    gone, the target becomes unverified and the run must not start."""
    method = target.verification_method or VerificationMethod.WELL_KNOWN_FILE
    if is_lab(target):
        method = VerificationMethod.LAB
    check = OwnershipVerification(
        target_id=target.id,
        method=method,
        trigger="campaign_run",
        checked_location=location(target, method),
    )
    db.add(check)
    db.flush()
    _finish(db, target, check, _check(target, method))
    return check


def _finish(db: Session, target: Target, check: OwnershipVerification, outcome: Outcome) -> None:
    check.status = CheckStatus.PASSED if outcome.ok else CheckStatus.FAILED
    check.found = outcome.found[:FOUND_LIMIT] if outcome.found else None
    check.message, check.finished_at = outcome.message, _now()
    checker = db.get(User, check.checked_by_id) if check.checked_by_id else None
    newly_verified = outcome.ok and target.status != TargetStatus.VERIFIED
    if newly_verified:  # step 5
        target.status = TargetStatus.VERIFIED
        target.verified_at, target.verified_by_id = check.finished_at, check.checked_by_id
        target.verification_method = check.method
        audit.record(
            db,
            organization_id=target.organization_id,
            actor=checker,
            action="target.verified",
            summary=f"Verified ownership of {target.name} ({_method_label(check.method)})",
            item=audit.Item("target", target.id, target.name),
            details={"method": check.method, "checked": check.checked_location},
            source_address=None,
        )
    elif not outcome.ok and target.status == TargetStatus.VERIFIED:
        # The token can no longer be found (lifecycle of a target, 2.3.2).
        target.status = TargetStatus.UNVERIFIED
        target.verified_at = target.verified_by_id = target.verification_method = None
        audit.record(
            db,
            organization_id=target.organization_id,
            actor=checker,
            action="target.verification_lost",
            summary=f"{target.name} became unverified: its ownership token can't be found",
            item=audit.Item("target", target.id, target.name),
            details={"method": check.method, "checked": check.checked_location},
            source_address=None,
        )
    db.commit()
    if newly_verified:  # step 6: the target profile is mapped next (UC-2.4)
        from app.modules.m02_targets import profile

        profile.start_mapping(db, target, requested_by=check.checked_by_id)


def _method_label(method: str) -> str:
    return {
        VerificationMethod.DNS_TXT_RECORD: "DNS TXT record",
        VerificationMethod.WELL_KNOWN_FILE: "well-known file",
        VerificationMethod.LAB: "lab target, token placed by Sentra",
    }.get(method, method)


def _check(target: Target, method: str) -> Outcome:
    from app.workers.connector import connector, lab
    from app.workers.connector.errors import ConnectorError

    if method == VerificationMethod.DNS_TXT_RECORD:
        return _check_dns(target)
    url = file_url(target)
    try:
        if method == VerificationMethod.LAB:
            lab.place_token(target)
        content = connector.fetch_well_known(target)
    except ConnectorError as exc:
        return Outcome(False, None, f"We couldn't fetch {url}: {exc}")
    except Exception as exc:  # e.g. the lab target refused the token
        return Outcome(False, None, f"We couldn't place the token on the lab target: {exc}")
    if content is None:
        return Outcome(
            False,
            None,
            f"We looked for the file at {url} and found nothing (HTTP 404). Publish the file with "
            "the token, then check again.",
        )
    lines = [line.strip() for line in content.splitlines()]
    if target.verification_token in lines or txt_value(target) in lines:
        return Outcome(True, None, f"Found the token in {url}.")
    return Outcome(
        False,
        " ".join(content.split())[:FOUND_LIMIT],
        f"We found the file at {url}, but it doesn't contain this target's token. Replace its "
        "content with the token, then check again.",
    )


def resolve_txt(name: str) -> list[str]:
    """The TXT records of a DNS name. The tests replace it, because they run without DNS."""
    answer = dns.resolver.resolve(name, "TXT", lifetime=5)
    return [b"".join(record.strings).decode("utf-8", errors="replace") for record in answer]


def _check_dns(target: Target) -> Outcome:
    name = dns_name(target)
    try:
        records = resolve_txt(name)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        records = []
    except (dns.exception.Timeout, dns.resolver.NoNameservers):  # 4b
        return Outcome(
            False,
            None,
            f"The DNS lookup of {name} didn't answer. If you've just added the record, check "
            "again in a few minutes; the token stays valid.",
        )
    if txt_value(target) in [r.strip() for r in records]:
        return Outcome(True, None, f"Found the token in the TXT record at {name}.")
    if not records:  # 4a, or 4b when the change hasn't spread yet
        return Outcome(
            False,
            None,
            f"We looked up the TXT record at {name} and found no Sentra token. If you've just "
            "added it, wait a few minutes and check again.",
        )
    return Outcome(
        False,
        ", ".join(records[:3]),
        f"We found TXT records at {name}, but none contains this target's token. Add a record "
        f'with the value "{txt_value(target)}", then check again.',
    )
