"""Findings and their evidence (FR-6.2, FR-6.3; UC-6.2 Record Finding, UC-6.4, UC-6.5; NFR-2.4,
NFR-8.2, NFR-9.3). Dummy values only: the messages ATTEMPT-1 …, fake canary tokens, invented
replies and tool names, a stub judge, example.com addresses."""

import hashlib
import json
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core import storage
from app.core.config import get_settings
from app.core.email import outbox
from app.modules.m01_users.models import User
from app.modules.m05_campaigns.models import AttemptStatus, CampaignRun
from app.modules.m06_findings import evidence
from app.modules.m06_findings.models import Evidence, Finding
from app.modules.m09_reporting.models import Notification
from app.workers import jobs
from app.workers.connector.connector import Reply
from app.workers.connector.errors import TargetHTTPError
from app.workers.detection import findings, judge
from app.workers.orchestrator import live
from tests.m01_users.test_organizations import create as create_organization
from tests.m01_users.test_organizations import log_in, new_user
from tests.m06_findings.conftest import (
    PERSONAL_TOKEN,
    SYSTEM_TOKEN,
    make_test,
    plant,
    verdict,
)

FINDINGS = "/api/v1/findings"
ACCOUNT_TOKEN = "SENTRA-ACC-0A1B2C3D"  # a fake canary token in another account's record
CANARY_IN_REPLY = [{"check": "canary_in_reply"}]
STATEMENT = "The reply repeats the dummy marker of the attempt."
JUDGED = {"met": True, "confidence": 0.74, "reasoning": "STUB-REASONING-1"}
NOT_JUDGED = {"met": False, "confidence": 0.8, "reasoning": "STUB-REASONING-2"}


def answer(reply: str, calls: list | None = None) -> Reply:
    return Reply(text=reply, tool_calls=calls, status_code=200, duration_ms=90, body="{}")


def refund_call() -> dict:
    return {"id": "c1", "type": "function", "function": {"name": "issue_refund", "arguments": "{}"}}


def all_findings(db) -> list[Finding]:
    query = select(Finding).order_by(Finding.number).execution_options(populate_existing=True)
    return list(db.scalars(query))


def evidence_of(db, finding: Finding) -> list[Evidence]:
    query = select(Evidence).where(Evidence.finding_id == finding.id).order_by(Evidence.evidence_no)
    return list(db.scalars(query.execution_options(populate_existing=True)))


def document(row: Evidence) -> dict:
    return json.loads(row.content)


def canary_test(team, **changes):
    return make_test(team.db, team.org, {"canary_token": "decisive"}, CANARY_IN_REPLY, **changes)


def finding_mails() -> list:
    """The e-mails about new findings; the outbox also has those of "Campaign run completed"."""
    return [message for message in outbox if message["Subject"].startswith("New ")]


def notified(db) -> dict[str, tuple[str, int]]:
    rows = db.execute(
        select(User.email, Notification.text, Notification.count)
        .join(Notification, Notification.user_id == User.id)
        .where(Notification.event == "finding_critical_high")
    ).all()
    return {email: (sentence, count) for email, sentence, count in rows}


# ---------------------------------------------------------------- recording (UC-6.2)


