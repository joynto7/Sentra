"""Tests for FR-5.2 (M5) Scope Approval: UC-5.2 Approve Campaign Scope, with 3a and 5a.

Nothing is sent to a target here: every test ends at the launch, which is refused or allowed.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy import text as sql

from app.core.audit import AuditLogEntry
from app.core.models import Organization
from app.modules.m01_users.models import Role
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m04_tests.suites import sync_built_in_suites
from app.modules.m05_campaigns.models import ApprovalStatus
from tests.m01_users.test_organizations import PASSWORD, log_in
from tests.m01_users.test_permissions import change, membership_of, organization_with
from tests.m05_campaigns.test_campaigns import URL, add_target, campaign, details
from tests.m05_campaigns.test_runs import notifications

SECURITY = "/api/v1/organizations/current/security"
REQUESTED = "approval_requested"
DECIDED = "campaign_scope_decided"


@pytest.fixture
def halcyon(client, db):
    """Halcyon Bank requires scope approval. Arif (Security Analyst) submits campaigns, Nadia
    (Security Manager) decides, Tom administers the organization, and the bank has one verified
    tool-using agent with the built-in tests and suites."""
    sync_built_in_library(db)
    sync_built_in_suites(db)
    org = organization_with(
        db,
        client,
        {
            "arif@example.com": Role.SECURITY_ANALYST,
            "nadia@example.com": Role.SECURITY_MANAGER,
            "maya@example.com": Role.TARGET_OWNER,
        },
    )
    agent = add_target(db, org)
    organization = db.get(Organization, org)
    organization.requires_scope_approval = True
    db.commit()
    log_in(client, "arif@example.com")
    return SimpleNamespace(client=client, db=db, org=org, agent=agent, organization=organization)


def create(halcyon, **changes):
    return halcyon.client.post(URL, json=campaign(halcyon.agent.id, **changes))


def approval_of(halcyon, code: str = "C-001") -> dict:
    response = halcyon.client.get(f"{URL}/{code}/approval")
    assert response.status_code == 200
    return response.json()


def submit(halcyon, note: str | None = None, code: str = "C-001"):
    return halcyon.client.post(f"{URL}/{code}/approval", json={"note": note})


def decide(halcyon, approve: bool, reason: str | None = None, code: str = "C-001"):
    return halcyon.client.post(
        f"{URL}/{code}/approval/decision", json={"approve": approve, "reason": reason}
    )


def launch(halcyon, code: str = "C-001"):
    return halcyon.client.post(f"{URL}/{code}/runs")


def actions(halcyon) -> list[str]:
    return list(
        halcyon.db.scalars(
            select(AuditLogEntry.action)
            .where(AuditLogEntry.organization_id == halcyon.org)
            .order_by(AuditLogEntry.seq)
        )
    )


def status_of(halcyon, code: str = "C-001") -> str:
    return halcyon.client.get(f"{URL}/{code}").json()["approval_status"]


def no_managers(halcyon) -> None:
    """The organization's Security Managers become Target Owners, so nobody can approve."""
    halcyon.db.execute(
        sql("UPDATE memberships SET role = 'target_owner' WHERE role = 'security_manager'")
    )
    halcyon.db.commit()


# ---------------------------------------------------------------- the organization's requirement


def test_without_the_requirement_nothing_changes(client, db):
    """FR-5.2 is optional: an organization that doesn't require approval works as before."""
    sync_built_in_library(db)
    sync_built_in_suites(db)
    org = organization_with(db, client, {"arif@example.com": Role.SECURITY_ANALYST})
    agent = add_target(db, org)
    log_in(client, "arif@example.com")

    created = client.post(URL, json=campaign(agent.id))

    assert created.json()["approval_status"] == "not_required"
    assert created.json()["estimate"]["requires_scope_approval"] is False
    assert client.post(f"{URL}/C-001/approval", json={}).json()["error"]["code"] == (
        "approval_not_required"
    )


