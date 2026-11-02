"""FR-8.6 (M8) Policy Rollback: UC-8.8 Roll Back Shield Policy, with 2a and 4a.

A rollback deploys an earlier document again as a new version, takes the removed one out of the
traffic, reopens what only it had proved fixed, and is in the audit log with the words of the person
who did it — who has to authenticate again first (NFR-3.5). Dummy data only; the gateway is the
test client with its credential.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m01_users.models import Membership, Role, User
from app.modules.m06_findings.models import FindingStatus
from app.modules.m08_remediation import policies, retest
from app.modules.m08_remediation.models import (
    PolicyState,
    Remediation,
    RemediationStatus,
    ShieldGateway,
    ShieldPolicy,
)
from app.modules.m09_reporting.models import Notification
from tests.m01_users.test_organizations import PASSWORD, create, log_in, new_user
from tests.m08_remediation.test_policies import (
    MANAGER,
    TERMS,
    approve,
    deploy,
    policy_of,
    ready,
)
from tests.m08_remediation.test_shield import (
    DEVELOPER,
    SHIELD,
    as_gateway,
    beat,
    code_of,
)

REASON = "The output guardrail blocked legitimate refund-status questions."


def confirm(team, credential: str, version: int, rules: int) -> None:
    sent = team.client.post(
        f"{SHIELD}/confirm",
        json={"version": version, "rules": rules},
        headers=as_gateway(team, credential),
    )
    assert sent.status_code == 200, sent.text


def two_versions(team, finding, model, monkeypatch) -> str:
    """Version 1 active and version 2 active after it, both from the finding's approved proposal:
    version 2 matches other terms, so rolling back to version 1 really changes the traffic."""
    credential = ready(team, finding, model, monkeypatch)
    assert deploy(team, finding, terms=TERMS).status_code == 201
    confirm(team, credential, 1, 4)
    team.db.expire_all()
    team.db.scalar(select(Remediation)).status = RemediationStatus.APPROVED
    team.db.commit()
    assert deploy(team, finding, terms=["the second list of terms"]).status_code == 201
    confirm(team, credential, 2, 4)
    team.db.expire_all()
    return credential


def confirm_password(team, email: str = DEVELOPER) -> None:
    """Step 3: this session says the password again (NFR-3.5)."""
    log_in(team.client, email)
    said = team.client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})
    assert said.status_code == 204, said.text


def roll_back(team, *, to_version: int = 1, reason: str = REASON, target=None):
    return team.client.post(
        f"{SHIELD}/targets/{(target or team.agent).id}/rollback",
        json={"to_version": to_version, "reason": reason},
    )


def versions_of(team) -> list[ShieldPolicy]:
    return list(team.db.scalars(select(ShieldPolicy).order_by(ShieldPolicy.version)))


def actions(team) -> list[str]:
    return [
        one.action for one in team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq))
    ]


def notes(team) -> list[Notification]:
    return list(team.db.scalars(select(Notification).where(Notification.event == "shield_policy")))


# ---------------------------------------------------------------- step 2: before it happens


def test_the_dialog_says_what_a_rollback_would_do(team, confirmed, model, monkeypatch):
    """Step 2: the consequences are worked out now and stated before anybody confirms them."""
    two_versions(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)
    told = team.client.get(f"{SHIELD}/targets/{team.agent.id}/rollback?to_version=1")

    assert told.status_code == 200, told.text
    body = told.json()
    assert (body["from_version"], body["to_version"], body["disables"]) == (2, 1, False)
    assert (body["rules_now"], body["rules_after"]) == (4, 4)
    assert body["rules_removed"] == 1  # the guardrail of version 2, with its other terms
    assert body["remediations_stopping"] == [
        {"finding": confirmed.code, "version": 1, "fixes": [2]}
    ]
    assert body["findings_reopening"] == []  # FR-8.5 is what marks a finding as verified
    assert body["gateway_reachable"] is True and body["window_seconds"] == 30


def test_the_dialog_says_what_switching_the_policy_off_would_do(
    team, confirmed, model, monkeypatch
):
    """2a: no version to go back to — every rule leaves the traffic."""
    two_versions(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)
    body = team.client.get(f"{SHIELD}/targets/{team.agent.id}/rollback").json()

    assert body["disables"] is True and body["to_version"] is None
    assert (body["rules_now"], body["rules_after"], body["rules_removed"]) == (4, 0, 4)
    assert body["remediations_stopping"] == [
        {"finding": confirmed.code, "version": 1, "fixes": [1, 2, 3, 4]}
    ]


def test_a_version_that_is_already_active_cannot_be_rolled_back_to(
    team, confirmed, model, monkeypatch
):
    two_versions(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)
    refused = team.client.get(f"{SHIELD}/targets/{team.agent.id}/rollback?to_version=2")

    assert refused.status_code == 409 and code_of(refused) == "already_active"


def test_a_target_without_an_active_policy_has_nothing_to_roll_back(team, confirmed, model):
    approve(team, confirmed, model)

    log_in(team.client, DEVELOPER)
    refused = team.client.get(f"{SHIELD}/targets/{team.agent.id}/rollback?to_version=1")

    assert refused.status_code == 409 and code_of(refused) == "no_active_policy"


# ---------------------------------------------------------------- steps 3 to 6


def test_the_developer_rolls_the_policy_back_to_an_earlier_version(
    team, confirmed, model, monkeypatch
):
    """Steps 4-6: the earlier document is a new version, the removed one is out of the traffic with
    the reason beside it, the rollback is in the audit log, and the organization is told."""
    two_versions(team, confirmed, model, monkeypatch)
    confirm_password(team)

    done = roll_back(team, to_version=1)

    assert done.status_code == 200, done.text
    body = done.json()["policy"]
    assert (body["version"], body["state"], body["source"]) == (3, "active", "rollback")
    assert body["based_on_version"] == 1 and body["rolled_back_from"] == 2
    assert body["reason"] == REASON
    assert body["deployed_by"] == "Maya"
    team.db.expire_all()
    states = [(one.version, one.state) for one in versions_of(team)]
    assert states == [
        (1, PolicyState.SUPERSEDED),
        (2, PolicyState.ROLLED_BACK),
        (3, PolicyState.ACTIVE),
    ]
    # the document is version 1's again, renumbered as this version's own rules
    assert policies.current(team.db, team.agent.id).document["rules"][1]["terms"] == TERMS
    entry = team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq)).all()[-1]
    assert entry.action == "shield_policy.rolled_back"
    assert REASON in entry.summary and "rolled back to version 1" in entry.summary
    assert entry.details["from_version"] == 2 and entry.details["password_confirmed"] is True
    assert entry.actor_name == "Maya"
    assert any("was rolled back to version 1" in one.text for one in notes(team))
    assert REASON in notes(team)[-1].text


def test_a_rollback_needs_the_password_again(team, confirmed, model, monkeypatch):
    """Step 3 and NFR-3.5: a session that hasn't confirmed the password gets nowhere, and nothing
    is written."""
    two_versions(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)  # logged in, but no confirmation
    refused = roll_back(team, to_version=1)

    assert refused.status_code == 403
    assert code_of(refused) == "password_confirmation_required"
    team.db.expire_all()
    assert policy_of(team).version == 2  # the version that works is still the active one


def test_a_rollback_without_a_reason_is_refused(team, confirmed, model, monkeypatch):
    """Step 2: the reason stays with the version in the audit log, so it is not optional."""
    two_versions(team, confirmed, model, monkeypatch)
    confirm_password(team)

    refused = roll_back(team, to_version=1, reason="bad")

    assert refused.status_code == 422
    assert refused.json()["error"]["details"][0]["field"] == "reason"
    assert "Say in a sentence why" in refused.json()["error"]["details"][0]["message"]
    team.db.expire_all()
    assert len(versions_of(team)) == 2


def test_only_a_developer_or_an_analyst_rolls_back(team, confirmed, model, monkeypatch):
    """UC-8.8's actors (FR-1.6): a Security Manager approves remediations but does not take a
    policy out of the traffic."""
    two_versions(team, confirmed, model, monkeypatch)
    confirm_password(team, MANAGER)

    refused = roll_back(team, to_version=1)

    assert refused.status_code == 403
    team.db.expire_all()
    assert len(versions_of(team)) == 2


def test_switching_the_policy_off_leaves_the_gateway_forwarding_everything(
    team, confirmed, model, monkeypatch
):
    """2a: a version with no rules, so the gateway forwards all traffic unchanged until a policy
    is deployed again."""
    credential = two_versions(team, confirmed, model, monkeypatch)
    confirm_password(team)

    done = roll_back(team, to_version=0, reason="We are switching it off for the release window.")

    assert done.status_code == 200, done.text
    assert done.json()["policy"]["source"] == "disabled"
    assert done.json()["policy"]["rule_count"] == 0
    assert done.json()["consequences"]["disables"] is True
    document = team.client.get(f"{SHIELD}/policy", headers=as_gateway(team, credential)).json()
    assert document == {"version": 3, "document": {"rules": []}}
    assert "shield_policy.disabled" in actions(team)
    assert any("was switched off" in one.text for one in notes(team))


def test_a_finding_that_only_the_removed_version_proved_fixed_is_open_again(
    team, confirmed, model, monkeypatch
):
    """Step 5: what the removed version had proved is not proved any more."""
    two_versions(team, confirmed, model, monkeypatch)
    confirmed.status = FindingStatus.FIXED_AND_VERIFIED
    team.db.commit()
    confirm_password(team)

    done = roll_back(team, to_version=0, reason=REASON)

    assert done.json()["consequences"]["findings_reopening"] == [confirmed.code]
    team.db.expire_all()
    assert confirmed.status == FindingStatus.REOPENED
    assert "finding.reopened" in actions(team)


def test_the_proposal_whose_fixes_stop_goes_back_to_approved(team, confirmed, model, monkeypatch):
    """The fixes are out of the traffic, so the proposal is approved whatever the retest of FR-8.4
    made of it — and that retest hears that it has nothing left to prove."""
    cancelled: list[int] = []
    monkeypatch.setattr(
        retest,
        "after_rollback",
        lambda db, *, finding, remediation: cancelled.append(remediation.version),
    )
    two_versions(team, confirmed, model, monkeypatch)
    # The target still reveals what the finding is about, so the retest of the deployed version
    # found the weakness still open (UC-8.6, 5a).
    assert team.db.scalar(select(Remediation)).status == RemediationStatus.INEFFECTIVE
    confirm_password(team)

    roll_back(team, to_version=0, reason=REASON)

    team.db.expire_all()
    assert team.db.scalar(select(Remediation)).status == RemediationStatus.APPROVED
    assert cancelled == [1]


def test_a_version_on_its_way_to_the_gateway_is_cancelled_by_a_rollback(
    team, confirmed, model, monkeypatch
):
    """A version the gateway never activated is not something to keep waiting for once somebody
    has decided to go back."""
    two_versions(team, confirmed, model, monkeypatch)
    team.db.scalar(select(Remediation)).status = RemediationStatus.APPROVED
    team.db.commit()
    assert deploy(team, confirmed, terms=["a third list of terms"]).status_code == 201
    confirm_password(team)

    roll_back(team, to_version=1)

    team.db.expire_all()
    states = {one.version: one.state for one in versions_of(team)}
    assert states[3] == PolicyState.FAILED
    assert policies.current(team.db, team.agent.id).version == 4
    assert policies.CANCELLED_BY_ROLLBACK in versions_of(team)[2].failure_reason


def test_a_gateway_that_is_not_reporting_gets_the_rollback_when_it_comes_back(
    team, confirmed, model, monkeypatch
):
    """4a: Sentra cannot pretend a silent gateway has stopped enforcing the old version, so the
    rollback waits for it, says so, and takes effect when the gateway reports again (4a1)."""
    credential = two_versions(team, confirmed, model, monkeypatch)
    gateway = team.db.scalar(select(ShieldGateway))
    gateway.last_contact_at = datetime.now(UTC) - timedelta(minutes=10)
    team.db.commit()
    confirm_password(team)

    done = roll_back(team, to_version=1)

    assert done.status_code == 200, done.text
    assert done.json()["policy"]["state"] == "pending"
    assert done.json()["consequences"]["gateway_reachable"] is False
    assert any("as soon as it reconnects" in one.text for one in notes(team))
    team.db.expire_all()
    assert policies.current(team.db, team.agent.id).version == 2  # still what is in the traffic

    told = beat(team, credential, requests=1, policy_version=2)
    assert told["policy_version"] == 3  # the version it should take now
    confirm(team, credential, 3, 4)

    team.db.expire_all()
    states = {one.version: one.state for one in versions_of(team)}
    assert states[3] == PolicyState.ACTIVE and states[2] == PolicyState.ROLLED_BACK


# ---------------------------------------------------------------- what the pages read


def test_the_history_keeps_the_reason_with_the_version_it_removed(
    team, confirmed, model, monkeypatch
):
    """Screen 49's history: a rolled-back version carries the sentence somebody wrote about it."""
    two_versions(team, confirmed, model, monkeypatch)
    confirm_password(team)
    roll_back(team, to_version=1)

    log_in(team.client, DEVELOPER)
    page = team.client.get(f"{SHIELD}/targets/{team.agent.id}/policy").json()

    history = {one["version"]: one for one in page["versions"]}
    assert [one["version"] for one in page["versions"]] == [3, 2, 1]
    assert history[2]["state_label"] == "Rolled back"
    assert history[2]["rolled_back_reason"] == REASON
    assert history[3]["reason"] == REASON and history[3]["state_label"] == "Active"
    assert page["active"]["version"] == 3


