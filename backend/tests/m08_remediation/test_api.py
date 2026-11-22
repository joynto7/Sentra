"""The remediation API behind Screens 45 and 46: who may ask for a proposal (FR-1.6), what the
list and the page show, and the isolation between organizations (NFR-3.3)."""

from app.modules.m06_findings.models import FindingStatus
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m08_remediation.conftest import API, proposal
from tests.m08_remediation.test_review import draft, edit_of


def test_only_developers_and_analysts_ask_for_a_proposal(team, confirmed, model):
    """UC-8.2 primary actors: the application's developer and a security analyst. A Security
    Manager reads the proposal but doesn't ask for one."""
    model(proposal())

    log_in(team.client, "sofia@example.com")  # Security Manager
    refused = team.client.post(f"{API}/{confirmed.code}/generate")

    assert refused.status_code == 403
    assert team.client.get(f"{API}/{confirmed.code}").status_code == 200
    log_in(team.client, "maya@example.com")  # AI Application Developer
    assert team.client.post(f"{API}/{confirmed.code}/generate").status_code == 202


def test_the_page_shows_one_version_at_a_time(team, confirmed, model):
    model(proposal())
    team.client.post(f"{API}/{confirmed.code}/generate")
    team.client.post(f"{API}/{confirmed.code}/generate")  # a revision: version 2

    body = team.client.get(f"{API}/{confirmed.code}?version=1").json()

    assert body["current"]["version"] == 1
    assert [v["version"] for v in body["versions"]] == [2, 1]
    assert body["finding"]["code"] == confirmed.code
    assert body["finding"]["component"].startswith("System prompt")
    assert body["finding"]["target_name"] == "Payments Operations Agent"
    assert body["blocker"] is None
    assert team.client.get(f"{API}/{confirmed.code}?version=7").status_code == 404
    assert team.client.get(f"{API}/F-999").status_code == 404


def test_the_list_counts_the_drafts_and_the_findings_without_a_proposal(team, confirmed, model):
    model(proposal())

    before = team.client.get(API).json()

    assert [row["finding"]["code"] for row in before["rows"]] == [confirmed.code]
    assert (before["drafts"], before["without_proposal"]) == (0, 1)
    assert before["rows"][0]["latest"] is None
    team.client.post(f"{API}/{confirmed.code}/generate")
    after = team.client.get(API).json()
    assert (after["drafts"], after["without_proposal"]) == (1, 0)
    row = after["rows"][0]
    assert (row["latest"]["version"], row["latest"]["fix_count"]) == (1, 4)
    # Screen 45 names the kinds and where each one takes effect, without their content
    kinds = row["latest"]["fixes_in_short"]
    assert [fix["kind"] for fix in kinds] == [
        "system_prompt",
        "guardrail",
        "tool_policy",
        "retrieval_isolation",
    ]
    assert kinds[1]["kind_label"] == "Guardrail policy"
    assert {fix["enforcement"] for fix in kinds} == {"application"}  # 6a: no gateway yet
    assert row["job"] is None  # the job is done, so the page follows nothing


def test_a_finding_nobody_confirmed_is_not_in_the_list(team, confirmed):
    confirmed.status = FindingStatus.NEW
    team.db.commit()

    body = team.client.get(API).json()

    assert body["rows"] == [] and body["without_proposal"] == 0


def test_a_failed_generation_stays_on_the_page(team, confirmed, monkeypatch):
    from app.workers import jobs

    monkeypatch.setattr(jobs, "start", lambda *args, **options: False)  # the queue is down

    response = team.client.post(f"{API}/{confirmed.code}/generate")

    assert response.status_code == 202 and response.json()["status"] == "failed"
    page = team.client.get(f"{API}/{confirmed.code}").json()
    assert page["job"]["status"] == "failed"
    assert "background workers can't be reached" in page["job"]["message"]
    assert page["current"] is None
    job_id = page["job"]["id"]
    assert team.client.get(f"{API}/{confirmed.code}/jobs/{job_id}").json()["status"] == "failed"


def test_another_organizations_finding_is_out_of_reach(team, confirmed, model):
    """NFR-3.3: a member of another organization neither reads nor changes this finding."""
    model(proposal())
    new_user(team.db, "jonas@example.com")
    log_in(team.client, "jonas@example.com")
    create_organization(team.client, "Kestrel Logistics")

    assert team.client.get(f"{API}/{confirmed.code}").status_code == 404
    assert team.client.get(API).json()["rows"] == []
    # The permission is checked before the finding is looked up, so Kestrel's administrator is
    # refused for his role before the finding is even searched for.
    assert team.client.post(f"{API}/{confirmed.code}/generate").status_code == 403


def test_the_list_says_which_rows_this_reader_may_approve(team, confirmed, model):
    """Screen 45's "Awaiting my approval" tab (UC-8.3 step 4, and 4a). The question is about the
    person, not only their role: whoever last edited a version may not approve it, so the server
    answers it per row and the tab counts what is really waiting for the reader."""
    page = draft(team, confirmed, model)
    log_in(team.client, "arif@example.com")  # Security Analyst, who adapts it himself
    team.client.post(f"{API}/{confirmed.code}/versions?version=1", json=edit_of(page))

    his = team.client.get(API).json()

    # His own edit went to the approvers at once, and he is not one of them for it (4a).
    assert his["awaiting_me"] == 0 and his["rows"][0]["can_approve"] is False
    log_in(team.client, "sofia@example.com")  # Security Manager, who did not edit it
    hers = team.client.get(API).json()
    assert hers["awaiting_me"] == 1 and hers["rows"][0]["can_approve"] is True
    log_in(team.client, "maya@example.com")  # AI Application Developer: never approves
    theirs = team.client.get(API).json()
    assert theirs["awaiting_me"] == 0 and theirs["rows"][0]["can_approve"] is False
    # Once it is decided, it waits for nobody.
    log_in(team.client, "sofia@example.com")
    assert team.client.post(f"{API}/{confirmed.code}/versions/2/approve").status_code == 200
    assert team.client.get(API).json()["awaiting_me"] == 0
