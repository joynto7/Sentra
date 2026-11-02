"""FR-8.4 (M8), first half: UC-8.5 Confirm Application Change, with 2a and 2b.

Approving a proposal turns every fix no gateway can carry into an open task on its finding; the
developer marks each one as implemented with a description and a link, and only then — when
nothing of the proposal is open any more — does Sentra retest the finding. Dummy data only: the
finding comes from the campaign run of the fixtures, and nothing is sent to a target.
"""

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m08_remediation.models import (
    ApplicationChange,
    ChangeStatus,
    Remediation,
    RemediationStatus,
    Retest,
)
from tests.m01_users.test_organizations import log_in
from tests.m05_campaigns.conftest import StubSender
from tests.m08_remediation.conftest import API, PROPOSAL, proposal, retest_engine
from tests.m08_remediation.test_policies import MANAGER
from tests.m08_remediation.test_shield import ANALYST, DEVELOPER, code_of

CODE_CHANGE = {
    "kind": "code_change",
    "title": "Escape the model's output before the widget renders it",
    "description": "The chat widget renders replies as HTML, so it has to escape them first.",
    "steps": ["Escape the reply before it is inserted into the page."],
}
NOTE = "The chat widget now renders replies as text; escaping was added to the render pipeline."
LINK = "https://git.example.com/support/web-widget/merge_requests/482"


def two_fixes(team, finding, model) -> dict:
    """An approved proposal with two fixes and no gateway anywhere, so both of them are changes
    inside the application (UC-8.2, 6a)."""
    log_in(team.client, ANALYST)
    model(proposal(fixes=[PROPOSAL["fixes"][1], CODE_CHANGE]))
    team.client.post(f"{API}/{finding.code}/generate")
    log_in(team.client, DEVELOPER)
    team.client.post(f"{API}/{finding.code}/versions/1/submit")
    log_in(team.client, MANAGER)
    decided = team.client.post(f"{API}/{finding.code}/versions/1/approve")
    assert decided.status_code == 200, decided.text
    return decided.json()


def changes_of(team) -> list[ApplicationChange]:
    query = (
        select(ApplicationChange)
        .order_by(ApplicationChange.position)
        .execution_options(populate_existing=True)
    )
    return list(team.db.scalars(query))


def mark(team, finding, change_id, *, note: str = NOTE, link: str | None = LINK):
    log_in(team.client, DEVELOPER)
    return team.client.post(
        f"{API}/{finding.code}/changes/{change_id}/implemented",
        json={"note": note, "link": link},
    )


def actions(team) -> list[str]:
    return [
        one.action for one in team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq))
    ]


def test_approval_opens_one_task_per_fix_inside_the_application(team, confirmed, model):
    """Step 1: each approved fix that no gateway can carry becomes an open task on the finding."""
    two_fixes(team, confirmed, model)

    changes = changes_of(team)
    assert [(one.position, one.status) for one in changes] == [
        (1, ChangeStatus.OPEN),
        (2, ChangeStatus.OPEN),
    ]
    assert changes[1].title == CODE_CHANGE["title"]
    assert all(one.finding_id == confirmed.id for one in changes)


def test_the_task_list_says_what_to_change_and_how_far_the_proposal_has_come(
    team, confirmed, model
):
    """Step 1 and Screen 50: the change, the finding, who approved it and what is still missing."""
    two_fixes(team, confirmed, model)

    log_in(team.client, DEVELOPER)
    listed = team.client.get(f"{API}/changes/open")

    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["open_changes"] == 2
    first = body["rows"][0]
    assert first["finding"]["code"] == confirmed.code
    assert first["description"] == PROPOSAL["fixes"][1]["description"]
    assert first["approved_by"] == "Sofia"
    assert first["progress"].startswith("0 of 2 fixes in effect")
    assert "2 changes inside the application are still open" in first["progress"]
    assert first["status"] == ChangeStatus.OPEN and first["note"] is None


