"""Screen 33's rows (UX task 4.5): each campaign says who approved its scope (FR-5.2, M5) and what
its newest run is (FR-5.4, M5), so the page can tell running, scheduled, paused and waiting
campaigns apart and sort them by the last run.
"""

from app.modules.m02_targets import verification
from tests.m01_users.test_organizations import log_in
from tests.m05_campaigns.conftest import confirmed
from tests.m05_campaigns.test_scope_approval import (  # noqa: F401 (the fixture)
    URL,
    create,
    decide,
    halcyon,
    launch,
)


def rows(halcyon) -> dict:  # noqa: F811
    response = halcyon.client.get(URL)
    assert response.status_code == 200, response.text
    return {row["code"]: row for row in response.json()}


def test_a_campaign_names_who_approved_it_and_its_newest_run(halcyon, monkeypatch):  # noqa: F811
    # Unlike test_scope_approval.py's own tests, this one looks past the launch, at the run it
    # started: the ownership recheck of UC-5.4 step 1 must pass, as it does for a real target.
    monkeypatch.setattr(verification, "_check", confirmed)
    # window_start/window_end are cleared: the default (02:00-05:00 Asia/Dhaka) would leave this
    # run waiting for its window outside those hours, which is not what this test is about.
    create(halcyon, window_start=None, window_end=None, time_zone="UTC")
    create(halcyon, name="Weekly regression")
    log_in(halcyon.client, "nadia@example.com")
    assert decide(halcyon, approve=True).status_code == 200
    assert decide(halcyon, approve=False, reason="Too wide.", code="C-002").status_code == 200
    log_in(halcyon.client, "arif@example.com")
    assert launch(halcyon).status_code == 202

    found = rows(halcyon)

    assert found["C-001"]["approved_by"] == "Nadia"
    run = found["C-001"]["last_run"]
    # Inline jobs (RUN_JOBS_INLINE, the tests) run the whole chain at once: planned, sent and
    # finished, against the mocked target that answers every attempt the same way.
    assert (run["number"], run["status"], run["trigger"]) == (1, "completed", "manual")
    # A refused scope names nobody as approver, and a campaign that never ran has no last run
    assert (found["C-002"]["approval_status"], found["C-002"]["approved_by"]) == ("rejected", None)
    assert found["C-002"]["last_run"] is None
    # The campaign's own id isn't part of the page's answer
    assert "id" not in found["C-001"]


def test_a_campaign_waiting_for_its_first_decision_names_nobody(halcyon):  # noqa: F811
    create(halcyon)

    found = rows(halcyon)["C-001"]

    assert (found["approval_status"], found["approved_by"], found["last_run"]) == (
        "awaiting_approval",
        None,
        None,
    )
