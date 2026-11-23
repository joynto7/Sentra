"""FR-9.4 (M9) CI/CD Security Gate: UC-9.4 Configure Security Gate and UC-9.5 Run Security Gate.

The gate runs the campaign of tests/m06_findings/conftest.py: no request leaves the tests, the
attempts carry the dummy messages ATTEMPT-1, ATTEMPT-2 …, and a stub sender answers them. What is
tested here is the door the key opens, the comparison with the last accepted run, the policy, and
the rule that a run which did not complete is never a pass.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m01_users.models import User
from app.modules.m05_campaigns import planning
from app.modules.m05_campaigns.models import Attempt, CampaignRun, RunStatus, RunTrigger
from app.modules.m06_findings.models import FindingStatus
from app.modules.m09_reporting import api_keys, gates
from app.modules.m09_reporting.models import (
    ApiKeyScope,
    GateRun,
    GateStatus,
    GateVerdict,
    Notification,
    SecurityGate,
)
from app.workers.orchestrator import send_loop
from tests.m01_users.test_organizations import log_in
from tests.m05_campaigns.conftest import StubSender, reply
from tests.m05_campaigns.test_campaigns import add_target
from tests.m06_findings.conftest import PERSONAL_TOKEN, plant
from tests.m07_risk.conftest import canary_test, findings_of, run_with, team  # noqa: F401

URL = "/api/v1/gates"
LATER = datetime.now(UTC) + timedelta(days=90)


def make_gate(team, **changes) -> dict:  # noqa: F811
    """UC-9.4 steps 1-3, as the Security Analyst does it."""
    data = {
        "name": "Release gate of the support agent",
        "campaign_code": "C-001",
        "fail_on": ["critical", "high"],
        "fail_on_reopened": True,
    } | changes
    answer = team.client.post(URL, json=data)
    assert answer.status_code == 201, answer.text
    return answer.json()


def key_for(team, *scopes, target_ids=None) -> str:  # noqa: F811
    """Step 4: an Organization Administrator makes the pipeline's key (UC-9.6)."""
    user = team.db.scalar(select(User).where(User.email == "tom@example.com"))
    _, raw = api_keys.create(
        team.db,
        organization_id=team.org,
        user=user,
        name="Release pipeline",
        purpose="The release pipeline of the support agent",
        scopes=[one.value for one in scopes],
        target_ids=target_ids or [],
        expires_at=LATER,
    )
    team.db.commit()
    return raw


def headers(key: str) -> dict:
    return {"authorization": f"Bearer {key}"}


@pytest.fixture
def pipeline(team, monkeypatch):  # noqa: F811
    """The gate as a pipeline calls it: `pipeline(key, answers)` starts a gate run whose campaign
    run answers with `answers`, and gives back the gate run as the API reports it."""

    def call(key: str, definition, answers: list, gate: str = "G-001", **build):
        def plan(db, run, target) -> planning.Plan:
            result = planning.Plan(templates={"file": "stub", "entries": {}})
            result.tests.append(
                {
                    "code": definition.code,
                    "version": definition.version,
                    "name": definition.name,
                    "suites": [],
                    "template": "stub",
                    "status": "planned",
                    "reason": None,
                    "attempts": len(answers),
                }
            )
            for number in range(1, len(answers) + 1):
                attempt = Attempt(
                    organization_id=run.organization_id,
                    campaign_run_id=run.id,
                    attempt_no=number,
                    test_definition_id=definition.id,
                    test_code=definition.code,
                    template="stub",
                    variant=1,
                    input=f"ATTEMPT-{number}",
                    session_id=f"session-{number}",
                )
                db.add(attempt)
                result.attempts.append(attempt)
            return result

        def answer(attempt):
            given = answers[attempt.attempt_no - 1]
            return reply(given) if isinstance(given, str) else given

        monkeypatch.setattr(planning, "plan", plan)
        monkeypatch.setattr(send_loop, "send_attempts", StubSender(answer))
        started = team.client.post(f"{URL}/{gate}/runs", json=build or {}, headers=headers(key))
        assert started.status_code == 202, started.text
        number = started.json()["number"]
        team.db.expire_all()
        read = team.client.get(f"{URL}/{gate}/runs/{number}", headers=headers(key))
        assert read.status_code == 200, read.text
        return read.json()

    return call


