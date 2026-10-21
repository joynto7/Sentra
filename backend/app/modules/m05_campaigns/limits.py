"""An organization's monthly usage and cost limits (FR-5.7, FR-10.4, UC-10.6): checked when a run
is launched (UC-5.3 step 3) and again before every attempt, so a running run stops at the limit
(UC-10.6 step 6).

Until FR-10.4 lets Platform Administrators set each organization's limits, every organization has
the platform's default limits from the settings (UC-10.6, 1a). limits_for() is the one place that
will read an organization's own limits then.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.llm.usage import cost_this_month
from app.modules.m05_campaigns.models import Attempt, CampaignRun


@dataclass(frozen=True)
class Limits:
    campaign_runs: int
    attempts: int
    llm_cost_usd: Decimal


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
    following = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(
        month=start.month + 1
    )
    return f"{following.day} {following:%B}"


def limits_for(db: Session, organization_id: uuid.UUID) -> Limits:
    settings = get_settings()
    return Limits(
        campaign_runs=settings.default_monthly_campaign_runs,
        attempts=settings.default_monthly_attempts,
        llm_cost_usd=Decimal(str(settings.default_monthly_llm_cost_usd)),
    )


def usage(db: Session, organization_id: uuid.UUID) -> Usage:
    """This month's campaign runs, attempts sent and LLM cost. The counts are bounded by the
    limits themselves, so they stay quick (NFR-6.2)."""
    start = month_start()
    runs = db.scalar(
        select(func.count()).where(
            CampaignRun.organization_id == organization_id, CampaignRun.created_at >= start
        )
    )
    attempts = db.scalar(
        select(func.count()).where(
            Attempt.organization_id == organization_id, Attempt.sent_at >= start
        )
    )
    return Usage(runs or 0, attempts or 0, cost_this_month(db, organization_id))


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
