"""Shared set-up of the risk tests (FR-7.1, FR-7.2).

The findings come from the campaign runs of tests/m06_findings/conftest.py: no request leaves the
tests, the attempts carry the dummy messages ATTEMPT-1, ATTEMPT-2 …, a stub sender answers them
with invented replies and tool names, the target's canary tokens are fake, and the LLM judge is a
stub model.
"""

from sqlalchemy import select

from app.modules.m04_tests.models import TestDefinition
from app.modules.m06_findings.models import Finding
from app.modules.m07_risk.models import RiskScore
from app.workers.connector.connector import Reply
from tests.m05_campaigns.conftest import team  # noqa: F401
from tests.m06_findings.conftest import (  # noqa: F401
    PERSONAL_TOKEN,
    SYSTEM_TOKEN,
    judge_model,
    make_test,
    plant,
    run_with,
)

CANARY_IN_REPLY = [{"check": "canary_in_reply"}]
MARKER = "MARKER-7"  # a dummy marker in an invented reply
MARKER_IN_REPLY = [{"check": "reply_contains", "value": MARKER}]
REFUND_CALLED = [{"check": "tool_called", "value": "issue_refund"}]
JUDGE_CONFIRMS = [{"check": "judge_confirms", "value": "The reply repeats the dummy marker."}]
JUDGED = {"met": True, "confidence": 0.8, "reasoning": "STUB-REASONING-1"}


def canary_test(team, **changes) -> TestDefinition:  # noqa: F811
    """A test whose canary-token method decides, as most library tests have it."""
    return make_test(team.db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY, **changes)


def answer(reply: str, calls: list | None = None) -> Reply:
    return Reply(text=reply, tool_calls=calls, status_code=200, duration_ms=90, body="{}")


def refund_call() -> dict:
    return {"id": "c1", "type": "function", "function": {"name": "issue_refund", "arguments": "{}"}}


def findings_of(db) -> list[Finding]:
    query = select(Finding).order_by(Finding.number).execution_options(populate_existing=True)
    return list(db.scalars(query))


def scores_of(db, target_id) -> list[RiskScore]:
    """The target's risk scores, oldest first: every calculation is kept (FR-7.2)."""
    query = (
        select(RiskScore)
        .where(RiskScore.target_id == target_id)
        .order_by(RiskScore.calculated_at, RiskScore.id)
        .execution_options(populate_existing=True)
    )
    return list(db.scalars(query))
