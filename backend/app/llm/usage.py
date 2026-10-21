"""What an organization's requests through the LLM layer used: per provider and model in the
current month (UC-10.5 step 2), the month's cost for the usage limits (FR-10.4), and the cost of
one campaign run."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.llm.models import LLMUsage


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


def cost_of_run(db: Session, campaign_run_id: uuid.UUID) -> Decimal:
    """What the requests that served one campaign run cost, e.g. its LLM judge (UC-5.6 step 2)."""
    total = db.scalar(
        select(func.coalesce(func.sum(LLMUsage.cost_usd), 0)).where(
            LLMUsage.campaign_run_id == campaign_run_id
        )
    )
    return Decimal(total)
