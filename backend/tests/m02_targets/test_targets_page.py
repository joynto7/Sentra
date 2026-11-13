"""Screen 16's order and its Sentra Shield column (UX task 4.5): the targets page sorts by name,
by risk score (FR-7.2, M7) or by the last campaign run, and shows the state of the Sentra Shield
gateway in front of each target (FR-8.3, FR-10.6, M8), which it can also filter by.
Dummy values only: invented hosts, scores and gateway credentials.
"""

from datetime import UTC, datetime, timedelta

from app.modules.m02_targets.models import TargetStatus
from app.modules.m07_risk.models import RiskScore, ScoreTrigger
from app.modules.m08_remediation.models import GatewayStatus, ShieldGateway
from tests.m02_targets.test_targets import register, stored

URL = "/api/v1/targets"
NOW = datetime.now(UTC)
HOSTS = {
    "Customer Support Assistant": "https://support-assistant.halcyonbank.com/api/chat",
    "Loan Policy Q&A": "https://loan-policy.staging.halcyonbank.com/api/chat",
    "Payments Operations Agent": "https://payments-agent.staging.halcyonbank.com/v1/chat",
    "Internal HR Helpdesk": "https://support-assistant.halcyonbank.com/hr/chat",
}


def targets(client, db, names) -> dict:
    """Verified targets of the developer's organization, by name."""
    made = {}
    for name in names:
        made[name] = stored(db, register(client, name=name, endpoint_url=HOSTS[name]).json()["id"])
        made[name].status = TargetStatus.VERIFIED
    db.flush()
    return made


def score(db, target, value: int, last_run_days_ago: int, calculated_days_ago: int = 0) -> None:
    db.add(
        RiskScore(
            organization_id=target.organization_id,
            target_id=target.id,
            score=value,
            band="critical" if value >= 75 else "high",
            counted=1,
            trigger=ScoreTrigger.CAMPAIGN_RUN,
            last_run_at=NOW - timedelta(days=last_run_days_ago),
            calculated_at=NOW - timedelta(days=calculated_days_ago),
        )
    )
    db.flush()


def gateway(db, target, status: str, last_contact: timedelta | None) -> None:
    # The clock is read here, not when the file is loaded: the suite reaches this test minutes later
    now = datetime.now(UTC)
    db.add(
        ShieldGateway(
            organization_id=target.organization_id,
            target_id=target.id,
            position="in_front",
            status=status,
            credential_prefix="sgw_test01",
            credential_hash="0" * 64,
            connected_at=now - timedelta(days=1),
            last_contact_at=now - last_contact if last_contact is not None else None,
        )
    )
    db.flush()


def names(client, **params) -> list[str]:
    response = client.get(URL, params=params)
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()["items"]]


def test_the_page_sorts_by_risk_score_and_last_run_with_untested_targets_last(developer, db):
    three = ["Customer Support Assistant", "Loan Policy Q&A", "Payments Operations Agent"]
    made = targets(developer, db, three)
    score(db, made["Customer Support Assistant"], 86, last_run_days_ago=3)
    score(db, made["Payments Operations Agent"], 64, last_run_days_ago=5)
    # Loan Policy Q&A has no score: it hasn't been tested

    assert names(developer) == three
    assert names(developer, sort="name", direction="desc")[0] == "Payments Operations Agent"
    assert names(developer, sort="risk", direction="desc") == [
        "Customer Support Assistant",
        "Payments Operations Agent",
        "Loan Policy Q&A",
    ]
    # Not tested is neither the highest nor the lowest risk: last both ways
    assert names(developer, sort="risk", direction="asc") == [
        "Payments Operations Agent",
        "Customer Support Assistant",
        "Loan Policy Q&A",
    ]
    assert names(developer, sort="last_run", direction="desc")[:2] == [
        "Customer Support Assistant",
        "Payments Operations Agent",
    ]
    assert names(developer, sort="last_run", direction="asc")[-1] == "Loan Policy Q&A"

    # The newest calculation counts, as on Screens 20 and 42 (UC-7.2)
    score(db, made["Payments Operations Agent"], 91, last_run_days_ago=0, calculated_days_ago=-1)
    assert names(developer, sort="risk", direction="desc")[0] == "Payments Operations Agent"
    # And the order runs over every page, not only one
    assert names(developer, sort="risk", direction="desc", page_size=1, page=2) == [
        "Customer Support Assistant"
    ]


def test_every_target_says_the_state_of_its_sentra_shield_gateway(developer, db):
    made = targets(developer, db, list(HOSTS))
    gateway(db, made["Customer Support Assistant"], GatewayStatus.ACTIVE, timedelta(seconds=10))
    # Silent for longer than three heartbeats: not reporting (FR-10.6), whatever was stored
    gateway(db, made["Loan Policy Q&A"], GatewayStatus.ACTIVE, timedelta(minutes=10))
    gateway(db, made["Payments Operations Agent"], GatewayStatus.REVOKED, timedelta(days=1))
    # Internal HR Helpdesk has no gateway

    items = developer.get(URL).json()["items"]
    shield = {item["name"]: (item["shield"]["status"], item["shield"]["label"]) for item in items}
    assert shield == {
        "Customer Support Assistant": ("active", "Active"),
        "Internal HR Helpdesk": ("not_connected", "Not connected"),
        "Loan Policy Q&A": ("not_reporting", "Not reporting"),
        "Payments Operations Agent": ("not_connected", "Not connected"),
    }
    assert names(developer, shield="active") == ["Customer Support Assistant"]
    assert names(developer, shield="not_connected") == [
        "Internal HR Helpdesk",
        "Payments Operations Agent",
    ]
    assert names(developer, shield=["active", "not_reporting"]) == [
        "Customer Support Assistant",
        "Loan Policy Q&A",
    ]
    assert developer.get(URL, params={"shield": "not_connected"}).json()["total"] == 2


def test_an_unknown_order_or_shield_state_is_refused(developer):
    assert developer.get(URL, params={"sort": "owner"}).status_code == 422
    assert developer.get(URL, params={"direction": "up"}).status_code == 422
    assert developer.get(URL, params={"shield": "on"}).status_code == 422
