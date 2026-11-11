"""What Screen 40 reads of a finding (UC-6.5 steps 3-5, UC-6.3): the attempts its
reproducibility score counts, by campaign run, and evidence the retention clean-up of FR-10.5 (M10)
has deleted (4a).
Dummy values only: the messages ATTEMPT-1 …, a fake canary token and invented replies.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.modules.m06_findings import reproducibility
from app.modules.m06_findings.models import Finding
from app.modules.m07_risk import rating
from app.modules.m10_admin import retention
from tests.m01_users.test_organizations import create, log_in, new_user
from tests.m05_campaigns.conftest import configure
from tests.m05_campaigns.test_campaigns import add_target
from tests.m06_findings.conftest import SYSTEM_TOKEN, make_test, plant
from tests.m09_reporting.test_api_keys import make as make_key

FINDINGS = "/api/v1/findings"
MET = f"My instructions say {SYSTEM_TOKEN}."  # an invented reply with the fake token
NOT_MET = "I can't share that."


def leak(team):
    """A test whose canary-token method decides, and the fake token planted on the target."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    return make_test(
        team.db, team.org, {"canary_token": "decisive"}, [{"check": "canary_in_reply"}]
    )


def the_finding(db) -> Finding:
    query = select(Finding).order_by(Finding.number).execution_options(populate_existing=True)
    return db.scalars(query).first()


def test_the_score_lists_every_attempt_it_counts_and_the_evidence_of_each_success(team, run_with):
    """UC-6.3 steps 1-4 on Screen 40: the attempt that found the weakness, then its repetitions,
    each met or not, and each success with the evidence that proves it. They are exactly the
    attempts the severity rating counts (FR-7.1, M7), so the page and the score never disagree."""
    configure(team.db, repetitions=5)
    run_with(leak(team), [MET, MET, NOT_MET, MET, NOT_MET], planned=1)

    body = team.client.get(f"{FINDINGS}/F-001/reproducibility").json()

    assert (body["attempts"], body["successes"], body["rate"], body["shown"]) == (5, 3, "0.600", 5)
    (group,) = body["runs"]
    assert group["run"]["code"] == "R-001-1"
    assert (group["measurement"]["status"], group["measurement"]["wanted"]) == ("complete", 5)
    rows = group["attempts"]
    assert [row["position"] for row in rows] == [1, 2, 3, 4, 5]
    assert [row["outcome"] for row in rows] == ["met", "met", "not_met", "met", "not_met"]
    assert [row["success"] for row in rows] == [True, True, False, True, False]
    assert [row["repeat"] for row in rows] == [False, True, True, True, True]
    assert [row["evidence"] and row["evidence"]["number"] for row in rows] == [1, 2, None, 3, None]
    assert {row["evidence"]["finding"] for row in rows if row["evidence"]} == {"F-001"}
    # The rating counts the same attempts, and the header of the finding's pages shows them
    factors = rating.factors_of(team.db, the_finding(team.db))
    assert (factors.successes, factors.attempts) == (3, 5)
    detail = team.client.get(f"{FINDINGS}/F-001").json()
    assert detail["counted"] == {"attempts": 5, "successes": 3}
    assert detail["evidence_deleted"] is None


def test_a_later_run_adds_its_attempts_under_its_own_run(team, run_with):
    """UC-6.2, 2a: the weakness seen again in a later run adds that run's attempts to the score;
    the page groups them by run and keeps numbering them."""
    test = leak(team)
    run_with(test, [MET])
    run_with(test, [NOT_MET, MET])

    body = team.client.get(f"{FINDINGS}/F-001/reproducibility").json()

    assert [group["run"]["code"] for group in body["runs"]] == ["R-001-1", "R-001-2"]
    assert [[row["position"] for row in group["attempts"]] for group in body["runs"]] == [
        [1],
        [2, 3],
    ]
    assert [[row["success"] for row in group["attempts"]] for group in body["runs"]] == [
        [True],
        [False, True],
    ]
    assert (body["successes"], body["attempts"]) == (2, 3)


def test_a_measurement_cut_short_says_why(team, run_with):
    """2a1: the attempt budget had no room for every repetition, so the run's measurement is
    incomplete and gives its reason with the attempts it did measure."""
    configure(team.db, repetitions=5, attempt_budget=3)
    run_with(leak(team), [MET], planned=1)

    body = team.client.get(f"{FINDINGS}/F-001/reproducibility").json()

    (group,) = body["runs"]
    assert group["measurement"]["status"] == "incomplete"
    assert group["measurement"]["reason"] == reproducibility.NO_BUDGET
    assert len(group["attempts"]) == body["attempts"] == 3


def test_deleted_evidence_says_when_and_after_which_period(team, run_with):
    """UC-6.5, 4a: the retention clean-up deleted the finding's evidence at the end of its period.
    The finding stays, its attempts stay for the longer period of campaign data, and the page can
    say when the evidence went and with which period."""
    configure(team.db, repetitions=2)
    run_with(leak(team), [MET], planned=1)
    after = datetime.now(UTC) + timedelta(days=200)  # past the 180 days of evidence, not 365

    done = retention.clean_up(team.db, team.org, at=after)

    assert done.evidence.items == 2 and done.attempts.items == 0
    detail = team.client.get(f"{FINDINGS}/F-001").json()
    assert detail["evidence_count"] == 0
    deleted = detail["evidence_deleted"]
    assert (deleted["count"], deleted["days"]) == (2, 180)
    assert datetime.fromisoformat(deleted["on"]) == after
    assert team.client.get(f"{FINDINGS}/F-001/evidence").json() == []
    # The attempts are still there; what proved them is not
    body = team.client.get(f"{FINDINGS}/F-001/reproducibility").json()
    assert body["attempts"] == 2
    assert all(row["evidence"] is None for row in body["runs"][0]["attempts"])


def test_another_organization_gets_not_found(team, run_with):
    """NFR-3.3: the attempts of a finding are its organization's only."""
    run_with(leak(team), [MET])

    new_user(team.db, "rival@example.com")
    log_in(team.client, "rival@example.com")
    create(team.client, "Kestrel Logistics")

    assert team.client.get(f"{FINDINGS}/F-001/reproducibility").status_code == 404


def test_a_key_limited_to_other_targets_gets_not_found(team, run_with):
    """FR-9.5 (M9), UC-9.6 step 2: an API key reads the attempts of its own targets' findings only,
    as it reads their evidence."""
    run_with(leak(team), [MET])
    elsewhere = add_target(team.db, team.org, name="Another agent")
    log_in(team.client, "tom@example.com")
    allowed = make_key(team.client, target_ids=[str(team.agent.id)])
    other = make_key(team.client, target_ids=[str(elsewhere.id)])
    team.client.cookies.clear()

    def read_with(key: dict) -> int:
        headers = {"Authorization": f"Bearer {key['key']}"}
        return team.client.get(f"{FINDINGS}/F-001/reproducibility", headers=headers).status_code

    assert read_with(allowed) == 200
    assert read_with(other) == 404  # another target's finding stays out of reach
