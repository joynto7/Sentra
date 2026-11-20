"""Shared set-up of the risk tests (FR-7.1, FR-7.2).

The findings come from the campaign runs of tests/m06_findings/conftest.py: no request leaves the
tests, the attempts carry the dummy messages ATTEMPT-1, ATTEMPT-2 …, a stub sender answers them
with invented replies and tool names, the target's canary tokens are fake, and the LLM judge is a
stub model.
"""

from datetime import UTC, datetime

from sqlalchemy import select

from app.modules.m02_targets.models import ProfileStatus, TargetProfile
from app.modules.m03_threat_models.models import (
    ComponentKind,
    Origin,
    Threat,
    ThreatModel,
    ThreatModelStatus,
    ThreatSource,
)
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


# ------------------------------------------------- what the risk views read (FR-7.3, FR-7.4)

REFUND_TOOL = {
    "name": "issue_refund",
    "parameters": "order id, amount",
    "side_effect": "Issues a refund to the customer",
    "source": "manual",
}
LOOKUP_TOOL = {
    "name": "lookup_customer",
    "parameters": "customer id",
    "side_effect": "",
    "source": "discovered",
}
# The detection engine names a component it finds through a canary token "Knowledge sources"
# (app/workers/detection/findings.py), so a profile that lists one under that name is the case
# where the finding and the profile meet.
SOURCES = {"name": "Knowledge sources", "access": "every user", "source": "manual"}


def profile_for(db, target, *, tools=(), knowledge_sources=(), reviewed_at=None) -> TargetProfile:
    """A reviewed Target Profile (FR-2.5): the components of the attack-path graph come from it."""
    profile = TargetProfile(
        target_id=target.id,
        status=ProfileStatus.REVIEWED,
        version=1,
        entries={},
        knowledge_sources=list(knowledge_sources),
        tools=list(tools),
        mapped_at=datetime.now(UTC),
        reviewed_at=reviewed_at or datetime.now(UTC),
    )
    db.add(profile)
    db.commit()
    return profile


def approved_threat_model(db, target, *threats: tuple[str, str, list[str]]) -> ThreatModel:
    """An approved threat model version with the given threats (title, component, categories):
    the framework coverage reads from it which categories apply to the target (UC-7.4 step 4)."""
    model = ThreatModel(
        organization_id=target.organization_id,
        target_id=target.id,
        version=1,
        status=ThreatModelStatus.APPROVED,
        origin=Origin.GENERATED,
        components=[],
        approved_at=datetime.now(UTC),
    )
    db.add(model)
    db.flush()
    for number, (title, component, owasp) in enumerate(threats, start=1):
        db.add(
            Threat(
                threat_model_id=model.id,
                threat_no=number,
                title=title,
                component_kind=ComponentKind.TOOL if component != "Model" else ComponentKind.MODEL,
                component_name=component,
                owasp=list(owasp),
                atlas=None,
                likelihood=3,
                impact=4,
                source=ThreatSource.BASELINE,
            )
        )
    db.commit()
    return model


def paths_of(client, target) -> dict:
    response = client.get(f"/api/v1/targets/{target.id}/attack-paths")
    assert response.status_code == 200, response.text
    return response.json()