# ---------------------------------------------------------------- UC-9.4


def test_a_gate_is_saved_for_a_campaign_with_its_policy(team):  # noqa: F811
    """Steps 1-3: the gate names the campaign it runs, says what fails a release, and shows the
    identifier the pipeline then calls."""
    created = make_gate(team)

    assert created["code"] == "G-001" and created["campaign_code"] == "C-001"
    assert created["fail_on"] == ["critical", "high"] and created["fail_on_reopened"] is True
    assert created["policy_words"] == (
        "fail if a new finding of severity Critical or High appears, or a fixed finding comes back"
    )
    assert created["status"] == GateStatus.ACTIVE and created["baseline_run_code"] is None
    entry = team.db.scalars(
        select(AuditLogEntry).where(AuditLogEntry.action == "gate.created")
    ).first()
    assert entry is not None and entry.item_label == "G-001"


def test_a_gate_without_a_severity_to_fail_on_is_refused(team):  # noqa: F811
    """Step 2: a gate that fails on nothing would let every release through."""
    answer = team.client.post(URL, json={"name": "Empty", "campaign_code": "C-001", "fail_on": []})

    assert answer.status_code == 422
    assert answer.json()["error"]["details"][0]["field"] == "fail_on"


def test_one_gate_per_campaign(team):  # noqa: F811
    """Two gates of one campaign would compare their releases with each other's runs."""
    make_gate(team)

    again = team.client.post(URL, json={"name": "Second", "campaign_code": "C-001"})

    assert again.status_code == 409
    assert again.json()["error"]["code"] == "campaign_already_a_gate"


def test_only_an_analyst_configures_a_gate_but_everybody_reads_it(team):  # noqa: F811
    """UC-9.4's actor (FR-1.6): a developer runs the pipeline and has to see what blocked their
    release, but the policy is the analyst's to write."""
    make_gate(team)
    log_in(team.client, "maya@example.com")

    assert team.client.post(URL, json={"name": "Mine", "campaign_code": "C-001"}).status_code == 403
    assert team.client.patch(f"{URL}/G-001", json={"fail_on": ["low"]}).status_code == 403
    read = team.client.get(URL)
    assert read.status_code == 200 and read.json()["rows"][0]["code"] == "G-001"
    assert team.client.get(f"{URL}/G-001").status_code == 200


def test_the_policy_can_be_changed_and_the_gate_paused(team):  # noqa: F811
    make_gate(team)

    changed = team.client.patch(
        f"{URL}/G-001", json={"fail_on": ["critical"], "status": GateStatus.PAUSED}
    )

    assert changed.status_code == 200
    assert changed.json()["fail_on"] == ["critical"] and changed.json()["status"] == "paused"
    assert (
        team.db.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "gate.changed")).first()
        is not None
    )


# ---------------------------------------------------------------- UC-9.5: the door (2a1)


def test_a_call_without_a_key_never_reaches_the_gate(team):  # noqa: F811
    """Quality requirement 4: the two run endpoints are the only ones a key may use, and they
    need the scope that belongs to them."""
    make_gate(team)
    log_in(team.client, "maya@example.com")  # a session without the gate permission
    team.client.cookies.clear()

    assert team.client.post(f"{URL}/G-001/runs", json={}).status_code == 401
    assert team.client.get(f"{URL}/G-001/runs/1").status_code == 401


def test_a_key_without_the_scope_is_refused_with_the_reason(team):  # noqa: F811
    """2a1: the key is valid but may not run a gate."""
    make_gate(team)
    only_reads = key_for(team, ApiKeyScope.READ_FINDINGS)
    team.client.cookies.clear()

    refused = team.client.post(f"{URL}/G-001/runs", json={}, headers=headers(only_reads))

    assert refused.status_code == 401
    assert refused.json()["error"]["code"] == "scope_missing"


