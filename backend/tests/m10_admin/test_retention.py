"""FR-10.5 (M10) Data Retention: UC-10.7 Configure Data Retention with 3a and 4a, and UC-10.8
Delete Expired Data with 2a and 3a.

Dummy data only: the findings come from the fixtures of Module 6, whose attempts carry the
messages ATTEMPT-1, ATTEMPT-2 … and whose canary tokens are fake. Nothing here reaches a target.
Instead of moving timestamps backwards — stored evidence cannot be changed at all (NFR-2.4) — the
clean-up is asked what it would do at a date far enough in the future.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.core import storage
from app.core.audit import AuditLogEntry
from app.core.email import outbox
from app.modules.m01_users.models import User
from app.modules.m05_campaigns.models import Attempt, CampaignRun, RunStatus
from app.modules.m06_findings.models import Evidence, Finding
from app.modules.m07_risk.models import RiskScore
from app.modules.m09_reporting.models import Report
from app.modules.m10_admin import retention, schedules
from app.modules.m10_admin.models import RetentionRun, RetentionSettings
from tests.m01_users.test_organizations import PASSWORD, log_in, new_user
from tests.m06_findings.conftest import PERSONAL_TOKEN, plant
from tests.m07_risk.conftest import canary_test, findings_of, run_with, team  # noqa: F401

URL = "/api/v1/admin/retention"
ADMIN = "tom@example.com"  # the Organization Administrator of the fixture (UC-10.7's actor)
ANALYST = "arif@example.com"
LONG_AFTER = datetime.now(UTC) + timedelta(days=2000)
# Far enough for the campaign period to have run out, but inside every evidence period the
# platform allows (at most 1,095 days), so a test can keep the evidence and expire the attempts.
WHILE_EVIDENCE_IS_KEPT = datetime.now(UTC) + timedelta(days=100)
PERIODS = {"evidence_days": 90, "campaign_days": 365, "report_days": 730}


def with_data(team, run_with):  # noqa: F811
    """A completed campaign run of the fixtures: attempts, a finding with its evidence, and the
    risk score of Module 7."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    run_with(canary_test(team), [f"Write to {PERSONAL_TOKEN} for help."] * 2)
    return findings_of(team.db)[0]


def count(db, model, organization_id) -> int:
    return db.scalar(select(func.count(model.id)).where(model.organization_id == organization_id))


def as_admin(team, run_with):  # noqa: F811
    finding = with_data(team, run_with)
    log_in(team.client, ADMIN)
    return finding


# ---------------------------------------------------------------- UC-10.7


def test_an_organization_starts_with_the_platforms_periods(team, run_with):  # noqa: F811
    """Step 1: the periods and the amount stored of each type. An organization that has never set
    them uses the platform's defaults, so UC-10.8's precondition holds from its first day."""
    as_admin(team, run_with)

    shown = team.client.get(URL)

    assert shown.status_code == 200, shown.text
    body = shown.json()
    assert body["using_defaults"] is True and body["changed_by"] is None
    assert body["evidence"]["days"] == retention.DEFAULTS["evidence_days"]
    assert (body["evidence"]["minimum"], body["evidence"]["maximum"]) == (30, 1095)
    assert body["evidence"]["items"] > 0 and body["evidence"]["bytes"] > 0
    assert body["campaign"]["items"] > 0 and body["campaign"]["bytes"] > 0
    # NFR-8.3: the audit log is not one of the periods, and the page says how long it is kept.
    # The hour the page shows is the one Sentra's clock really keeps (celery_app.py's beat).
    assert body["audit_log_days"] == 365 and body["clean_up_at"] == "01:00 UTC"
    assert body["last_run"] is None


