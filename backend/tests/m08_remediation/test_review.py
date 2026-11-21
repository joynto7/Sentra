"""Review and approval of a proposal (FR-8.2, UC-8.3 with 4a and 5a): adapting it writes the next
version, only a person approves, and never the person who adapted it. Dummy values only."""

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m08_remediation.models import RemediationComment
from tests.m01_users.test_organizations import log_in
from tests.m08_remediation.conftest import API, proposal


def draft(team, finding, model) -> dict:
    """A generated draft of the finding's proposal, as UC-8.2 leaves it."""
    model(proposal())
    team.client.post(f"{API}/{finding.code}/generate")
    return team.client.get(f"{API}/{finding.code}").json()


def edit_of(page, *, keep=None, **changes) -> dict:
    """The body of an edit: the fixes that stay, with what the person changed about them."""
    fixes = [
        {
            "position": fix["position"],
            "title": fix["title"],
            "description": fix["description"],
            "details": fix["details"],
        }
        for fix in page["current"]["fixes"]
        if keep is None or fix["position"] in keep
    ]
    return {
        "root_cause": page["current"]["root_cause"],
        "summary": page["current"]["summary"],
        "fixes": fixes,
    } | changes


def test_adapting_a_proposal_writes_the_next_version(team, confirmed, model):
    """UC-8.3 steps 2-3: the developer's version keeps what they kept, drops what they removed,
    and asks for approval in the same step."""
    page = draft(team, confirmed, model)
    body = edit_of(page, keep={1, 2})
    body["fixes"][0]["description"] = "Two sentences, agreed with the support team."

    log_in(team.client, "maya@example.com")  # the application's developer
    made = team.client.post(f"{API}/{confirmed.code}/versions?version=1", json=body)

    assert made.status_code == 201, made.text
    assert made.json()["version"] == 2
    assert made.json()["status"] == "awaiting_approval"
    assert made.json()["origin"] == "edited"
    assert made.json()["edited_by"] == "Maya"
    current = team.client.get(f"{API}/{confirmed.code}").json()["current"]
    assert current["version"] == 2 and current["fix_count"] == 2
    assert current["fixes"][0]["description"].endswith("agreed with the support team.")
    # the kind and where it is enforced stay Sentra's (UC-8.2 step 6)
    assert [fix["kind"] for fix in current["fixes"]] == ["system_prompt", "guardrail"]
    assert all(fix["enforcement"] == "application" for fix in current["fixes"])
    # version 1 is untouched, as every stored version is
    assert team.client.get(f"{API}/{confirmed.code}?version=1").json()["current"]["fix_count"] == 4
    actions = [
        entry.action for entry in team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq))
    ]
    assert "remediation.edited" in actions


def test_a_draft_can_be_sent_for_approval_as_it_is(team, confirmed, model):
    """Step 3 when nothing has to change."""
    draft(team, confirmed, model)

    sent = team.client.post(f"{API}/{confirmed.code}/versions/1/submit")

    assert sent.status_code == 200
    assert sent.json()["status"] == "awaiting_approval"
    again = team.client.post(f"{API}/{confirmed.code}/versions/1/submit")
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_sent"


def test_only_a_person_approves_and_never_the_one_who_adapted_it(team, confirmed, model):
    """UC-8.3, 4a and NFR-9.3: the version is approved by a person, and not by its editor."""
    page = draft(team, confirmed, model)
    log_in(team.client, "arif@example.com")  # Security Analyst, who adapts it himself
    team.client.post(f"{API}/{confirmed.code}/versions?version=1", json=edit_of(page))

    refused = team.client.post(f"{API}/{confirmed.code}/versions/2/approve")

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "edited_it_yourself"
    page = team.client.get(f"{API}/{confirmed.code}").json()
    assert page["review"]["can_approve"] is False
    assert "somebody else" in page["review"]["cannot_approve"]
    log_in(team.client, "sofia@example.com")  # Security Manager
    approved = team.client.post(f"{API}/{confirmed.code}/versions/2/approve")
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["decided_by"] == "Sofia"
    entry = team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq)).all()[-1]
    assert entry.action == "remediation.approved"