def test_a_key_limited_to_other_targets_may_not_run_the_gate(team, db):  # noqa: F811
    """FR-9.5: the key's target limit holds for the gate as well."""
    make_gate(team)
    another = add_target(db, team.org, name="A different application")
    elsewhere = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, target_ids=[another.id])
    team.client.cookies.clear()

    refused = team.client.post(f"{URL}/G-001/runs", json={}, headers=headers(elsewhere))

    assert refused.status_code == 403
    assert refused.json()["error"]["code"] == "target_not_allowed"


def test_a_paused_gate_is_not_run(team):  # noqa: F811
    make_gate(team)
    team.client.patch(f"{URL}/G-001", json={"status": GateStatus.PAUSED})
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE)
    team.client.cookies.clear()

    refused = team.client.post(f"{URL}/G-001/runs", json={}, headers=headers(key))

    assert refused.status_code == 409 and refused.json()["error"]["code"] == "gate_paused"


# ---------------------------------------------------------------- UC-9.5: the verdict


def test_the_first_completed_run_becomes_the_baseline(team, pipeline):  # noqa: F811
    """UC-9.4's success end condition: the first run says what the application has today, and the
    next release is compared with it."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    team.client.cookies.clear()

    result = pipeline(
        key, canary_test(team), [f"Write to {PERSONAL_TOKEN} for help."], build_ref="release/1"
    )

    assert result["verdict"] == GateVerdict.PASSED
    assert "baseline" in result["message"]
    assert result["build_ref"] == "release/1" and result["compared_with"] is None
    gate = team.db.scalar(select(SecurityGate))
    assert gate.baseline_run_id is not None


def test_a_new_finding_of_a_severity_in_the_policy_fails_the_release(team, pipeline, db):  # noqa: F811
    """5a: the second release brings a weakness the baseline did not have, so the gate fails and
    names it; 5a1: the people who have to act on it are told."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    first = canary_test(team)
    team.client.cookies.clear()
    pipeline(key, first, ["nothing to see here"])  # the baseline: no finding at all

    second = canary_test(team, code="SID-NEW-002", name="A weakness of the new release")
    result = pipeline(key, second, [f"Write to {PERSONAL_TOKEN} for help."], build_ref="release/2")

    assert result["verdict"] == GateVerdict.FAILED
    assert result["breaking"] and result["breaking"][0]["why"] == "new"
    assert result["compared_with"] is not None
    told = db.scalars(select(Notification).where(Notification.event == "gate_failed")).all()
    assert told, "the gate that blocked a release tells the people who have to act on it"
    assert (
        db.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "gate.run_failed")).first()
        is not None
    )


def test_a_finding_the_baseline_already_had_does_not_fail_the_release(team, pipeline):  # noqa: F811
    """Step 4: the gate asks what is new, not what is there — a known weakness blocks nothing."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    test = canary_test(team)
    team.client.cookies.clear()
    pipeline(key, test, [f"Write to {PERSONAL_TOKEN} for help."])  # the baseline has it

    again = pipeline(key, test, [f"Write to {PERSONAL_TOKEN} for help."], build_ref="release/2")

    assert again["verdict"] == GateVerdict.PASSED
    assert again["new_findings"] == []


def test_a_finding_an_analyst_called_a_false_positive_no_longer_counts(team, pipeline, db):  # noqa: F811
    """5b and 5b1: the finding is triaged away, so the pipeline passes the next time."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    team.client.cookies.clear()
    pipeline(key, canary_test(team), ["nothing to see here"])
    second = canary_test(team, code="SID-NEW-003", name="The one the analyst dismisses")
    blocked = pipeline(key, second, [f"Write to {PERSONAL_TOKEN} for help."])
    assert blocked["verdict"] == GateVerdict.FAILED

    for finding in findings_of(db):
        finding.status = FindingStatus.FALSE_POSITIVE
    db.commit()
    again = pipeline(key, second, [f"Write to {PERSONAL_TOKEN} for help."], build_ref="release/3")

    assert again["verdict"] == GateVerdict.PASSED
    assert again["breaking"] == []


