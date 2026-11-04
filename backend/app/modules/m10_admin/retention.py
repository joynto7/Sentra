"""Data retention (FR-10.5): how long an organization keeps its evidence, campaign data and
reports (UC-10.7), and the daily clean-up that carries those periods out (UC-10.8).

The preview Screen 60 shows and the clean-up itself are **one** function, asked to count instead
of to delete (`dry_run`). Two functions could drift, and the screen would then promise something
the job does not do — which is the one thing a page about deleting data may never do.

What goes and what stays (UC-10.8 step 4): evidence rows with their objects, and the attempts of
ended campaign runs with the detection results and verdicts that hang off them. The findings
themselves, their summaries, the risk-score history and the campaign runs with their counts stay,
so the trends of Module 7 survive a clean-up. The audit log is not covered by any period at all
and is kept for at least a year (NFR-8.3).
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.core import audit, storage
from app.core.email import send_email
from app.core.errors import FieldValidationError
from app.core.models import Organization
from app.modules.m01_users.members import WRONG_PASSWORD
from app.modules.m01_users.models import Membership, User
from app.modules.m01_users.security import verify_password
from app.modules.m05_campaigns.models import ACTIVE, ENDED, Attempt, CampaignRun
from app.modules.m06_findings.models import OPEN, Evidence, Finding
from app.modules.m09_reporting.models import Report
from app.modules.m10_admin.models import RetentionRun, RetentionSettings

# The periods an organization starts with, in days, and the range the platform allows (Screen 60
# names 30-1,095 days for evidence). A longer period than the maximum would keep personal data in
# evidence longer than any organization can justify (NFR-8.2); a shorter one than the minimum
# would delete the evidence of a finding before anybody could act on it.
DEFAULTS = {"evidence_days": 180, "campaign_days": 365, "report_days": 730}
LIMITS = {"evidence_days": (30, 1095), "campaign_days": (30, 1095), "report_days": (30, 3650)}
LABELS = {"evidence_days": "Evidence", "campaign_days": "Campaign data", "report_days": "Reports"}

# When the daily clean-up runs: a time of low load, so that it never delays a campaign run
# (UC-10.8, quality requirement 1). It is the moment Sentra's clock really keeps — Celery beat
# places `scheduler.daily` at 01:00 UTC (celery_app.py, FR-5.3) — and Screen 60 says it in those
# words, because a page about deleting data may not promise an hour at which nothing happens.
CLEAN_UP_AT = "01:00 UTC"

# NFR-8.3: the audit log is not covered by any of the three periods and is kept for at least a
# year. Screen 60 says so, because it is the one thing a clean-up never touches.
AUDIT_LOG_DAYS = 365

# 3a1: after three clean-ups in a row that could not delete an object, the Platform
# Administrators are told, because by then it is the storage and not the data that is the problem.
FAILURES_BEFORE_ALERT = 3

# The marker the clean-up sets on its own transaction. The evidence table refuses every UPDATE and
# every DELETE (NFR-2.4, FR-6.3); with this setting a DELETE passes, so that the one legitimate
# deletion of evidence — its period has ended — can happen and nothing else can.
MARKER = "sentra.retention"


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Periods:
    """The three periods of UC-10.7 step 2, in days."""

    evidence_days: int
    campaign_days: int
    report_days: int

    def as_dict(self) -> dict[str, int]:
        return {
            "evidence_days": self.evidence_days,
            "campaign_days": self.campaign_days,
            "report_days": self.report_days,
        }


@dataclass
class Amount:
    """How much of one kind of data the organization stores (UC-10.7 step 1)."""

    items: int = 0
    bytes: int = 0


@dataclass
class Outcome:
    """What a clean-up did, or what it would do when it only counted (step 4 of UC-10.7)."""

    evidence: Amount = field(default_factory=Amount)
    attempts: Amount = field(default_factory=Amount)
    reports: Amount = field(default_factory=Amount)
    postponed: int = 0
    failures: int = 0
    failed_keys: list[str] = field(default_factory=list)
    # 4a: the open findings whose evidence this clean-up would delete. Their summaries stay.
    open_findings: list[str] = field(default_factory=list)

    @property
    def deleted(self) -> int:
        return self.evidence.items + self.attempts.items + self.reports.items


# ---------------------------------------------------------------- the periods (UC-10.7)


def row_of(db: Session, organization_id: uuid.UUID) -> RetentionSettings | None:
    return db.scalar(
        select(RetentionSettings).where(RetentionSettings.organization_id == organization_id)
    )


def periods_of(db: Session, organization_id: uuid.UUID) -> Periods:
    """The organization's periods, or the platform's defaults when it has never set them."""
    row = row_of(db, organization_id)
    if row is None:
        return Periods(**DEFAULTS)
    return Periods(row.evidence_days, row.campaign_days, row.report_days)


def check(periods: Periods) -> None:
    """3a: a period outside the allowed range is refused at its own field, with the range in the
    message, so the page can show it where the number was typed (3a1)."""
    for name, value in periods.as_dict().items():
        low, high = LIMITS[name]
        if not low <= value <= high:
            raise FieldValidationError(
                name,
                f"{LABELS[name]} must be kept between {low} and {high:,} days.",
            )


def save(
    db: Session,
    *,
    admin: Membership,
    admin_user: User,
    periods: Periods,
    password: str,
) -> RetentionSettings:
    """UC-10.7 steps 3-6: the periods are checked, confirmed with the password (NFR-3.5), saved
    and recorded. Nothing is deleted here — the next daily clean-up does that (step 6), so a
    mistaken change can still be corrected."""
    if not verify_password(admin_user.password_hash, password):
        raise FieldValidationError("password", WRONG_PASSWORD)
    check(periods)
    row = row_of(db, admin.organization_id)
    before = periods_of(db, admin.organization_id).as_dict()
    if row is None:
        row = RetentionSettings(organization_id=admin.organization_id, **periods.as_dict())
        db.add(row)
    else:
        row.evidence_days = periods.evidence_days
        row.campaign_days = periods.campaign_days
        row.report_days = periods.report_days
    row.updated_by_id = admin_user.id
    row.updated_at = _now()
    db.flush()
    organization = db.get_one(Organization, admin.organization_id)
    audit.record(
        db,
        organization_id=organization.id,
        actor=admin_user,
        action="retention.changed",
        summary=(
            "Set the retention periods to "
            f"{periods.evidence_days} days for evidence, {periods.campaign_days} for campaign "
            f"data and {periods.report_days} for reports"
        ),
        item=audit.Item("organization", organization.id, organization.name),
        details={"before": before, "after": periods.as_dict()},
    )
    db.commit()
    db.refresh(row)
    return row


# ---------------------------------------------------------------- how much is stored (step 1)


def stored(db: Session, organization_id: uuid.UUID) -> dict[str, Amount]:
    """The amount of each kind of data the organization has now. Evidence and reports know their
    own size; campaign data is measured as the bytes its attempts carry — the message that was
    sent, the reply and the tool calls — because that is what a clean-up frees."""
    evidence = db.execute(
        select(func.count(Evidence.id), func.coalesce(func.sum(Evidence.size), 0)).where(
            Evidence.organization_id == organization_id
        )
    ).one()
    attempt_bytes = (
        func.coalesce(func.octet_length(Attempt.input), 0)
        + func.coalesce(func.octet_length(Attempt.reply), 0)
        + func.coalesce(func.octet_length(Attempt.tool_calls), 0)
    )
    attempts = db.execute(
        select(func.count(Attempt.id), func.coalesce(func.sum(attempt_bytes), 0)).where(
            Attempt.organization_id == organization_id
        )
    ).one()
    reports = db.execute(
        select(func.count(Report.id), func.coalesce(func.sum(Report.size_bytes), 0)).where(
            Report.organization_id == organization_id
        )
    ).one()
    return {
        "evidence": Amount(int(evidence[0]), int(evidence[1])),
        "campaign": Amount(int(attempts[0]), int(attempts[1])),
        "reports": Amount(int(reports[0]), int(reports[1])),
    }


def last_run(db: Session, organization_id: uuid.UUID) -> RetentionRun | None:
    """Step 6: the date and result of the last clean-up, for the card of Screen 60."""
    return db.scalars(
        select(RetentionRun)
        .where(RetentionRun.organization_id == organization_id)
        .order_by(RetentionRun.started_at.desc())
        .limit(1)
    ).first()


# ---------------------------------------------------------------- the clean-up (UC-10.8)


def _before(at: datetime, days: int) -> datetime:
    return at - timedelta(days=days)


def _active_run_ids(db: Session, organization_id: uuid.UUID) -> set[uuid.UUID]:
    """2a: a run that is still going on keeps its data until the next clean-up."""
    return set(
        db.scalars(
            select(CampaignRun.id).where(
                CampaignRun.organization_id == organization_id,
                CampaignRun.status.in_(ACTIVE),
            )
        ).all()
    )


def _expired_evidence(
    db: Session, organization_id: uuid.UUID, at: datetime, days: int
) -> list[Evidence]:
    return list(
        db.scalars(
            select(Evidence)
            .where(
                Evidence.organization_id == organization_id,
                Evidence.recorded_at < _before(at, days),
            )
            .order_by(Evidence.recorded_at)
        ).all()
    )


def _ended_runs(organization_id: uuid.UUID, at: datetime, days: int):
    """The campaign runs whose data has expired: ended, and ended longer ago than the period. A
    run that is still going on keeps everything it has (2a)."""
    return select(CampaignRun.id).where(
        CampaignRun.organization_id == organization_id,
        CampaignRun.status.in_(ENDED),
        func.coalesce(CampaignRun.ended_at, CampaignRun.created_at) < _before(at, days),
    )


def _expired_attempts(organization_id: uuid.UUID, at: datetime, days: int):
    """The attempts of those runs, as a query: a year of attempts is more than a list of ids can
    carry into the next statement. The run decides, not the attempt, so a run's data goes as a
    whole and never half of it."""
    return select(Attempt.id).where(
        Attempt.organization_id == organization_id,
        Attempt.campaign_run_id.in_(_ended_runs(organization_id, at, days)),
    )


def _still_proven(db: Session, expired, deleted_now: set[uuid.UUID] | None) -> set[uuid.UUID]:
    """The expired attempts that evidence still points at. `evidence.attempt_id` is RESTRICT, so
    they wait for the clean-up that takes their evidence as well. Before anything is deleted the
    evidence of this very run is left out of the question; afterwards it is simply gone."""
    conditions = [Evidence.attempt_id.in_(expired)]
    if deleted_now:
        conditions.append(Evidence.id.not_in(deleted_now))
    return set(db.scalars(select(Evidence.attempt_id).where(*conditions)).all())


def _expired_reports(
    db: Session, organization_id: uuid.UUID, at: datetime, days: int
) -> list[Report]:
    return list(
        db.scalars(
            select(Report).where(
                Report.organization_id == organization_id,
                Report.created_at < _before(at, days),
            )
        ).all()
    )


def _open_findings_of(db: Session, evidence: list[Evidence]) -> list[str]:
    """4a: the open findings whose evidence would go. Their summaries are kept (UC-6.5), which is
    what the page has to say before anybody confirms."""
    ids = {one.finding_id for one in evidence}
    if not ids:
        return []
    rows = db.scalars(
        select(Finding)
        .where(Finding.id.in_(ids), Finding.status.in_(OPEN))
        .order_by(Finding.number)
    ).all()
    return [one.code for one in rows]


def clean_up(
    db: Session,
    organization_id: uuid.UUID,
    *,
    at: datetime | None = None,
    periods: Periods | None = None,
    dry_run: bool = False,
) -> Outcome:
    """One organization's clean-up, or — with `dry_run` — exactly what it would delete.

    `periods` is given only by the preview of Screen 60, which asks about periods that have not
    been saved yet; the job always uses the organization's own.
    """
    at = at or _now()
    periods = periods or periods_of(db, organization_id)
    outcome = Outcome()

    active = _active_run_ids(db, organization_id)
    evidence = _expired_evidence(db, organization_id, at, periods.evidence_days)
    keep = [one for one in evidence if one.campaign_run_id in active]
    evidence = [one for one in evidence if one.campaign_run_id not in active]
    outcome.postponed += len(keep)
    outcome.open_findings = _open_findings_of(db, evidence)

    expired = _expired_attempts(organization_id, at, periods.campaign_days)
    total = db.scalar(select(func.count()).select_from(expired.subquery())) or 0
    reports = _expired_reports(db, organization_id, at, periods.report_days)
    outcome.evidence = Amount(len(evidence), sum(one.size for one in evidence))
    outcome.reports = Amount(len(reports), sum(one.size_bytes or 0 for one in reports))

    if dry_run:
        waiting = _still_proven(db, expired, {one.id for one in evidence})
        outcome.postponed += len(waiting)
        outcome.attempts = Amount(total - len(waiting), 0)
        return outcome

    run = RetentionRun(organization_id=organization_id, started_at=at, **periods.as_dict())
    db.add(run)
    # The one transaction in which evidence may be deleted (FR-6.3 keeps it read-only otherwise).
    db.execute(text(f"SET LOCAL {MARKER} = 'on'"))

    for one in evidence:
        if one.content_ref and not _removed(one.content_ref, outcome):
            outcome.postponed += 1
            outcome.evidence.items -= 1
            outcome.evidence.bytes -= one.size
            continue
        db.delete(one)
    db.flush()

    # Asked again now that the evidence is really gone: an object the storage refused to delete
    # keeps its row, and that row still holds its attempt back.
    waiting = _still_proven(db, expired, None)
    outcome.postponed += len(waiting)
    outcome.attempts = Amount(total - len(waiting), 0)
    if outcome.attempts.items:
        conditions = [
            Attempt.organization_id == organization_id,
            Attempt.campaign_run_id.in_(_ended_runs(organization_id, at, periods.campaign_days)),
        ]
        if waiting:
            conditions.append(Attempt.id.not_in(waiting))
        db.execute(delete(Attempt).where(*conditions))
    for one in reports:
        if one.object_key and not _removed(one.object_key, outcome):
            outcome.postponed += 1
            outcome.reports.items -= 1
            outcome.reports.bytes -= one.size_bytes or 0
            continue
        db.delete(one)

    run.finished_at = _now()
    run.evidence_deleted = outcome.evidence.items
    run.evidence_bytes = outcome.evidence.bytes
    run.attempts_deleted = outcome.attempts.items
    run.reports_deleted = outcome.reports.items
    run.postponed = outcome.postponed
    run.failures = outcome.failures
    run.failed_keys = outcome.failed_keys
    _record(db, organization_id, periods, outcome)
    db.flush()
    stuck = _stuck_keys(db, organization_id, outcome.failed_keys)
    db.commit()
    if stuck:  # 3a1, after the clean-up's own work is safely stored
        _tell_platform_admins(db, organization_id, stuck)
    return outcome


def _removed(key: str, outcome: Outcome) -> bool:
    """3a: the object storage would not delete this object. The row stays, so the next clean-up
    finds it again and tries once more."""
    try:
        storage.delete(key)
    except Exception:
        outcome.failures += 1
        outcome.failed_keys.append(key)
        return False
    return True


def _stuck_keys(db: Session, organization_id: uuid.UUID, keys: list[str]) -> list[str]:
    """3a1: the objects that the last clean-ups in a row all failed to delete. By then it is the
    storage and not the data that needs attention."""
    if not keys:
        return []
    recent = db.scalars(
        select(RetentionRun)
        .where(RetentionRun.organization_id == organization_id)
        .order_by(RetentionRun.started_at.desc())
        .limit(FAILURES_BEFORE_ALERT)
    ).all()
    if len(recent) < FAILURES_BEFORE_ALERT:
        return []
    stuck = set(keys)
    for run in recent:
        stuck &= set(run.failed_keys or [])
    return sorted(stuck)


def _tell_platform_admins(db: Session, organization_id: uuid.UUID, stuck: list[str]) -> None:
    """3a1: the Platform Administrators are told, with how many objects are stuck and in which
    organization — never with anything the objects contain."""
    organization = db.get(Organization, organization_id)
    name = organization.name if organization else "an organization"
    for admin in db.scalars(select(User).where(User.platform_admin.is_(True))):
        send_email(
            admin.email,
            f"Sentra: the retention clean-up of {name} cannot delete {len(stuck)} object(s)",
            f"Hello {admin.name},\n\nThe daily retention clean-up of {name} has failed to delete "
            f"{len(stuck)} object(s) from the object storage in {FAILURES_BEFORE_ALERT} runs in a "
            "row. Their database rows are kept and tried again, so no data is lost, but the "
            "storage needs attention.\n",
        )


def _record(db: Session, organization_id: uuid.UUID, periods: Periods, outcome: Outcome) -> None:
    """Step 5: every deletion is in the audit log with the kind of data, the number of items and
    the period — and never with the deleted content itself."""
    if outcome.deleted == 0 and outcome.failures == 0:
        return
    audit.record(
        db,
        organization_id=organization_id,
        action="retention.deleted",
        summary=(
            f"Retention clean-up deleted {outcome.evidence.items} evidence item(s), "
            f"{outcome.attempts.items} attempt(s) and {outcome.reports.items} report(s)"
        ),
        details={
            "periods": periods.as_dict(),
            "evidence": {"items": outcome.evidence.items, "bytes": outcome.evidence.bytes},
            "campaign_data": {"attempts": outcome.attempts.items},
            "reports": {"items": outcome.reports.items, "bytes": outcome.reports.bytes},
            "postponed": outcome.postponed,
            "failures": outcome.failures,
        },
        source_address=None,
    )


def run_all(db: Session, at: datetime | None = None) -> list[Outcome]:
    """The daily job (UC-10.8 step 1): every organization, each in its own transaction, so one
    organization's failure never stops another's clean-up."""
    at = at or _now()
    # Read the ids first: each clean-up commits, and a committed transaction leaves no cursor to
    # go on reading from.
    ids = list(db.scalars(select(Organization.id).order_by(Organization.created_at)).all())
    return [clean_up(db, organization_id, at=at) for organization_id in ids]
