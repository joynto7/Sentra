"""What an organization's requests through the LLM layer used: per provider and model in the
current month (UC-10.5 step 2), the month's cost for the usage limits (FR-10.4), and the cost of
one campaign run."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.llm.models import LLMUsage

LLM_JUDGE = "llm_judge"  # the task that runs once per attempt (FR-6.1)


@dataclass
class ModelUsage:
    provider: str
    model: str
    deployment: str
    requests: int
    cost_usd: Decimal


def _month_start() -> datetime:
    return datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def this_month(db: Session, organization_id: uuid.UUID) -> list[ModelUsage]:
    rows = db.execute(
        select(
            LLMUsage.provider,
            LLMUsage.model,
            LLMUsage.deployment,
            func.count(),
            func.coalesce(func.sum(LLMUsage.cost_usd), 0),
        )
        .where(LLMUsage.organization_id == organization_id, LLMUsage.created_at >= _month_start())
        .group_by(LLMUsage.provider, LLMUsage.model, LLMUsage.deployment)
        .order_by(LLMUsage.provider, LLMUsage.model)
    )
    return [ModelUsage(p, m, d, n, Decimal(c)) for p, m, d, n, c in rows]


def cost_this_month(db: Session, organization_id: uuid.UUID) -> Decimal:
    return sum((usage.cost_usd for usage in this_month(db, organization_id)), Decimal(0))


def cost_per_judged_attempt(
    db: Session, organization_id: uuid.UUID, days: int = 30
) -> Decimal | None:
    """What one judged attempt has cost this organization on average, measured over its own
    requests of the last `days` (FR-10.4: the estimate on Screen 34). None while there is nothing
    to measure — then the builder says so instead of inventing a price, which a price list per
    model could not give once a provider is switched (FR-10.3).
    """
    since = datetime.now(UTC) - timedelta(days=days)
    requests, cost = db.execute(
        select(func.count(), func.coalesce(func.sum(LLMUsage.cost_usd), 0)).where(
            LLMUsage.organization_id == organization_id,
            LLMUsage.task == LLM_JUDGE,
            LLMUsage.succeeded.is_(True),
            LLMUsage.created_at >= since,
        )
    ).one()
    if not requests:
        return None
    return (Decimal(cost) / Decimal(requests)).quantize(Decimal("0.000001"))


def cost_of_run(db: Session, campaign_run_id: uuid.UUID) -> Decimal:
    """What the requests that served one campaign run cost, e.g. its LLM judge (UC-5.6 step 2)."""
    total = db.scalar(
        select(func.coalesce(func.sum(LLMUsage.cost_usd), 0)).where(
            LLMUsage.campaign_run_id == campaign_run_id
        )
    )
    return Decimal(total)