def test_an_administrator_turns_the_requirement_on_and_off(halcyon):
    halcyon.organization.requires_scope_approval = False
    halcyon.db.commit()
    log_in(halcyon.client, "tom@example.com")
    halcyon.client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    on = halcyon.client.put(SECURITY, json={"mfa_required": False, "requires_scope_approval": True})

    assert on.status_code == 200
    assert (on.json()["requires_scope_approval"], on.json()["security_managers"]) == (True, 1)
    assert "organization.scope_approval_changed" in actions(halcyon)

    off = halcyon.client.put(
        SECURITY, json={"mfa_required": False, "requires_scope_approval": False}
    )

    assert off.json()["requires_scope_approval"] is False


def test_the_requirement_needs_someone_who_could_approve(halcyon):
    """Turning it on without a Security Manager would mean no campaign could ever run again."""
    halcyon.organization.requires_scope_approval = False
    no_managers(halcyon)
    log_in(halcyon.client, "tom@example.com")
    halcyon.client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    response = halcyon.client.put(
        SECURITY, json={"mfa_required": False, "requires_scope_approval": True}
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_security_manager"
    assert "Security Manager role" in response.json()["error"]["message"]


def test_turning_it_off_releases_the_campaigns_that_were_waiting(halcyon):
    create(halcyon)
    assert status_of(halcyon) == ApprovalStatus.AWAITING_APPROVAL
    log_in(halcyon.client, "tom@example.com")
    halcyon.client.post("/api/v1/auth/confirm-password", json={"password": PASSWORD})

    halcyon.client.put(SECURITY, json={"mfa_required": False, "requires_scope_approval": False})

    assert status_of(halcyon) == ApprovalStatus.NOT_REQUIRED
    log_in(halcyon.client, "arif@example.com")
    assert launch(halcyon).status_code == 202


# ---------------------------------------------------------------- submitting (step 1)


def test_creating_a_campaign_submits_its_scope_and_tells_the_managers(halcyon):
    created = create(halcyon)

    assert created.status_code == 201
    assert created.json()["approval_status"] == ApprovalStatus.AWAITING_APPROVAL
    assert created.json()["estimate"]["requires_scope_approval"] is True
    told = notifications(halcyon.db, "nadia@example.com", REQUESTED)
    assert len(told) == 1
    assert "C-001" in told[0] and "waiting for your approval" in told[0]
    assert "Payments Operations Agent" in told[0] and "2,000 attempts" in told[0]
    assert notifications(halcyon.db, "arif@example.com", REQUESTED) == []
    assert "campaign.scope_submitted" in actions(halcyon)


def test_a_campaign_waiting_for_approval_cannot_be_launched(halcyon):
    create(halcyon)

    response = launch(halcyon)

    assert (response.status_code, response.json()["error"]["code"]) == (409, "awaiting_approval")


def test_a_campaign_older_than_the_requirement_has_to_be_submitted(halcyon):
    """The requirement was turned on after the campaign was created, so it was never submitted."""
    halcyon.organization.requires_scope_approval = False
    halcyon.db.commit()
    create(halcyon)
    halcyon.organization.requires_scope_approval = True
    halcyon.db.commit()

    refused = launch(halcyon)

    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "approval_missing")
    assert "never been submitted" in refused.json()["error"]["message"]
    assert submit(halcyon, "Same scope as last quarter.").status_code == 200
    assert status_of(halcyon) == ApprovalStatus.AWAITING_APPROVAL
    assert len(notifications(halcyon.db, "nadia@example.com", REQUESTED)) == 1


def test_a_campaign_that_already_waits_is_not_submitted_twice(halcyon):
    create(halcyon)

    again = submit(halcyon)

    assert (again.status_code, again.json()["error"]["code"]) == (409, "awaiting_approval")
    assert len(notifications(halcyon.db, "nadia@example.com", REQUESTED)) == 1


# ---------------------------------------------------------------- the decision (steps 2-4, 3a)