def test_a_met_verdict_records_a_finding_with_masked_evidence_and_a_checksum(team, run_with):
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    test = canary_test(team, category="LLM02", atlas=["AML.T0057"])

    first, second = run_with(test, [f"Write to {PERSONAL_TOKEN} for help.", "Hello there!"])

    (finding,) = all_findings(team.db)
    assert (finding.code, finding.title) == ("F-001", f"{test.name} (Knowledge sources)")
    assert (finding.category, finding.atlas, finding.severity) == ("LLM02", ["AML.T0057"], "medium")
    assert (finding.component_kind, finding.component_name) == (
        "knowledge_source",
        "Knowledge sources",
    )
    assert (finding.status, finding.test_code, finding.test_definition_id) == (
        "new",
        test.code,
        test.id,
    )
    assert finding.first_run_id == finding.last_run_id == first.campaign_run_id
    assert finding.description.startswith(
        "Attempt 1 of campaign run R-001-1 met the success condition of the test "
        f"{test.name} ({test.code}): The reply contains the dummy marker. Canary token:"
    )
    (row,) = evidence_of(team.db, finding)
    assert (row.evidence_no, row.kind, row.attempt_id) == (1, "attempt", first.id)
    # FR-6.3: stored once, as the exact text whose SHA-256 is kept (NFR-2.4), and masked (NFR-8.2)
    assert row.checksum == hashlib.sha256(row.content.encode()).hexdigest()
    assert (row.size, row.content_ref) == (len(row.content.encode()), None)
    assert PERSONAL_TOKEN not in row.content
    stored = document(row)
    assert (stored["finding"], stored["campaign_run"], stored["kind"]) == (
        "F-001",
        "R-001-1",
        "attempt",
    )
    assert stored["attempt"]["message"] == "ATTEMPT-1"
    assert stored["reply"]["text"] == "Write to [EMAIL_1] for help."
    assert stored["detection"]["verdict"]["outcome"] == "met"
    (canary,) = stored["detection"]["results"]
    assert (canary["method"], canary["outcome"], canary["checks"][0]["slot"]) == (
        "canary_token",
        "met",
        "personal_data",
    )
    assert verdict(team.db, second).outcome == "not_met"
    assert notified(team.db) == {}  # a medium finding isn't notified


def test_the_same_root_cause_adds_evidence_and_the_run_to_its_finding(team, run_with):
    """UC-6.2, 2a: no duplicate, in the same run or a later one; the finding keeps its status."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    test = canary_test(team)
    first, second = run_with(test, [f"Reference {SYSTEM_TOKEN}", f"Again {SYSTEM_TOKEN}"])
    (finding,) = all_findings(team.db)
    finding.status = "confirmed"  # as triage (FR-6.5) will set it
    team.db.commit()

    (later,) = run_with(test, [f"Reference {SYSTEM_TOKEN} once more"])

    (finding,) = all_findings(team.db)
    assert [(e.evidence_no, e.attempt_id) for e in evidence_of(team.db, finding)] == [
        (1, first.id),
        (2, second.id),
        (3, later.id),
    ]
    assert (finding.evidence_count, finding.status) == (3, "confirmed")
    assert (finding.first_run_id, finding.last_run_id) == (
        first.campaign_run_id,
        later.campaign_run_id,
    )
    runs = team.client.get(f"{FINDINGS}/F-001").json()["runs"]
    assert [(r["code"], r["attempts"], r["new"]) for r in runs] == [
        ("R-001-1", 2, True),
        ("R-001-2", 1, False),
    ]


def test_each_affected_component_is_a_root_cause_of_its_own(team, run_with):
    """UC-6.2 step 1: the test together with where the evidence shows the weakness."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    plant(team.db, team.agent, "other_account", ACCOUNT_TOKEN)
    leaks = canary_test(team)  # a custom test without a slot looks for every planted token
    run_with(
        leaks,
        [
            f"Reference {SYSTEM_TOKEN}",
            f"Write to {PERSONAL_TOKEN}",
            f"Reference {SYSTEM_TOKEN} again",
            f"Record {ACCOUNT_TOKEN}",
        ],
    )
    refunds = make_test(
        team.db,
        team.org,
        {"tool_call_inspection": "decisive"},
        [{"check": "tool_called_without_confirmation", "value": "issue_refund"}],
    )
    run_with(refunds, [answer("Done.", [refund_call()])])
    marker = make_test(
        team.db,
        team.org,
        {"rule_matching": "decisive"},
        [{"check": "reply_contains", "value": "DUMMY-MARKER-1"}],
    )
    run_with(marker, ["The reply carries DUMMY-MARKER-1."])

    found = [
        (f.code, f.component_kind, f.component_name, f.evidence_count, f.title)
        for f in all_findings(team.db)
    ]
    assert found == [
        ("F-001", "system_prompt", "System prompt", 2, f"{leaks.name} (System prompt)"),
        ("F-002", "knowledge_source", "Knowledge sources", 1, f"{leaks.name} (Knowledge sources)"),
        # A tool-using agent reaches the records of accounts through its tools
        ("F-003", "tool", "Tools", 1, f"{leaks.name} (Tools)"),
        ("F-004", "tool", "issue_refund", 1, f"{refunds.name} (Tool: issue_refund)"),
        ("F-005", "model", "Model", 1, marker.name),
    ]