def test_a_developer_cannot_approve(team, confirmed, model):
    """Step 4: approving belongs to a Security Analyst or a Security Manager (FR-1.6)."""
    draft(team, confirmed, model)
    team.client.post(f"{API}/{confirmed.code}/versions/1/submit")

    log_in(team.client, "maya@example.com")  # AI Application Developer
    refused = team.client.post(f"{API}/{confirmed.code}/versions/1/approve")

    assert refused.status_code == 403
    page = team.client.get(f"{API}/{confirmed.code}").json()
    assert page["review"]["can_approve"] is False
    assert page["review"]["cannot_approve"].startswith("Only a Security Analyst")
    assert page["review"]["approvers"] == ["Arif", "Sofia"]


def test_a_rejected_version_is_kept_with_its_reason(team, confirmed, model):
    """5a1: the rejection keeps the version and says why, so the developer can revise it."""
    draft(team, confirmed, model)
    team.client.post(f"{API}/{confirmed.code}/versions/1/submit")
    reason = "The guardrail would block our refund questions. Please narrow it."

    log_in(team.client, "sofia@example.com")
    rejected = team.client.post(
        f"{API}/{confirmed.code}/versions/1/reject", json={"reason": reason}
    )

    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    assert rejected.json()["decision_reason"] == reason
    page = team.client.get(f"{API}/{confirmed.code}").json()
    assert page["current"]["decision_reason"] == reason
    assert page["review"]["can_edit"] is False  # a closed version is revised, not changed
    again = team.client.post(f"{API}/{confirmed.code}/versions/1/reject", json={"reason": "x"})
    assert again.status_code == 409
    entry = team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq)).all()[-1]
    assert entry.action == "remediation.rejected" and reason in entry.summary


def test_only_the_newest_version_is_worked_on(team, confirmed, model):
    """An earlier version is history: it is read, not adapted or sent."""
    page = draft(team, confirmed, model)
    team.client.post(f"{API}/{confirmed.code}/versions?version=1", json=edit_of(page))

    refused = team.client.post(f"{API}/{confirmed.code}/versions?version=1", json=edit_of(page))

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "not_the_newest_version"


def test_an_empty_proposal_is_refused(team, confirmed, model):
    """A version without a fix is no proposal, and an empty body is no fix."""
    page = draft(team, confirmed, model)

    without = team.client.post(
        f"{API}/{confirmed.code}/versions?version=1", json=edit_of(page, keep=set())
    )
    blank = [{"position": 1, "title": "t", "description": "d", "details": {"prompt": " "}}]
    empty = team.client.post(
        f"{API}/{confirmed.code}/versions?version=1",
        json=edit_of(page, keep={1}) | {"fixes": blank},
    )

    assert without.status_code == 422
    assert empty.status_code == 422
    assert "prompt" in empty.json()["error"]["details"][0]["message"]


def test_the_page_says_what_an_approval_starts(team, confirmed, model):
    """Step 6, written out before anybody approves: the fixes go to the gateway or to the
    developer, and the retest follows when every fix is in effect."""
    draft(team, confirmed, model)

    review = team.client.get(f"{API}/{confirmed.code}").json()["review"]

    assert review["can_submit"] is True and review["can_edit"] is True
    # No gateway protects the target yet (UC-8.2, 6a), so every fix is a change in the application
    assert any("task for the application's developer" in line for line in review["on_approval"])
    assert review["on_approval"][-1].startswith("A retest starts")


def test_the_thread_keeps_the_version_each_comment_was_written_on(team, confirmed, model):
    """UC-8.3: the developer and the approver talk about the proposal on the page."""
    page = draft(team, confirmed, model)
    log_in(team.client, "maya@example.com")
    team.client.post(
        f"{API}/{confirmed.code}/comments",
        json={"version": 1, "text": "The second fix is the one I can ship this week."},
    )
    team.client.post(f"{API}/{confirmed.code}/versions?version=1", json=edit_of(page, keep={2}))

    team.client.post(
        f"{API}/{confirmed.code}/comments", json={"version": 2, "text": "Ready for your review."}
    )

    thread = team.client.get(f"{API}/{confirmed.code}").json()["comments"]
    assert [one["version"] for one in thread] == [1, 2]
    assert [one["author"] for one in thread] == ["Maya", "Maya"]
    assert thread[0]["text"].startswith("The second fix")
    first = select(RemediationComment.version).order_by(RemediationComment.created_at)
    assert team.db.scalar(first) == 1
    refused = team.client.post(f"{API}/{confirmed.code}/comments", json={"version": 9, "text": "?"})
    assert refused.status_code == 404