def test_a_run_that_did_not_complete_is_an_error_and_never_a_pass(team, pipeline, db):  # noqa: F811
    """Quality requirement 2: the run was stopped, so Sentra cannot say the release is safe."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    team.client.cookies.clear()
    result = pipeline(key, canary_test(team), [f"Write to {PERSONAL_TOKEN} for help."])
    assert result["verdict"] == GateVerdict.PASSED

    # The next run ends in any way but completed.
    gate_run = db.scalars(select(GateRun).order_by(GateRun.number.desc())).first()
    run = db.get(CampaignRun, gate_run.campaign_run_id)
    assert run.trigger == RunTrigger.API  # UC-9.5 step 2: a pipeline started it

    from app.modules.m09_reporting import gates

    stopped = GateRun(
        organization_id=team.org,
        gate_id=gate_run.gate_id,
        number=gate_run.number + 1,
        campaign_run_id=run.id,
    )
    db.add(stopped)
    db.flush()
    run.status = RunStatus.STOPPED
    decided = gates.decide(db, stopped, run)

    assert decided.verdict == GateVerdict.ERROR
    assert "did not complete" in decided.message or "not checked" in decided.message


def test_a_gate_run_that_could_not_start_is_a_failure_with_its_reason(team, pipeline, db):  # noqa: F811
    """UC-5.3, 4a reaches the pipeline as an error verdict, not as an exception it has to guess
    about, and the attempt is in the audit log."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    team.client.cookies.clear()
    pipeline(key, canary_test(team), [f"Write to {PERSONAL_TOKEN} for help."])
    # A run of the same campaign is in progress, so the next call cannot launch one.
    run = db.scalars(select(CampaignRun).order_by(CampaignRun.number.desc())).first()
    run.status = RunStatus.RUNNING
    run.finalized_at = None
    db.commit()

    refused = team.client.post(f"{URL}/G-001/runs", json={}, headers=headers(key))

    assert refused.status_code == 202
    answer = refused.json()
    assert answer["verdict"] == GateVerdict.ERROR and "in progress" in answer["message"]
    assert (
        db.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "gate.run_error")).first()
        is not None
    )


def test_every_gate_run_is_in_the_audit_log_with_its_build(team, pipeline, db):  # noqa: F811
    """Quality requirement 6: every release has its security history."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    team.client.cookies.clear()

    pipeline(
        key,
        canary_test(team),
        [f"Write to {PERSONAL_TOKEN} for help."],
        build_ref="release/7",
        build_commit="9f3c1a2",
    )

    started = db.scalars(
        select(AuditLogEntry).where(AuditLogEntry.action == "gate.run_started")
    ).first()
    assert started is not None
    assert started.details["build"] == "release/7" and started.details["commit"] == "9f3c1a2"
    assert started.actor_name == "Release pipeline"  # the key, not a person
    assert (
        db.scalars(select(AuditLogEntry).where(AuditLogEntry.action == "gate.run_passed")).first()
        is not None
    )


def test_the_results_of_a_gate_are_read_with_the_reading_scope(team, pipeline):  # noqa: F811
    """Step 5: the pipeline reads its own result, and a key that may only run the gate cannot."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    both = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    only_runs = key_for(team, ApiKeyScope.RUN_SECURITY_GATE)
    team.client.cookies.clear()
    pipeline(both, canary_test(team), [f"Write to {PERSONAL_TOKEN} for help."])

    assert team.client.get(f"{URL}/G-001/runs", headers=headers(both)).status_code == 200
    refused = team.client.get(f"{URL}/G-001/runs/1", headers=headers(only_runs))
    assert refused.status_code == 401 and refused.json()["error"]["code"] == "scope_missing"


# ---------------------------------------------------------------- what Screen 55 reads