def test_the_periods_are_saved_and_recorded_but_nothing_is_deleted_yet(team, run_with, db):  # noqa: F811
    """Steps 5-6 and quality requirement 6: saving writes the periods and nothing else. The next
    daily clean-up deletes, so a mistaken change can still be corrected."""
    as_admin(team, run_with)
    evidence_before = count(db, Evidence, team.org)

    saved = team.client.put(URL, json={**PERIODS, "password": PASSWORD})

    assert saved.status_code == 200, saved.text
    assert saved.json()["evidence"]["days"] == 90 and saved.json()["using_defaults"] is False
    assert saved.json()["changed_by"] == "Tom"
    row = db.scalar(select(RetentionSettings).where(RetentionSettings.organization_id == team.org))
    assert (row.evidence_days, row.campaign_days, row.report_days) == (90, 365, 730)
    assert count(db, Evidence, team.org) == evidence_before, "saving deletes nothing"
    entry = db.scalars(
        select(AuditLogEntry).where(AuditLogEntry.action == "retention.changed")
    ).first()
    assert entry is not None and entry.details["after"]["evidence_days"] == 90
    assert entry.details["before"]["evidence_days"] == retention.DEFAULTS["evidence_days"]


def test_a_period_outside_the_allowed_range_is_refused_with_the_range(team, run_with):  # noqa: F811
    """3a and 3a1: Sentra names the allowed range at the field the number was typed in."""
    as_admin(team, run_with)

    refused = team.client.put(URL, json={**PERIODS, "evidence_days": 5, "password": PASSWORD})

    assert refused.status_code == 422
    detail = refused.json()["error"]["details"][0]
    assert detail["field"] == "evidence_days"
    assert "30" in detail["message"] and "1,095" in detail["message"]


def test_the_wrong_password_changes_nothing(team, run_with, db):  # noqa: F811
    """NFR-3.5: the administrator authenticates again before the periods change."""
    as_admin(team, run_with)

    refused = team.client.put(URL, json={**PERIODS, "password": "not-the-password"})

    assert refused.status_code == 422
    assert refused.json()["error"]["details"][0]["field"] == "password"
    assert db.scalar(select(func.count(RetentionSettings.id))) == 0


def test_only_an_organization_administrator_reads_or_changes_the_periods(team, run_with):  # noqa: F811
    """FR-1.6: UC-10.7's actor is the Organization Administrator; a Security Analyst has no say
    over how long the organization keeps its data."""
    with_data(team, run_with)
    log_in(team.client, ANALYST)

    assert team.client.get(URL).status_code == 403
    assert team.client.put(URL, json={**PERIODS, "password": PASSWORD}).status_code == 403


def test_the_preview_answers_before_anything_is_saved(team, run_with):  # noqa: F811
    """Step 4: the page asks what the next clean-up would delete with the periods the
    administrator has typed, and gets an answer without changing anything."""
    as_admin(team, run_with)

    preview = team.client.get(
        URL + "/preview", params={"evidence_days": 30, "campaign_days": 30, "report_days": 30}
    )

    assert preview.status_code == 200, preview.text
    body = preview.json()
    # Nothing of the fixture is 30 days old, so a clean-up today would delete nothing.
    assert body["evidence_items"] == 0 and body["attempts"] == 0 and body["reports"] == 0
    assert body["open_findings"] == []
    # 3a1: the preview refuses what the save would refuse, so the two can never disagree.
    refused = team.client.get(
        URL + "/preview", params={"evidence_days": 5, "campaign_days": 30, "report_days": 30}
    )
    assert refused.status_code == 422
    assert refused.json()["error"]["details"][0]["field"] == "evidence_days"


def test_the_preview_counts_with_the_same_code_that_deletes(team, run_with, db):  # noqa: F811
    """The preview and the clean-up are one function, so the screen can never promise something
    the job does not do."""
    as_admin(team, run_with)

    counted = retention.clean_up(db, team.org, at=LONG_AFTER, dry_run=True)
    assert counted.evidence.items > 0 and counted.attempts.items > 0
    assert counted.open_findings, "4a: the fixture's finding is still open"
    assert count(db, Evidence, team.org) == counted.evidence.items, "a count deletes nothing"

    done = retention.clean_up(db, team.org, at=LONG_AFTER)
    assert (done.evidence.items, done.attempts.items) == (
        counted.evidence.items,
        counted.attempts.items,
    )