def test_the_manager_sees_everything_the_decision_needs(halcyon):
    create(halcyon)
    log_in(halcyon.client, "nadia@example.com")

    view = approval_of(halcyon)

    scope = view["campaign"]
    assert (scope["code"], scope["target"]["name"]) == ("C-001", "Payments Operations Agent")
    assert (scope["attempt_budget"], scope["request_rate"], scope["suite_count"]) == (2000, 15, 2)
    assert scope["window_start"] == "02:00:00" and scope["adaptive_agent"] is True
    assert scope["estimate"]["tests"] == 6 and scope["estimate"]["llm_cost"] is not None
    assert [step["action"] for step in view["timeline"]] == ["created", "submitted"]
    assert view["timeline"][0]["actor"] == "Arif"
    assert (view["can_decide"], view["cannot_decide_reason"]) == (True, None)


def test_the_manager_approves_the_scope_and_the_campaign_can_run(halcyon):
    create(halcyon)
    log_in(halcyon.client, "nadia@example.com")

    decided = decide(halcyon, approve=True)

    assert decided.status_code == 200
    assert decided.json()["campaign"]["approval_status"] == ApprovalStatus.APPROVED
    assert decided.json()["campaign"]["approval_decision"]["actor"] == "Nadia"
    assert [step["action"] for step in decided.json()["timeline"]][-1] == "approved"
    assert "campaign.scope_approved" in actions(halcyon)
    told = notifications(halcyon.db, "arif@example.com", DECIDED)
    assert len(told) == 1 and "Nadia approved" in told[0] and "can run now" in told[0]

    log_in(halcyon.client, "arif@example.com")
    assert launch(halcyon).status_code == 202


def test_a_rejection_says_why_and_the_analyst_is_told(halcyon):
    create(halcyon)
    log_in(halcyon.client, "nadia@example.com")
    reason = "Budget too high for a first run on the new tool; start with 1,000 attempts."

    without = decide(halcyon, approve=False)

    assert without.status_code == 422
    assert details(without) == {
        "reason": "Say why you are rejecting it, so the analyst knows what to change."
    }

    rejected = decide(halcyon, approve=False, reason=reason)

    assert rejected.json()["campaign"]["approval_status"] == ApprovalStatus.REJECTED
    assert rejected.json()["timeline"][-1]["note"] == reason
    assert "campaign.scope_rejected" in actions(halcyon)
    assert reason in notifications(halcyon.db, "arif@example.com", DECIDED)[0]

    log_in(halcyon.client, "arif@example.com")
    refused = launch(halcyon)
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "approval_rejected")


def test_a_rejected_campaign_can_be_submitted_again(halcyon):
    create(halcyon)
    log_in(halcyon.client, "nadia@example.com")
    decide(halcyon, approve=False, reason="Start with a smaller budget.")
    log_in(halcyon.client, "arif@example.com")

    again = submit(halcyon, note="Budget reduced to 1,000 attempts.")

    assert again.status_code == 200
    assert again.json()["campaign"]["approval_status"] == ApprovalStatus.AWAITING_APPROVAL
    assert [step["action"] for step in again.json()["timeline"]] == [
        "created",
        "submitted",
        "rejected",
        "submitted",
    ]
    assert again.json()["timeline"][-1]["note"] == "Budget reduced to 1,000 attempts."
    assert len(notifications(halcyon.db, "nadia@example.com", REQUESTED)) == 2


def test_nobody_approves_their_own_campaign(halcyon):
    """Quality requirement 3. Only a Security Analyst creates campaigns and only a Security
    Manager decides on them, so the two meet in one person exactly when an analyst becomes a
    manager afterwards — and then that person still may not approve what they submitted."""
    create(halcyon)
    arif = membership_of(halcyon.db, "arif@example.com")
    log_in(halcyon.client, "tom@example.com")
    assert change(halcyon.client, arif, Role.SECURITY_MANAGER).status_code == 200
    log_in(halcyon.client, "arif@example.com")

    refused = decide(halcyon, approve=True)

    assert refused.status_code == 403
    assert refused.json()["error"]["message"] == "You can't approve campaigns you created."
    assert (
        approval_of(halcyon)["cannot_decide_reason"] == "You can't approve campaigns you created."
    )
    assert status_of(halcyon) == ApprovalStatus.AWAITING_APPROVAL