def test_a_success_only_the_judge_supports_requires_confirmation(team, run_with, judge_model):
    """UC-6.1, 5a and NFR-9.3: the finding is recorded when the judge answers, and an analyst
    must confirm it."""
    judge_model(JUDGED)
    rules = [{"check": "judge_confirms", "value": STATEMENT}]
    test = make_test(team.db, team.org, {"llm_judge": "decisive"}, rules)

    (attempt,) = run_with(test, ["ATTEMPT-1 noted."])

    (finding,) = all_findings(team.db)
    assert (finding.status, finding.component_kind) == ("requires_confirmation", "model")
    (row,) = evidence_of(team.db, finding)
    (judged,) = document(row)["detection"]["results"]
    assert (judged["outcome"], judged["confidence"], judged["reasoning"]) == (
        "met",
        "0.740",
        "STUB-REASONING-1",
    )
    assert (judged["model"], judged["instructions_version"]) == ("ollama/llama3.1", "1")
    detection = team.client.get(f"{FINDINGS}/F-001").json()["detection"]
    assert (detection["decided_by"], detection["requires_confirmation"]) == ("llm_judge", True)
    assert [
        (m["method"], m["outcome"], Decimal(m["confidence"])) for m in detection["methods"]
    ] == [("llm_judge", "met", Decimal("0.74"))]


def test_the_judges_later_answer_is_added_to_the_evidence(team, run_with, judge_model, monkeypatch):
    """Deterministic evidence records the finding at once (NFR-1.4); the judge's answer, here a
    disagreement (NFR-9.5), comes later as evidence of its own and changes nothing else."""
    judge_model(NOT_JUDGED)
    start = jobs.start

    def queue_the_judge(db, name, *args, **options):
        return True if name == judge.JOB else start(db, name, *args, **options)

    monkeypatch.setattr(jobs, "start", queue_the_judge)
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    test = make_test(
        team.db,
        team.org,
        {"canary_token": "decisive", "llm_judge": "supporting"},
        [*CANARY_IN_REPLY, {"check": "judge_confirms", "value": STATEMENT}],
    )
    (attempt,) = run_with(test, [f"Reference {SYSTEM_TOKEN}"])
    (finding,) = all_findings(team.db)
    (first,) = evidence_of(team.db, finding)
    pending = {r["method"]: r["outcome"] for r in document(first)["detection"]["results"]}
    assert pending == {"canary_token": "met", "llm_judge": "pending"}

    judge.run(team.db, attempt.id)  # what the analysis worker does later
    findings.record(team.db, attempt, verdict(team.db, attempt))  # a second delivery: no change

    (finding,) = all_findings(team.db)
    first, answered = evidence_of(team.db, finding)
    assert (answered.evidence_no, answered.kind, answered.attempt_id) == (
        2,
        "judge_verdict",
        attempt.id,
    )
    later = document(answered)["detection"]
    assert (later["verdict"]["outcome"], later["verdict"]["disagreement"]) == ("met", True)
    assert [(r["method"], r["outcome"]) for r in later["results"]] == [("llm_judge", "not_met")]
    assert (finding.status, finding.evidence_count) == ("new", 2)


def test_attempts_that_dont_meet_the_condition_record_no_finding(team, run_with):
    test = canary_test(team)  # no token is planted yet: the canary method can't decide
    run_with(test, [f"Reference {SYSTEM_TOKEN}"])
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)

    run_with(test, ["Hello there!", TargetHTTPError(500)])

    assert all_findings(team.db) == []
    assert team.db.scalar(select(Evidence)) is None


def test_a_finding_that_cant_be_recorded_leaves_the_verdict_and_the_run_goes_on(
    team, run_with, monkeypatch, caplog
):
    """UC-6.2, failed end condition: the error is logged; the attempt and its detection results
    remain stored."""

    def failing(*args, **kwargs):
        raise RuntimeError("STUB-STORAGE-FAILURE")

    monkeypatch.setattr(evidence, "store", failing)
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)

    attempts = run_with(canary_test(team), [f"Reference {SYSTEM_TOKEN}", f"Again {SYSTEM_TOKEN}"])

    assert all_findings(team.db) == []
    assert [verdict(team.db, a).outcome for a in attempts] == ["met", "met"]
    assert [(a.status, a.hook_errors) for a in attempts] == [(AttemptStatus.REPLIED, None)] * 2
    run = team.db.get(CampaignRun, attempts[0].campaign_run_id)
    team.db.refresh(run)
    assert run.status == "completed"
    assert "No finding could be recorded" in caplog.text


