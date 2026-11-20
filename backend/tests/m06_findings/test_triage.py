"""Triage of findings and the merging of duplicates (FR-6.5, FR-6.6; UC-6.6 Triage Finding,
UC-6.2 2b1). Dummy values only: the messages ATTEMPT-1 …, fake canary tokens and invented replies.

The findings come from real campaign runs of the stub sender, so what is triaged here is what the
Detection Engine recorded.
"""

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.exc import DBAPIError

from app.modules.m01_users.models import User
from app.modules.m06_findings.models import Finding, FindingEvent, FindingStatus
from app.modules.m07_risk.models import RiskScore
from app.modules.m09_reporting.models import Notification
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import membership_of
from tests.m06_findings.conftest import SYSTEM_TOKEN, make_test, plant

FINDINGS = "/api/v1/findings"
CANARY_IN_REPLY = [{"check": "canary_in_reply"}]


def url(code: str = "F-001", path: str = "") -> str:
    return f"{FINDINGS}/{code}{path}"


def canary_test(team, **changes):
    """A custom test whose canary-token method decides, as in the detection tests."""
    return make_test(team.db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY, **changes)


def finding_of(db, code: str = "F-001") -> Finding:
    number = int(code.removeprefix("F-"))
    query = select(Finding).where(Finding.number == number)
    return db.scalar(query.execution_options(populate_existing=True))


def history(team, code: str = "F-001") -> list[dict]:
    response = team.client.get(url(code, "/history"))
    assert response.status_code == 200, response.text
    return response.json()


def kinds(team, code: str = "F-001") -> list[str]:
    return [entry["kind"] for entry in history(team, code)]


def scores(db, trigger: str = "triage") -> list[RiskScore]:
    query = select(RiskScore).where(RiskScore.trigger == trigger).order_by(RiskScore.calculated_at)
    return list(db.scalars(query.execution_options(populate_existing=True)))


def notifications(db, email: str, event: str) -> list[str]:
    user_id = membership_of(db, email).user_id
    rows = db.scalars(
        select(Notification.text).where(
            Notification.user_id == user_id, Notification.event == event
        )
    )
    return list(rows)


def details(response) -> dict[str, str]:
    return {d["field"]: d["message"] for d in response.json()["error"]["details"]}


def maya(db) -> User:
    return db.get(User, membership_of(db, "maya@example.com").user_id)