def test_only_a_security_manager_decides(halcyon):
    create(halcyon)

    for email in ("arif@example.com", "maya@example.com", "tom@example.com"):
        log_in(halcyon.client, email)

        assert decide(halcyon, approve=True).status_code == 403

    assert status_of(halcyon) == ApprovalStatus.AWAITING_APPROVAL


def test_every_member_may_read_the_request_but_sees_why_they_cannot_decide(halcyon):
    create(halcyon)
    log_in(halcyon.client, "maya@example.com")

    view = approval_of(halcyon)

    assert view["campaign"]["code"] == "C-001"
    assert (view["can_decide"], view["cannot_decide_reason"]) == (
        False,
        "Only a Security Manager approves a campaign's scope.",
    )


def test_a_campaign_that_waits_for_nothing_has_no_decision_to_make(halcyon):
    create(halcyon)
    log_in(halcyon.client, "nadia@example.com")
    decide(halcyon, approve=True)

    again = decide(halcyon, approve=True)

    assert (again.status_code, again.json()["error"]["code"]) == (409, "nothing_to_decide")


# ---------------------------------------------------------------- a change afterwards (5a)


def test_changing_the_schedule_of_an_approved_campaign_needs_a_new_approval(halcyon):
    create(halcyon)
    log_in(halcyon.client, "nadia@example.com")
    decide(halcyon, approve=True)
    log_in(halcyon.client, "arif@example.com")

    saved = halcyon.client.put(
        f"{URL}/C-001/schedule",
        json={"kind": "recurring", "frequency": "weekly", "at_time": "02:00", "weekday": 1},
    )

    assert saved.status_code == 200
    assert status_of(halcyon) == ApprovalStatus.AWAITING_APPROVAL
    assert [step["action"] for step in approval_of(halcyon)["timeline"]][-1] == "scope_changed"
    assert len(notifications(halcyon.db, "nadia@example.com", REQUESTED)) == 2
    assert (
        "changed and needs a new approval"
        in (notifications(halcyon.db, "nadia@example.com", REQUESTED)[-1])
    )
    assert launch(halcyon).json()["error"]["code"] == "awaiting_approval"


def test_saving_the_same_schedule_again_keeps_the_approval(halcyon):
    create(halcyon)
    schedule = {"kind": "recurring", "frequency": "weekly", "at_time": "02:00", "weekday": 1}
    halcyon.client.put(f"{URL}/C-001/schedule", json=schedule)
    log_in(halcyon.client, "nadia@example.com")
    decide(halcyon, approve=True)
    log_in(halcyon.client, "arif@example.com")

    halcyon.client.put(f"{URL}/C-001/schedule", json=schedule)

    assert status_of(halcyon) == ApprovalStatus.APPROVED


def test_pausing_the_schedule_does_not_ask_for_approval_again(halcyon):
    create(halcyon, schedule={"kind": "recurring", "frequency": "daily", "at_time": "02:00"})
    log_in(halcyon.client, "nadia@example.com")
    decide(halcyon, approve=True)
    log_in(halcyon.client, "arif@example.com")

    paused = halcyon.client.post(f"{URL}/C-001/schedule/pause")

    assert paused.status_code == 200
    assert status_of(halcyon) == ApprovalStatus.APPROVED


# ---------------------------------------------------------------- the managers hear of it


def test_without_a_manager_the_administrators_hear_of_the_request(halcyon):
    """The last Security Manager can leave while a campaign waits; only an administrator can
    appoint a new one, so they are told instead of nobody."""
    no_managers(halcyon)

    create(halcyon)

    told = notifications(halcyon.db, "tom@example.com", REQUESTED)
    assert len(told) == 1
    assert "no Security Manager" in told[0]