def test_screen_49_reads_the_counts_and_the_remediations_of_a_version(
    team, confirmed, model, monkeypatch
):
    """The card of the active policy: how many rules of each kind, and which remediations they
    came from."""
    two_versions(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)
    active = team.client.get(f"{SHIELD}/targets/{team.agent.id}/policy").json()["active"]

    assert active["rule_counts"] == [
        {"label": "Input guardrails", "count": 0},
        {"label": "Output guardrails", "count": 1},
        {"label": "Tool permissions", "count": 1},
        {"label": "Retrieval isolation", "count": 1},
        {"label": "System prompt hardening", "count": 1},
    ]
    assert active["remediations"] == [
        {
            "finding": confirmed.code,
            "finding_title": confirmed.title,
            "version": 1,
            "fixes": [1, 2, 3, 4],
        }
    ]


def test_screen_47_says_which_policy_version_is_active_per_target(
    team, confirmed, model, monkeypatch
):
    two_versions(team, confirmed, model, monkeypatch)

    log_in(team.client, DEVELOPER)
    row = team.client.get(SHIELD).json()["rows"][0]

    assert row["active_policy_version"] == 2
    assert row["active_policy_since"] is not None
    assert row["policy_version"] == 2  # and the gateway itself reports the same version


def test_another_organization_cannot_roll_this_policy_back(team, confirmed, model, monkeypatch):
    """NFR-3.3: not even with the password of their own account."""
    two_versions(team, confirmed, model, monkeypatch)

    new_user(team.db, "nadia@example.com")
    log_in(team.client, "nadia@example.com")
    other = create(team.client, "Kestrel Logistics").json()["id"]
    new_user(team.db, "omar@example.com")
    omar = team.db.scalar(select(User.id).where(User.email == "omar@example.com"))
    team.db.add(Membership(user_id=omar, organization_id=other, role=Role.TARGET_OWNER))
    team.db.flush()
    log_in(team.client, "omar@example.com")
    team.client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    refused = roll_back(team, to_version=1)

    assert refused.status_code == 404
    team.db.expire_all()
    assert policy_of(team).version == 2