def test_the_gate_says_what_each_run_sends(team):  # noqa: F811
    """Step 1 on the gate's page: the suites with the version a run fixes, the attempt budget and
    the scope approval of the campaign — what the developer has to see before trusting the gate."""
    make_gate(team)

    read = team.client.get(f"{URL}/G-001").json()

    assert read["target_environment"] == "staging"  # 1a: a gate belongs on staging
    assert read["attempt_budget"] == 10 and read["approval_status"] == "not_required"
    suites = {one["code"]: one for one in read["suites"]}
    assert set(suites) == {"LLM06-EXCESSIVE-AGENCY", "LLM01-PROMPT-INJECTION"}
    for suite in suites.values():
        assert suite["found"] and suite["version"] >= 1 and suite["test_count"] > 0
        assert suite["name"] and suite["name"] != suite["code"]


def test_the_campaigns_a_gate_can_be_made_of_say_what_they_would_run(team):  # noqa: F811
    """Step 1 and 1a1: the choice names the environment, so a campaign of a production target can
    be recommended against before the gate exists."""
    offered = team.client.get(URL).json()["campaigns"]

    assert [one["code"] for one in offered] == ["C-001"]
    assert offered[0]["target_environment"] == "staging" and offered[0]["suite_count"] == 2
    assert offered[0]["attempt_budget"] == 10 and offered[0]["approval_status"] == "not_required"


def test_a_release_keeps_the_policy_it_was_judged_by(team, pipeline, db):  # noqa: F811
    """Quality requirement 2: every gate run records the policy it was evaluated against, so a
    result stays explainable after an analyst has changed the gate's policy."""
    make_gate(team)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    team.client.cookies.clear()
    judged = pipeline(key, canary_test(team), ["nothing to see here"])
    assert judged["policy_words"] == (
        "fail if a new finding of severity Critical or High appears, or a fixed finding comes back"
    )

    log_in(team.client, "arif@example.com")
    changed = team.client.patch(
        f"{URL}/G-001", json={"fail_on": ["low"], "fail_on_reopened": False}
    )
    assert changed.status_code == 200

    gate = team.client.get(f"{URL}/G-001").json()
    assert gate["policy_words"] == "fail if a new finding of severity Low appears"
    assert gate["runs"][0]["policy_words"] == judged["policy_words"], (
        "the release was judged before the change and still says so"
    )
    row = db.scalar(select(GateRun).where(GateRun.number == judged["number"]))
    assert row.fail_on == ["critical", "high"] and row.fail_on_reopened is True


def test_a_release_is_judged_by_the_policy_of_its_own_run(team, pipeline, db):  # noqa: F811
    """Quality requirement 2, the half the page shows: a verdict is decided when the campaign run
    ends, which can be after an analyst has changed the policy. `decide()` therefore reads the
    gate run's own copy, so a tightened policy judges the next release and not this one."""
    make_gate(team)  # Critical or High, and a fixed finding that comes back
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    key = key_for(team, ApiKeyScope.RUN_SECURITY_GATE, ApiKeyScope.READ_GATE_RESULTS)
    team.client.cookies.clear()
    pipeline(key, canary_test(team), ["nothing to see here"])  # the baseline, without a finding
    second = canary_test(team, code="SID-NEW-004", name="A weakness of the new release")
    blocked = pipeline(key, second, [f"Write to {PERSONAL_TOKEN} for help."])
    assert blocked["verdict"] == GateVerdict.FAILED

    # The same campaign run, decided again the way the run engine does it when a run ends, but as
    # a release that had started while the gate still failed on Low findings only.
    gate = db.scalar(select(SecurityGate))
    started = db.scalar(select(GateRun).where(GateRun.number == blocked["number"]))
    run = db.get(CampaignRun, started.campaign_run_id)
    lenient = GateRun(
        organization_id=team.org,
        gate_id=gate.id,
        number=blocked["number"] + 1,
        campaign_run_id=run.id,
        fail_on=["low"],
        fail_on_reopened=False,
    )
    db.add(lenient)
    db.flush()
    gates.decide(db, lenient, run)

    assert lenient.verdict == GateVerdict.PASSED, "judged by its own policy, which Low alone fails"
    assert [one["code"] for one in lenient.new_findings] == [
        one["code"] for one in blocked["new_findings"]
    ], "the same findings are reported as new; only the policy that judges them differs"
    assert lenient.breaking == [] and gate.fail_on == ["critical", "high"]