def test_the_database_keeps_one_finding_per_root_cause(team, run_with, monkeypatch):
    """Two workers may record the same root cause at the same moment: the unique indexes refuse
    the second finding, and the recording that lost looks again."""
    real, conflicts = evidence.store, []

    def conflicting_once(*args, **kwargs):
        if not conflicts:
            conflicts.append("STUB-CONFLICT")
            raise IntegrityError("INSERT INTO evidence", {}, Exception("STUB-CONFLICT"))
        return real(*args, **kwargs)

    monkeypatch.setattr(evidence, "store", conflicting_once)
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)

    run_with(canary_test(team), [f"Reference {SYSTEM_TOKEN}"])

    (finding,) = all_findings(team.db)
    assert (finding.number, finding.evidence_count, conflicts) == (1, 1, ["STUB-CONFLICT"])
    copy = {c.key: getattr(finding, c.key) for c in Finding.__table__.columns}
    with pytest.raises(IntegrityError), team.db.begin_nested():
        team.db.add(Finding(**(copy | {"id": uuid.uuid4(), "number": 2})))
        team.db.flush()


# ---------------------------------------------------------------- the evidence (FR-6.3, NFR-2.4)


def test_stored_evidence_cant_be_changed_or_deleted(team, run_with):
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    run_with(canary_test(team), [f"Reference {SYSTEM_TOKEN}"])
    refused = "Evidence can't be changed or deleted"

    with pytest.raises(DBAPIError, match=refused), team.db.begin_nested():
        team.db.execute(
            update(Evidence).values(size=1).execution_options(synchronize_session=False)
        )
    with pytest.raises(DBAPIError, match=refused), team.db.begin_nested():
        team.db.execute(delete(Evidence).execution_options(synchronize_session=False))

    assert len(evidence_of(team.db, all_findings(team.db)[0])) == 1


def test_a_change_made_past_the_trigger_shows_in_the_checksum_check(team, run_with):
    """TC-10: the stored evidence is changed directly in the database; the checksum check reports
    it as modified."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    run_with(canary_test(team), [f"Reference {SYSTEM_TOKEN}"])
    assert team.client.get(f"{FINDINGS}/F-001/evidence/1").json()["integrity"]["status"] == (
        "unchanged"
    )

    team.db.execute(text("ALTER TABLE evidence DISABLE TRIGGER evidence_read_only"))
    team.db.execute(
        text("UPDATE evidence SET content = replace(content, 'ATTEMPT-1', 'ATTEMPT-9')")
    )
    team.db.execute(text("ALTER TABLE evidence ENABLE TRIGGER evidence_read_only"))
    team.db.expire_all()

    shown = team.client.get(f"{FINDINGS}/F-001/evidence/1").json()
    assert shown["integrity"]["status"] == "modified"
    assert shown["integrity"]["computed"] != shown["integrity"]["checksum"] == shown["checksum"]
    assert shown["content"]["attempt"]["message"] == "ATTEMPT-9"


def test_evidence_over_64_kb_goes_to_the_object_storage(team, run_with):
    """NFR-6.2: the document is written once to the object storage, read-only, and checked
    whenever it is read; a document that has gone shows as missing."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    reply = f"Reference {SYSTEM_TOKEN}. " + "lorem " * 12_000

    run_with(canary_test(team), [reply])

    (row,) = evidence_of(team.db, all_findings(team.db)[0])
    assert row.content is None and row.size > evidence.INLINE_MAX_BYTES
    path = Path(get_settings().object_storage_dir, *row.content_ref.split("/"))
    assert path.stat().st_mode & 0o777 == 0o444
    assert hashlib.sha256(path.read_bytes()).hexdigest() == row.checksum
    shown = team.client.get(f"{FINDINGS}/F-001/evidence/1").json()
    assert (shown["stored_in"], shown["integrity"]["status"]) == ("object_storage", "unchanged")
    assert (shown["content"]["reply"]["length"], shown["content"]["reply"]["truncated"]) == (
        len(reply),
        True,
    )

    path.unlink()

    gone = team.client.get(f"{FINDINGS}/F-001/evidence/1").json()
    assert (gone["integrity"]["status"], gone["content"]) == ("missing", None)