# ---------------------------------------------------------------- UC-10.8


def test_the_clean_up_deletes_expired_data_and_keeps_the_finding_and_its_score(team, run_with, db):  # noqa: F811
    """Steps 2-5: the expired evidence, attempts and reports go; the finding's summary, its risk
    score and the campaign run with its counts stay, so the trends of Module 7 survive (step 4)."""
    finding = with_data(team, run_with)
    report = team.client.post(
        "/api/v1/reports", json={"type": "executive", "scope": "organization", "format": "json"}
    )
    assert report.status_code == 202, report.text
    log_in(team.client, ADMIN)
    runs = count(db, CampaignRun, team.org)
    scores = db.scalar(select(func.count(RiskScore.id)))

    done = retention.clean_up(db, team.org, at=LONG_AFTER)

    assert done.evidence.items > 0 and done.evidence.bytes > 0
    assert done.attempts.items > 0 and done.reports.items == 1
    assert count(db, Evidence, team.org) == 0 and count(db, Attempt, team.org) == 0
    assert count(db, Report, team.org) == 0
    assert db.get(Finding, finding.id) is not None, "the summary of a finding is kept"
    assert count(db, CampaignRun, team.org) == runs, "the run and its counts are kept"
    assert db.scalar(select(func.count(RiskScore.id))) == scores
    written = db.scalars(select(RetentionRun)).first()
    assert written is not None and written.finished_at is not None
    assert written.evidence_deleted == done.evidence.items and written.failures == 0
    assert (written.evidence_days, written.campaign_days) == (180, 365), "the periods it ran with"


def test_every_clean_up_is_in_the_audit_log_without_the_deleted_content(team, run_with, db):  # noqa: F811
    """Step 5 and quality requirement 5: the kind of data, the number of items and the period —
    and never the content that was deleted."""
    as_admin(team, run_with)

    retention.clean_up(db, team.org, at=LONG_AFTER)

    entry = db.scalars(
        select(AuditLogEntry).where(AuditLogEntry.action == "retention.deleted")
    ).first()
    assert entry is not None and entry.actor_name == "Sentra"
    assert entry.details["evidence"]["items"] > 0
    assert entry.details["periods"]["evidence_days"] == 180
    printed = str(entry.details)
    assert PERSONAL_TOKEN not in printed and "ATTEMPT-1" not in printed


def test_the_audit_log_itself_is_never_deleted(team, run_with, db):  # noqa: F811
    """NFR-8.3: the audit log is not covered by the periods and is kept for at least a year, so a
    clean-up only ever adds to it."""
    as_admin(team, run_with)
    before = db.scalar(select(func.count(AuditLogEntry.id)))

    retention.clean_up(db, team.org, at=LONG_AFTER)

    assert db.scalar(select(func.count(AuditLogEntry.id))) > before


def test_data_of_a_run_that_is_still_going_on_waits(team, run_with, db):  # noqa: F811
    """2a and 2a1: expired data of a run that has not ended is postponed to the next clean-up."""
    as_admin(team, run_with)
    run = db.scalars(select(CampaignRun)).first()
    run.status = RunStatus.RUNNING
    run.ended_at = None
    db.commit()
    evidence = count(db, Evidence, team.org)
    attempts = count(db, Attempt, team.org)

    done = retention.clean_up(db, team.org, at=LONG_AFTER)

    assert done.evidence.items == 0 and done.postponed >= evidence
    assert done.attempts.items == 0, "the attempts of a run that is still sending stay too"
    assert count(db, Evidence, team.org) == evidence
    assert count(db, Attempt, team.org) == attempts


