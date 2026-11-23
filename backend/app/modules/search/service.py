"""What the search box finds. The rules, because this one query runs over three modules' data:

- The organization always comes from the session (router.py) and every query starts from
  `scoped_select`, so one organization can never find another's data.
- `%` and `_` mean themselves: `icontains(..., autoescape=True)` escapes them.
- Each group is capped, and returns only what its own list page shows to every member.
- The search words are never logged (router.py).
"""

import re
import threading
import time
import uuid
from collections import defaultdict, deque
from urllib.parse import urlsplit

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.tenancy import scoped_select
from app.modules.m02_targets.models import Target, TargetStatus
from app.modules.m05_campaigns.models import Campaign, CampaignRun
from app.modules.m06_findings.models import Finding
from app.modules.m06_findings.service import SEVERITY_RANK

MIN_LENGTH = 2  # one letter would match nearly everything, and says nothing
PER_GROUP = 5

_FINDING_CODE = re.compile(r"F-?(\d{1,9})", re.IGNORECASE)
_CAMPAIGN_CODE = re.compile(r"C-?(\d{1,9})", re.IGNORECASE)
_RUN_CODE = re.compile(r"R-?(\d{1,9})-(\d{1,9})", re.IGNORECASE)


def _total(db: Session, query) -> int:
    return db.scalar(select(func.count()).select_from(query.subquery())) or 0


def _target_names(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    return {
        id_: name
        for id_, name in db.execute(select(Target.id, Target.name).where(Target.id.in_(ids)))
    }


def _targets(db: Session, organization_id: uuid.UUID, words: str) -> dict:
    query = scoped_select(Target, organization_id).where(
        or_(
            Target.name.icontains(words, autoescape=True),
            Target.endpoint_url.icontains(words, autoescape=True),
        )
    )
    archived_last = case((Target.status == TargetStatus.ARCHIVED, 1), else_=0)
    rows = db.scalars(query.order_by(archived_last, func.lower(Target.name)).limit(PER_GROUP)).all()
    return {
        "total": _total(db, query),
        "items": [
            {
                "id": target.id,
                "name": target.name,
                "type": target.type,
                "environment": target.environment,
                "status": target.status,
                "endpoint_host": urlsplit(target.endpoint_url).hostname or "",
            }
            for target in rows
        ],
    }


def _findings(db: Session, organization_id: uuid.UUID, words: str) -> dict:
    condition = Finding.title.icontains(words, autoescape=True)
    number = None
    if match := _FINDING_CODE.fullmatch(words):
        number = int(match[1])
        condition = or_(condition, Finding.number == number)
    query = scoped_select(Finding, organization_id).where(condition)
    exact_first = case((Finding.number == number, 0), else_=1)
    rank = case(SEVERITY_RANK, value=Finding.severity, else_=len(SEVERITY_RANK))
    rows = db.scalars(
        query.order_by(exact_first, rank, Finding.last_seen_at.desc()).limit(PER_GROUP)
    ).all()
    names = _target_names(db, {finding.target_id for finding in rows})
    return {
        "total": _total(db, query),
        "items": [
            {
                "code": finding.code,
                "title": finding.title,
                "severity": finding.severity,
                "status": finding.status,
                "target_name": names.get(finding.target_id, ""),
            }
            for finding in rows
        ],
    }


def _campaigns(db: Session, organization_id: uuid.UUID, words: str) -> dict:
    """Campaigns by name or C-231; R-231-4 finds that one campaign run."""
    if match := _RUN_CODE.fullmatch(words):
        found = db.execute(
            select(CampaignRun, Campaign, Target.name)
            .join(Campaign, Campaign.id == CampaignRun.campaign_id)
            .join(Target, Target.id == Campaign.target_id)
            .where(
                Campaign.organization_id == organization_id,
                Campaign.number == int(match[1]),
                CampaignRun.number == int(match[2]),
            )
        ).first()
        if found is None:
            return {"total": 0, "items": []}
        run, campaign, target_name = found
        return {
            "total": 1,
            "items": [
                {
                    "code": campaign.code,
                    "name": campaign.name,
                    "target_name": target_name,
                    "run_number": run.number,
                }
            ],
        }
    condition = Campaign.name.icontains(words, autoescape=True)
    number = None
    if match := _CAMPAIGN_CODE.fullmatch(words):
        number = int(match[1])
        condition = or_(condition, Campaign.number == number)
    query = scoped_select(Campaign, organization_id).where(condition)
    exact_first = case((Campaign.number == number, 0), else_=1)
    rows = db.scalars(query.order_by(exact_first, Campaign.number.desc()).limit(PER_GROUP)).all()
    names = _target_names(db, {campaign.target_id for campaign in rows})
    return {
        "total": _total(db, query),
        "items": [
            {
                "code": campaign.code,
                "name": campaign.name,
                "target_name": names.get(campaign.target_id, ""),
                "run_number": None,
            }
            for campaign in rows
        ],
    }


def search(db: Session, organization_id: uuid.UUID, words: str) -> dict:
    words = words.strip()
    if len(words) < MIN_LENGTH:
        nothing = {"total": 0, "items": []}
        return {"targets": nothing, "findings": nothing, "campaigns": nothing}
    return {
        "targets": _targets(db, organization_id, words),
        "findings": _findings(db, organization_id, words),
        "campaigns": _campaigns(db, organization_id, words),
    }


class Limiter:
    """At most `limit` searches per person per `seconds`. The box waits for a pause in typing, so a
    person never comes near this; a script does. It counts per API process, which is enough for
    that, and it needs no Redis, so search keeps working if Redis is down."""

    def __init__(self, limit: int = 120, seconds: float = 60) -> None:
        self.limit, self.seconds = limit, seconds
        self._recent: dict[uuid.UUID, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, who: uuid.UUID, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            recent = self._recent[who]
            while recent and recent[0] <= now - self.seconds:
                recent.popleft()
            if len(recent) >= self.limit:
                return False
            recent.append(now)
            return True


limiter = Limiter()