def test_marking_one_change_records_it_and_starts_no_retest_yet(team, confirmed, model):
    """Steps 3-4 with 2b1: the confirmation is kept with its author and in the audit log, and the
    retest waits until every fix of the proposal is in effect."""
    two_fixes(team, confirmed, model)
    changes = changes_of(team)

    answered = mark(team, confirmed, changes[0].id)

    assert answered.status_code == 200, answered.text
    body = answered.json()
    assert body["status"] == ChangeStatus.IMPLEMENTED
    assert body["note"] == NOTE and body["link"] == LINK
    assert body["implemented_by"] == "Maya" and body["implemented_at"]
    assert "1 change inside the application is still open" in body["progress"]
    assert "remediation.change_implemented" in actions(team)
    entry = team.db.scalars(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "remediation.change_implemented")
        .order_by(AuditLogEntry.seq)
    ).first()
    assert entry.details["changes_left"] == 1 and entry.details["link"] == LINK
    assert team.db.scalar(select(Retest)) is None  # nothing to verify yet


def test_the_confirmation_is_in_the_findings_history(team, confirmed, model):
    """Step 4: the finding's history (FR-6.5) shows the confirmation with the developer's name, the
    change and what they wrote, numbered after the finding's own entries."""
    two_fixes(team, confirmed, model)
    changes = changes_of(team)

    mark(team, confirmed, changes[0].id)

    log_in(team.client, ANALYST)  # every member reads a finding's history
    history = team.client.get(f"/api/v1/findings/{confirmed.code}/history").json()
    entry = history[-1]
    assert entry["kind"] == "change_implemented"
    assert (entry["actor"], entry["by_sentra"]) == ("Maya", False)
    assert entry["text"] == f"{changes[0].title}: {NOTE} ({LINK})"
    assert entry["number"] == len(history)


def test_marking_the_last_change_starts_the_retest(team, confirmed, model, monkeypatch):
    """Step 5: the retest of the finding starts when nothing of the proposal is open any more."""
    two_fixes(team, confirmed, model)
    changes = changes_of(team)
    mark(team, confirmed, changes[0].id)
    # The retest run goes through the engine: a stub sender answers its attempts, and its plan is
    # the replay of UC-8.6 step 1, not the stub the finding's own fixture installed.
    retest_engine(monkeypatch, StubSender())

    answered = mark(team, confirmed, changes[1].id, note="Deployed the escaping fix.", link=None)

    assert answered.status_code == 200, answered.text
    retest = team.db.scalar(select(Retest).execution_options(populate_existing=True))
    assert retest is not None and retest.number == 1
    assert retest.started_by_id is not None  # the developer whose confirmation was the last one
    assert "retest.started" in actions(team)
    remediation = team.db.scalar(select(Remediation).execution_options(populate_existing=True))
    assert remediation.status in (
        RemediationStatus.APPLYING,
        RemediationStatus.EFFECTIVE,
        RemediationStatus.INEFFECTIVE,
    )


def test_a_change_needs_a_description_and_a_real_link(team, confirmed, model):
    """Step 3: what was changed is the half of the confirmation that is worth keeping."""
    two_fixes(team, confirmed, model)
    changes = changes_of(team)

    without = mark(team, confirmed, changes[0].id, note="   ")
    bad_link = mark(team, confirmed, changes[0].id, link="git.example.com/482")

    assert without.status_code == 422 and code_of(without) == "validation_error"
    assert bad_link.status_code == 422
    assert changes_of(team)[0].status == ChangeStatus.OPEN


def test_a_change_is_marked_once(team, confirmed, model):
    two_fixes(team, confirmed, model)
    changes = changes_of(team)
    assert mark(team, confirmed, changes[0].id).status_code == 200

    again = mark(team, confirmed, changes[0].id)

    assert again.status_code == 409 and code_of(again) == "already_implemented"


def test_only_a_developer_or_an_analyst_marks_a_change(team, confirmed, model):
    """`request_remediations`, the permission of the people who ask for and adapt a proposal."""
    two_fixes(team, confirmed, model)
    changes = changes_of(team)

    log_in(team.client, MANAGER)
    refused = team.client.post(
        f"{API}/{confirmed.code}/changes/{changes[0].id}/implemented",
        json={"note": NOTE},
    )

    assert refused.status_code == 403
    assert changes_of(team)[0].status == ChangeStatus.OPEN


def test_a_change_of_another_finding_is_not_found(team, confirmed, model):
    """NFR-3.3: the change has to belong to the finding in the address."""
    two_fixes(team, confirmed, model)
    changes = changes_of(team)

    log_in(team.client, DEVELOPER)
    answered = team.client.post(
        f"{API}/F-999/changes/{changes[0].id}/implemented", json={"note": NOTE}
    )

    assert answered.status_code == 404