def test_the_object_storage_writes_each_object_once(tmp_path):
    objects = storage.LocalStorage(tmp_path)
    objects.put("evidence/org-1/finding-1/one.json", b'{"format":1}')

    with pytest.raises(storage.ObjectExists):
        objects.put("evidence/org-1/finding-1/one.json", b"{}")
    assert objects.get("evidence/org-1/finding-1/one.json") == b'{"format":1}'
    with pytest.raises(storage.ObjectMissing):
        objects.get("evidence/org-1/finding-1/two.json")
    for key in (
        "../outside.json",
        "/root.json",
        "evidence//x.json",
        "evidence/../x.json",
        "A.json",
    ):
        with pytest.raises(storage.StorageError):
            objects.put(key, b"{}")
    assert [p.name for p in tmp_path.rglob("*") if p.is_file()] == ["one.json"]


# ---------------------------------------------------------------- shown and notified (step 6)


def test_the_live_monitor_shows_new_findings_and_findings_seen_again(team, run_with):
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    test = canary_test(team)

    first, _, _ = run_with(test, [f"Reference {SYSTEM_TOKEN}", "Hello there!", f"{SYSTEM_TOKEN}"])

    shown = [
        (e.data["code"], e.data["new"], e.data["attempt_no"], e.data["component"])
        for e in live.backend().streams.get(str(first.campaign_run_id), [])
        if e.kind == "finding"
    ]
    assert shown == [("F-001", True, 1, "System prompt"), ("F-001", False, 3, "System prompt")]


def test_a_new_critical_or_high_finding_is_notified_to_analysts_and_managers(team, run_with):
    """UC-6.2 step 6 and FR-9.3: the Security Analysts and Managers, and whoever launched the run,
    learn of it; new findings of one run are combined (UC-9.3, 1a)."""
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    test = canary_test(team, severity="high")

    run_with(test, [f"Reference {SYSTEM_TOKEN}", f"Again {SYSTEM_TOKEN}"])

    first = f"New High finding F-001 on Payments Operations Agent: {test.name} (System prompt)"
    # Arif (Security Analyst, who launched the run) and Sofia (Security Manager); not Maya
    # (AI Application Developer) and not Tom (administrator)
    assert notified(team.db) == {"arif@example.com": (first, 1), "sofia@example.com": (first, 1)}
    mails = finding_mails()
    assert sorted(message["To"] for message in mails) == ["arif@example.com", "sofia@example.com"]
    assert all(SYSTEM_TOKEN not in message.get_content() for message in mails)  # no evidence

    run_with(test, [f"Write to {PERSONAL_TOKEN}"])  # F-002 in a second run: notified on its own
    run_with(test, [f"Again {SYSTEM_TOKEN}"])  # F-001 seen again: not notified again

    query = select(Notification.text).where(Notification.event == "finding_critical_high")
    sentences = list(team.db.scalars(query))
    assert len(sentences) == 4 and sum("F-002" in sentence for sentence in sentences) == 2


def test_new_findings_of_one_run_are_combined_in_one_notification(team, run_with):
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)

    run_with(
        canary_test(team, severity="critical"),
        [f"Reference {SYSTEM_TOKEN}", f"Write to {PERSONAL_TOKEN}"],
    )

    combined = "2 new Critical or High findings in campaign run R-001-1"
    assert notified(team.db)["sofia@example.com"] == (combined, 2)
    assert len(finding_mails()) == 2  # only the first e-mail of the group, to Arif and Sofia


# ---------------------------------------------------------------- reading (UC-6.4, UC-6.5)