@pytest.fixture
def found(team, run_with):
    """Halcyon Bank's finding F-001, recorded by a real campaign run: the canary token of the
    system instructions came back in a reply. Arif, a Security Analyst, is logged in."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    team.test = canary_test(team, severity="medium")
    team.again = lambda: run_with(team.test, [f"It says {SYSTEM_TOKEN}.", "Hello there!"])
    team.again()
    team.agent.created_by_id = maya(team.db).id  # Maya registered the target (UC-6.6 step 4)
    team.db.commit()
    assert finding_of(team.db).status == FindingStatus.NEW
    return team


# ---------------------------------------------------------------- the history (FR-6.5)


def test_the_history_starts_when_sentra_records_the_finding(found):
    (entry,) = history(found)

    assert (entry["kind"], entry["actor"], entry["by_sentra"]) == ("detected", "Sentra", True)
    assert (entry["number"], entry["run"], entry["became"]) == (1, "R-001-1", "new")
    assert entry["text"] == (
        "Attempt 1 of campaign run R-001-1 met the success condition of "
        f"{finding_of(found.db).test_code}."
    )


def test_the_history_cannot_be_changed_or_deleted(found):
    row = found.db.scalar(select(FindingEvent))

    for statement in (
        update(FindingEvent).where(FindingEvent.id == row.id).values(text="something else"),
        delete(FindingEvent).where(FindingEvent.id == row.id),
    ):
        with pytest.raises(DBAPIError) as refused:
            found.db.execute(statement)
        assert "can't be changed or deleted" in str(refused.value)
        found.db.rollback()


# ---------------------------------------------------------------- triage (UC-6.6)


def test_an_analyst_triages_a_finding_in_one_save(found):
    owner = maya(found.db)

    response = found.client.post(
        url(path="/triage"),
        json={
            "decision": "confirm",
            "severity": "high",
            "justification": "The leaked instructions name the internal approval limits.",
            "owner_id": str(owner.id),
            "comment": "Reproduced by hand on the staging endpoint.",
        },
    )

    body = response.json()
    assert response.status_code == 200, response.text
    assert (body["status"], body["severity"]) == ("confirmed", "high")
    assert body["owner"]["name"] == "Maya"
    assert body["confirmed_by"] == "Arif"
    assert (body["severity_adjusted"], body["calculated_severity"]) == (True, "medium")
    assert body["severity_justification"].startswith("The leaked instructions")
    # UC-6.6 step 5: every action of the save is its own entry, in the order of the use case
    assert kinds(found) == ["detected", "confirmed", "severity_adjusted", "assigned", "commented"]
    entries = {entry["kind"]: entry for entry in history(found)}
    assert entries["confirmed"]["actor"] == "Arif"
    assert (entries["severity_adjusted"]["was"], entries["severity_adjusted"]["became"]) == (
        "medium",
        "high",
    )
    assert entries["assigned"]["user"] == "Maya"
    assert entries["commented"]["text"] == "Reproduced by hand on the staging endpoint."
    # Step 6: the owner is told and the target's risk score is calculated again (FR-7.2)
    told = notifications(found.db, "maya@example.com", "finding_assigned")
    assert told == ["Arif assigned F-001 to you: " + body["title"] + " (High, confirmed)"]
    assert [score.trigger for score in scores(found.db)] == ["triage"]
    assert scores(found.db)[-1].counted_codes == ["F-001"]


def test_the_audit_log_holds_every_triage_action(found):
    from app.core.audit import AuditLogEntry

    found.client.post(
        url(path="/triage"),
        json={"decision": "confirm", "owner_id": str(maya(found.db).id), "comment": "Checked."},
    )

    actions = list(
        found.db.scalars(
            select(AuditLogEntry.action)
            .where(AuditLogEntry.action.like("finding.%"))
            .order_by(AuditLogEntry.seq)
        )
    )
    assert actions == ["finding.confirmed", "finding.assigned", "finding.commented"]


def test_a_false_positive_is_closed_with_its_reason(found):
    response = found.client.post(
        url(path="/triage"),
        json={
            "decision": "false_positive",
            "reason": "The marker was in the question itself, not in the assistant's reply.",
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert (body["status"], body["closed_by"]) == ("false_positive", "Arif")
    assert body["close_reason"].startswith("The marker was in the question")
    assert kinds(found) == ["detected", "false_positive"]
    # 2a1: it is kept, and the risk score no longer counts it (FR-7.2)
    assert finding_of(found.db) is not None
    assert scores(found.db)[-1].counted_codes == []


def test_a_false_positive_needs_a_reason(found):
    response = found.client.post(url(path="/triage"), json={"decision": "false_positive"})

    assert response.status_code == 422
    assert details(response) == {"reason": "Give the reason why this is a false positive."}
    assert finding_of(found.db).status == FindingStatus.NEW


def test_a_severity_change_needs_a_justification(found):
    response = found.client.post(url(path="/triage"), json={"severity": "low"})

    assert response.status_code == 422
    assert details(response) == {"justification": "Say why you are changing the severity."}
    assert finding_of(found.db).severity_adjusted is False


def test_an_adjusted_severity_is_never_overwritten_by_the_rating(found):
    """UC-7.1, 4a1: the analyst's severity stays and the calculated one is shown beside it, so
    that the adjustment can be reviewed (FR-6.5)."""
    found.client.post(
        url(path="/triage"),
        json={"severity": "low", "justification": "Only the test marker leaked, nothing real."},
    )
    calculated = finding_of(found.db).calculated_severity

    found.again()  # a second campaign run rates the finding again at its end

    finding = finding_of(found.db)
    assert (finding.severity, finding.severity_adjusted) == ("low", True)
    assert finding.calculated_severity == calculated
    assert kinds(found).count("severity_adjusted") == 1


def test_only_an_analyst_may_triage_and_every_member_may_read_the_history(found):
    log_in(found.client, "maya@example.com")  # an AI Application Developer (FR-1.6)

    refused = found.client.post(url(path="/triage"), json={"decision": "confirm"})
    options = found.client.get(url(path="/triage"))
    readable = found.client.get(url(path="/history"))

    assert (refused.status_code, options.status_code) == (403, 403)
    assert readable.status_code == 200
    assert finding_of(found.db).status == FindingStatus.NEW


def test_the_triage_options_suggest_the_owner_of_the_target(found):
    options = found.client.get(url(path="/triage")).json()

    assert (options["status"], options["open"]) == ("new", True)
    assert (options["severity"], options["calculated_severity"]) == ("medium", "medium")
    assert options["suggested_owner"]["name"] == "Maya"
    assert options["suggested_owner"]["reason"] == "owner of Payments Operations Agent"
    assert {member["name"] for member in options["members"]} == {"Tom", "Arif", "Maya", "Sofia"}
    assert options["duplicates"] == []


def test_a_closed_finding_cannot_be_triaged(found):
    found.client.post(
        url(path="/triage"), json={"decision": "false_positive", "reason": "Not a real leak."}
    )

    response = found.client.post(url(path="/triage"), json={"decision": "confirm"})

    assert response.status_code == 409
    assert response.json()["error"]["message"] == (
        "F-001 is closed (false positive), so it can't be triaged."
    )


# ---------------------------------------------------------------- duplicates (FR-6.6)


def test_a_duplicate_is_merged_into_the_finding_it_duplicates(found, run_with):
    """UC-6.6, 2b1: the analyst judges two findings to be the same weakness. Evidence is written
    once and never moved (NFR-2.4), so the merge is a link and both are read together."""
    other = canary_test(found, severity="low", category="LLM02")
    plant(found.db, found.agent, "test_document", "SENTRA-DOC-0A1B2C3D")
    run_with(other, ["The document says SENTRA-DOC-0A1B2C3D.", "Hello there!"])
    assert finding_of(found.db, "F-002") is not None

    response = found.client.post(
        url("F-002", "/triage"),
        json={"decision": "merge", "merge_into": "F-001", "comment": "The same leak."},
    )

    merged = response.json()
    assert response.status_code == 200, response.text
    assert (merged["status"], merged["merged_into"]) == ("merged", "F-001")
    assert merged["close_reason"] == "Merged into F-001."
    assert kinds(found, "F-002") == ["detected", "merged", "commented"]
    # The finding it was merged into keeps its own status and now carries both histories and
    # both sets of evidence
    into = found.client.get(url("F-001")).json()
    assert (into["status"], into["merged_in"]) == ("new", ["F-002"])
    assert into["evidence_count"] == 2
    assert [(entry["finding"], entry["kind"]) for entry in history(found)] == [
        ("F-001", "detected"),
        ("F-002", "detected"),
        ("F-002", "merged"),
        ("F-001", "merged_in"),
        ("F-002", "commented"),
    ]
    rows = found.client.get(url("F-001", "/evidence")).json()
    assert [(row["finding"], row["number"]) for row in rows] == [("F-001", 1), ("F-002", 1)]
    # The risk score counts one finding instead of two (UC-6.6 step 6)
    assert scores(found.db)[-1].counted_codes == ["F-001"]


def test_a_merge_is_refused_when_the_other_finding_does_not_fit(found):
    refused = found.client.post(
        url(path="/triage"), json={"decision": "merge", "merge_into": "F-001"}
    )
    missing = found.client.post(
        url(path="/triage"), json={"decision": "merge", "merge_into": "F-404"}
    )
    nothing = found.client.post(url(path="/triage"), json={"decision": "merge"})

    assert refused.status_code == 422
    assert details(refused) == {"merge_into": "A finding can't be merged into itself."}
    assert details(missing) == {"merge_into": "No finding F-404 in this organization."}
    assert details(nothing) == {"merge_into": "Choose the finding this one duplicates."}
    assert finding_of(found.db).status == FindingStatus.NEW


# ---------------------------------------------------------------- regressions (UC-6.2, 2b)


def fixed(db, owner: User) -> Finding:
    """A finding that a retest had shown to be fixed (FR-8.5 brings the retest itself)."""
    finding = finding_of(db)
    finding.status = FindingStatus.FIXED_AND_VERIFIED
    finding.owner_id = owner.id
    db.commit()
    return finding


def test_a_fixed_finding_is_reopened_as_a_regression_and_its_owner_is_told(found):
    owner = maya(found.db)
    fixed(found.db, owner)

    found.again()  # the same root cause comes back in a later campaign run

    finding = finding_of(found.db)
    assert finding.status == FindingStatus.REOPENED  # no new confirmation is needed (Figure 2.6)
    assert finding.closed_at is None
    entry = history(found)[-1]
    assert entry["kind"] == "reopened"
    assert (entry["was"], entry["became"]) == ("fixed_and_verified", "reopened")
    assert (entry["actor"], entry["run"]) == ("Sentra", "R-001-2")
    assert entry["text"] == "The root cause was detected again in campaign run R-001-2."
    told = notifications(found.db, "maya@example.com", "finding_reopened")
    assert len(told) == 1
    assert told[0].startswith("F-001 is open again: campaign run R-001-2 found its root cause")


def test_a_false_positive_detected_again_keeps_its_status(found):
    found.client.post(
        url(path="/triage"),
        json={"decision": "false_positive", "reason": "The marker came from the question."},
    )

    found.again()

    finding = finding_of(found.db)
    assert finding.status == FindingStatus.FALSE_POSITIVE  # only the evidence is added (Figure 2.6)
    assert finding.evidence_count == 2
    assert "reopened" not in kinds(found)


# ---------------------------------------------------------------- the list (Screens 37 and 38)


def test_the_list_shows_the_owner_and_the_findings_assigned_to_me(found):
    owner = maya(found.db)
    found.client.post(url(path="/triage"), json={"decision": "confirm", "owner_id": str(owner.id)})

    page = found.client.get(FINDINGS).json()
    mine = found.client.get(f"{FINDINGS}?view=assigned").json()
    log_in(found.client, "maya@example.com")
    hers = found.client.get(f"{FINDINGS}?view=assigned").json()
    by_owner = found.client.get(f"{FINDINGS}?owner_id={owner.id}").json()

    assert page["items"][0]["owner"] == {"id": str(owner.id), "name": "Maya"}
    assert page["counts"]["assigned"] == 0  # Arif owns nothing
    assert mine["items"] == []
    assert [item["code"] for item in hers["items"]] == ["F-001"]
    assert hers["counts"]["assigned"] == 1
    assert [item["code"] for item in by_owner["items"]] == ["F-001"]
    options = found.client.get(f"{FINDINGS}/filter-options").json()
    assert options["owners"] == [{"id": str(owner.id), "name": "Maya"}]


def test_the_findings_of_a_run_say_what_they_were_in_it(found):
    owner = maya(found.db)
    fixed(found.db, owner)
    found.again()
    runs = found.client.get("/api/v1/campaigns/C-001/runs").json()
    second = next(run for run in runs if run["number"] == 2)

    page = found.client.get(f"{FINDINGS}?run_id={second['id']}").json()
    first = found.client.get(f"{FINDINGS}?run_id={runs[-1]['id']}").json()

    assert [item["in_run"] for item in page["items"]] == ["reopened"]
    assert page["in_run_counts"] == {"new": 0, "seen_again": 0, "reopened": 1}
    assert [item["in_run"] for item in first["items"]] == ["new"]
    assert first["in_run_counts"] == {"new": 1, "seen_again": 0, "reopened": 0}


def test_another_organization_sees_nothing_of_a_finding(found, client, db):
    from tests.m01_users.test_organizations import create as create_organization
    from tests.m01_users.test_organizations import new_user

    new_user(db, "rival@example.com")
    log_in(client, "rival@example.com")
    create_organization(client, "Kestrel Logistics")

    assert client.get(url()).status_code == 404
    assert client.get(url(path="/history")).status_code == 404
    assert client.post(url(path="/triage"), json={"decision": "confirm"}).status_code in (403, 404)
    assert client.get(FINDINGS).json()["items"] == []


def test_a_finding_the_judge_alone_supports_counts_only_once_confirmed(team, run_with, judge_model):
    """UC-6.6, quality requirement 2 (NFR-9.3): until an analyst confirms it, a finding that only
    the LLM judge supports is shown apart and the risk score doesn't count it (FR-7.2)."""
    judge_model({"met": True, "confidence": 0.81, "reasoning": "STUB-REASONING-1"})
    rules = [{"check": "judge_confirms", "value": "The reply repeats the dummy marker."}]
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, rules)
    run_with(test, ["ATTEMPT-1 noted."])
    before = scores(team.db, "campaign_run")[-1]
    assert (before.counted_codes, before.awaiting_confirmation) == ([], 1)

    response = team.client.post(url(path="/triage"), json={"decision": "confirm"})

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "confirmed"
    after = scores(team.db)[-1]
    assert (after.counted_codes, after.awaiting_confirmation) == (["F-001"], 0)