def test_an_attempt_whose_evidence_is_still_kept_waits(team, run_with, db):  # noqa: F811
    """The proof outlives the attempt it was taken from on purpose (`evidence.attempt_id` is
    RESTRICT), so campaign data that still has evidence is postponed instead of failing."""
    as_admin(team, run_with)
    attempts = count(db, Attempt, team.org)
    keep_evidence = retention.Periods(evidence_days=1095, campaign_days=30, report_days=730)

    # Asked while the evidence period is still running: at LONG_AFTER even the longest evidence
    # period the platform allows has ended, and then there is no evidence left to hold anything
    # back — which is the ordinary clean-up two tests above, not this one.
    done = retention.clean_up(db, team.org, at=WHILE_EVIDENCE_IS_KEPT, periods=keep_evidence)

    assert done.evidence.items == 0 and done.attempts.items < attempts
    assert done.postponed > 0
    assert count(db, Evidence, team.org) > 0


def test_an_object_the_storage_will_not_delete_keeps_its_row(team, run_with, db, monkeypatch):  # noqa: F811
    """3a and 3a1: the deletion failed, so the row stays and the next clean-up tries again. The
    failure is counted and the key recorded, never the content."""
    with_data(team, run_with)
    assert (
        team.client.post(
            "/api/v1/reports",
            json={"type": "executive", "scope": "organization", "format": "json"},
        ).status_code
        == 202
    )
    log_in(team.client, ADMIN)
    stored_report = db.scalars(select(Report)).first()
    assert stored_report.object_key, "a ready report has its file in the object storage"

    monkeypatch.setattr(storage, "delete", _refuse)
    done = retention.clean_up(db, team.org, at=LONG_AFTER)

    assert done.failures >= 1 and stored_report.object_key in done.failed_keys
    assert done.reports.items == 0
    assert count(db, Report, team.org) == 1, "the row waits for the next clean-up"
    written = db.scalars(select(RetentionRun)).first()
    assert written.failures == done.failures and written.failed_keys == done.failed_keys


def test_repeated_failures_tell_the_platform_administrators(team, run_with, db, monkeypatch):  # noqa: F811
    """3a1: after three clean-ups in a row that could not delete the same object, the Platform
    Administrators are told — with how many objects are stuck, never with what they contain."""
    with_data(team, run_with)
    assert (
        team.client.post(
            "/api/v1/reports",
            json={"type": "executive", "scope": "organization", "format": "json"},
        ).status_code
        == 202
    )
    log_in(team.client, ADMIN)
    new_user(db, "lena@example.com")
    db.scalar(select(User).where(User.email == "lena@example.com")).platform_admin = True
    db.commit()
    key = db.scalars(select(Report)).first().object_key
    monkeypatch.setattr(storage, "delete", _refuse)
    before = len(outbox)

    for _ in range(2):  # the first two runs only mark the object and try again
        retention.clean_up(db, team.org, at=LONG_AFTER)
    assert len(outbox) == before
    retention.clean_up(db, team.org, at=LONG_AFTER)

    message = outbox[-1]
    assert message["To"] == "lena@example.com"
    assert "cannot delete 1 object(s)" in message["Subject"]
    assert key not in message.get_content(), "the alert names no object key"
    assert count(db, Report, team.org) == 1, "no data is lost while the storage is unreachable"


# ---------------------------------------------------------------- the clock (UC-10.8 step 1)


def test_the_clock_starts_the_clean_up_once_a_day(team, run_with, db):  # noqa: F811
    """UC-10.8 step 1: the module's own `schedules.py` is what the clock calls, so the clean-up
    needs no change to the scheduler. The job runs inline in the tests, so what this proves is the
    whole way from the clock's daily round to a recorded clean-up."""
    as_admin(team, run_with)
    assert count(db, RetentionRun, team.org) == 0

    assert schedules.daily(db) is True

    assert count(db, RetentionRun, team.org) == 1, "the clean-up ran and said what it did"


def _refuse(key: str) -> None:
    raise storage.StorageError("the storage is not reachable")