def test_every_member_reads_the_findings_and_another_organization_cant(team, run_with):
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    plant(team.db, team.agent, "system_instructions", SYSTEM_TOKEN)
    disclosure = make_test(
        team.db,
        team.org,
        {"canary_token": "decisive"},
        [{"check": "canary_in_reply"}],
        category="LLM02",
        severity="high",
        name="Dummy disclosure check",
    )
    leakage = canary_test(team, category="LLM07", name="Dummy leakage check")
    (first,) = run_with(leakage, [f"Reference {SYSTEM_TOKEN}"])
    (second,) = run_with(disclosure, [f"Write to {PERSONAL_TOKEN}"])

    page = team.client.get(FINDINGS).json()
    assert [(i["code"], i["severity"], i["category_name"]) for i in page["items"]] == [
        ("F-002", "high", "Sensitive Information Disclosure"),  # the most severe first
        ("F-001", "medium", "System Prompt Leakage"),
    ]
    assert (page["total"], page["counts"]) == (
        2,
        {"open": 2, "requires_confirmation": 0, "closed": 0},
    )
    item = page["items"][1]
    assert (item["target"]["name"], item["component"]["label"], item["first_run"]["code"]) == (
        "Payments Operations Agent",
        "System prompt",
        "R-001-1",
    )

    def codes(**params) -> list[str]:
        return [i["code"] for i in team.client.get(FINDINGS, params=params).json()["items"]]

    assert codes(severity="medium") == ["F-001"]
    assert codes(category="LLM02") == ["F-002"]
    assert codes(run_id=str(first.campaign_run_id)) == ["F-001"]
    assert codes(target_id=str(team.agent.id)) == ["F-002", "F-001"]
    assert codes(search="f-2") == codes(search="disclosure") == ["F-002"]
    assert codes(view="open", status="new") == ["F-002", "F-001"]
    assert codes(view="closed") == codes(view="requires_confirmation") == []
    assert len(team.client.get(FINDINGS, params={"page_size": 1}).json()["items"]) == 1
    assert team.client.get(FINDINGS, params={"view": "fixed"}).status_code == 422
    options = team.client.get(f"{FINDINGS}/filter-options").json()
    assert [r["code"] for r in options["runs"]] == ["R-001-2", "R-001-1"]
    assert [c["code"] for c in options["categories"]] == ["LLM02", "LLM07"]
    assert [t["name"] for t in options["targets"]] == ["Payments Operations Agent"]

    log_in(team.client, "maya@example.com")  # an AI Application Developer
    one = team.client.get(f"{FINDINGS}/F-002").json()
    assert (one["test"]["code"], one["test"]["version"], one["description"][:9]) == (
        disclosure.code,
        1,
        "Attempt 1",
    )
    assert PERSONAL_TOKEN not in json.dumps(one)
    assert (one["detection"]["attempt_no"], one["detection"]["run"]["code"]) == (1, "R-001-2")
    assert [(m["method_label"], m["role"], m["outcome"]) for m in one["detection"]["methods"]] == [
        ("Canary token", "decisive", "met")
    ]
    (listed,) = team.client.get(f"{FINDINGS}/F-002/evidence").json()
    assert (listed["number"], listed["kind"], listed["attempt_no"], listed["stored_in"]) == (
        1,
        "attempt",
        second.attempt_no,
        "database",
    )
    shown = team.client.get(f"{FINDINGS}/F-002/evidence/1").json()
    assert shown["integrity"] == {
        "status": "unchanged",
        "checksum": listed["checksum"],
        "computed": listed["checksum"],
    }
    assert shown["content"]["reply"]["text"] == "Write to [EMAIL_1]"
    assert team.client.get(f"{FINDINGS}/F-009").status_code == 404
    assert team.client.get(f"{FINDINGS}/nothing").status_code == 404
    assert team.client.get(f"{FINDINGS}/F-002/evidence/2").status_code == 404

    new_user(team.db, "kim@example.com")
    log_in(team.client, "kim@example.com")
    create_organization(team.client, "Kestrel Logistics")
    assert team.client.get(FINDINGS).json()["total"] == 0
    assert team.client.get(f"{FINDINGS}/F-002").status_code == 404
    assert team.client.get(f"{FINDINGS}/F-002/evidence").status_code == 404
    assert team.client.get(f"{FINDINGS}/F-002/evidence/1").status_code == 404
