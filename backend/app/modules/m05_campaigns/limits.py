"""An organization's monthly usage and cost limits (FR-5.7, FR-10.4, UC-10.6): checked when a run
is launched (UC-5.3 step 3) and again before every attempt, so a running run stops at the limit
(UC-10.6 step 6), and warned about before it is reached (step 5).

A Platform Administrator sets an organization's limits on Screen 61 (FR-10.4). Until one does, the
organization has the platform's defaults from the settings (UC-10.6, 1a1): the columns on
`organizations` are NULL, and `limits_for()` falls back to `defaults()`.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.models import Organization
from app.llm.usage import cost_this_month
from app.modules.m05_campaigns.models import Attempt, CampaignRun, EndReason, UsageLimitWarning

# What each limit is called on Screen 61 and in a warning.
KIND_LABELS = {
    "campaign_runs": "campaign runs",
    "attempts": "attempts",
    "llm_cost": "LLM cost",
}


@dataclass(frozen=True)
class Limits:
    campaign_runs: int
    attempts: int
    llm_cost_usd: Decimal
    warn_percent: int = 80  # the share of a limit at which the organization is warned


@dataclass(frozen=True)
class Usage:
    campaign_runs: int
    attempts: int
    llm_cost_usd: Decimal


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return now.astimezone(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def next_month_label(now: datetime | None = None) -> str:
    start = month_start(now)
    following = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return f"{following.day} {following:%B}"


def defaults() -> Limits:
    """The platform's defaults, which every organization has until one is set for it (1a1)."""
    settings = get_settings()
    return Limits(
        campaign_runs=settings.default_monthly_campaign_runs,
        attempts=settings.default_monthly_attempts,
        llm_cost_usd=Decimal(str(settings.default_monthly_llm_cost_usd)),
        warn_percent=settings.default_usage_warn_percent,
    )


def limits_for(db: Session, organization_id: uuid.UUID) -> Limits:
    """The limits in force for an organization: its own where a Platform Administrator set one,
    the platform's default for every limit still unset."""
    row = db.execute(
        select(
            Organization.limit_campaign_runs,
            Organization.limit_attempts,
            Organization.limit_llm_cost_usd,
            Organization.limit_warn_percent,
        ).where(Organization.id == organization_id)
    ).first()
    return of(*row) if row else defaults()


def of(
    campaign_runs: int | None,
    attempts: int | None,
    llm_cost_usd: Decimal | None,
    warn_percent: int | None,
) -> Limits:
    """The four stored values with the platform's default for each one that is None."""
    default = defaults()
    return Limits(
        campaign_runs=default.campaign_runs if campaign_runs is None else campaign_runs,
        attempts=default.attempts if attempts is None else attempts,
        llm_cost_usd=default.llm_cost_usd if llm_cost_usd is None else llm_cost_usd,
        warn_percent=default.warn_percent if warn_percent is None else warn_percent,
    )


def usage(db: Session, organization_id: uuid.UUID) -> Usage:
    """This month's campaign runs, attempts sent and LLM cost. The counts are bounded by the
    limits themselves, so they stay quick (NFR-6.2)."""
    start = month_start()
    runs = db.scalar(
        select(func.count()).where(
            CampaignRun.organization_id == organization_id,
            CampaignRun.created_at >= start,
            # a launch whose start job couldn't be queued doesn't count
            CampaignRun.end_reason.is_distinct_from(EndReason.QUEUE_UNAVAILABLE),
        )
    )
    attempts = db.scalar(
        select(func.count()).where(
            Attempt.organization_id == organization_id, Attempt.sent_at >= start
        )
    )
    return Usage(runs or 0, attempts or 0, cost_this_month(db, organization_id))


def share(used: int | Decimal, limit: int | Decimal) -> int:
    """How much of a limit is used, as a whole percentage; 100 when the limit is 0."""
    if limit <= 0:
        return 100
    return int(Decimal(used) / Decimal(limit) * 100)


def shares(limits: Limits, used: Usage) -> dict[str, int]:
    return {
        "campaign_runs": share(used.campaign_runs, limits.campaign_runs),
        "attempts": share(used.attempts, limits.attempts),
        "llm_cost": share(used.llm_cost_usd, limits.llm_cost_usd),
    }


def watch(db: Session, organization_id: uuid.UUID, limits: Limits, used: Usage) -> list[str]:
    """UC-10.6 step 5: the first time this month's usage reaches the warning threshold of a limit,
    the Organization Administrators and the Security Managers are told, so they can plan the work
    that is left. Each limit warns once a month: the row in `usage_limit_warnings` is what decides,
    so two workers crossing the threshold together still send one warning. The caller commits its
    own work first; this commits the warnings.

    Returns the kinds it warned about, which is nothing at all on almost every call.
    """
    from app.modules.m05_campaigns.lifecycle import notify_usage_warning

    month, sent = month_start(), []
    for kind, percent in shares(limits, used).items():
        if percent < limits.warn_percent or percent >= 100:
            continue  # below the threshold, or already reached: UC-5.3, 3a1 speaks then
        marker = insert(UsageLimitWarning).values(
            organization_id=organization_id, month=month, kind=kind, used_percent=percent
        )
        # The row that comes back is the proof that this call is the one that warns; a call that
        # conflicts with an earlier warning gets nothing back and says nothing.
        written = db.execute(
            marker.on_conflict_do_nothing(
                index_elements=["organization_id", "month", "kind"]
            ).returning(UsageLimitWarning.id)
        ).scalar()
        if written is not None:
            sent.append(kind)
    if not sent:
        return []
    db.commit()
    for kind in sent:
        notify_usage_warning(db, organization_id, kind, limits, used)
    return sent


def reached(limits: Limits, used: Usage, *, launching: bool) -> tuple[str, str] | None:
    """The limit that is reached, as (kind, sentence); None while there is room. A launch also
    needs room for one more campaign run."""
    when = f"It starts again on {next_month_label()}, or a Platform Administrator can raise it."
    if launching and used.campaign_runs >= limits.campaign_runs:
        return "campaign_runs", (
            f"The monthly limit of {limits.campaign_runs:,} campaign runs is reached. {when}"
        )
    if used.attempts >= limits.attempts:
        return "attempts", f"The monthly limit of {limits.attempts:,} attempts is reached. {when}"
    if used.llm_cost_usd >= limits.llm_cost_usd:
        return "llm_cost", (
            f"The monthly LLM cost limit of ${limits.llm_cost_usd:,.2f} is reached. {when}"
        )
    return None
