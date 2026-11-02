"""FR-9.1 (M9) Report Generation: UC-9.1 with 2a and 5a, and the export in the audit log.
Dummy values only: the findings come from the fixtures of M6, with invented replies and fake
canary tokens."""

import json
from datetime import UTC, datetime

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m06_findings.models import FindingStatus
from app.modules.m08_remediation.models import (
    Origin,
    Remediation,
    RemediationStatus,
    Retest,
    RetestStatus,
    RetestVerdict,
)
from app.modules.m09_reporting.models import Report, ReportStatus
from tests.m01_users.test_organizations import log_in
from tests.m06_findings.conftest import PERSONAL_TOKEN, plant
from tests.m07_risk.conftest import canary_test, findings_of, run_with, team  # noqa: F401

URL = "/api/v1/reports"


def with_findings(team, run_with):  # noqa: F811
    """One critical finding of the Payments Operations Agent, from a campaign run."""
    plant(team.db, team.agent, "personal_data", PERSONAL_TOKEN)
    run_with(canary_test(team, category="LLM02"), [f"Write to {PERSONAL_TOKEN} for help."] * 2)
    return findings_of(team.db)[0]


def ask(team, **changes) -> dict:  # noqa: F811
    data = {"type": "executive", "scope": "organization", "format": "json"} | changes
    response = team.client.post(URL, json=data)
    assert response.status_code == 202, response.text
    return response.json()


def test_an_executive_report_holds_the_risk_summary_and_what_to_do_first(team, run_with):  # noqa: F811
    """UC-9.1 steps 1-5: the summary, the targets, the trend, the coverage and the
    recommendations, in plain language (quality requirement 1)."""
    with_findings(team, run_with)

    report = ask(team)

    assert report["code"] == "RP-001" and report["type"] == "executive"
    assert report["message"] is None
    assert report["status"] == "ready" and report["format"] == "json"
    assert report["checksum"] and len(report["checksum"]) == 64
    assert report["requested_by"] == "Arif"
    downloaded = team.client.get(f"{URL}/RP-001/download")
    assert downloaded.status_code == 200
    assert downloaded.headers["x-checksum-sha256"] == report["checksum"]
    document = json.loads(downloaded.content)
    assert document["report"]["title"] == "Executive report — All targets"
    assert document["summary"]["open_total"] == 1
    assert document["targets"][0]["name"] == "Payments Operations Agent"
    assert document["recommendations"][0]["code"] == "F-001"
    assert "coverage" in document and "trend" in document


def test_a_technical_report_holds_every_finding_with_its_detail(team, run_with):  # noqa: F811
    """QR 1: the technical report keeps the detail, and the evidence stays in Sentra (FR-6.3)."""
    finding = with_findings(team, run_with)

    made = ask(team, type="technical", scope="target", target_id=str(team.agent.id))
    assert (made["status"], made["message"]) == ("ready", None)

    document = json.loads(team.client.get(f"{URL}/RP-001/download").content)
    (shown,) = document["findings"]
    assert shown["code"] == finding.code and shown["severity"] == finding.severity
    assert shown["component"].startswith("Knowledge source")
    assert shown["evidence_count"] >= 1
    assert "masked" in shown["evidence_note"]
    assert document["summary"]["findings"] == 1


def test_a_finding_that_requires_confirmation_is_listed_apart(team, run_with):  # noqa: F811
    """UC-9.1, 2a1: it is listed separately and counted nowhere, as the risk score does it."""
    finding = with_findings(team, run_with)
    finding.status = FindingStatus.REQUIRES_CONFIRMATION
    team.db.commit()

    ask(team)

    document = json.loads(team.client.get(f"{URL}/RP-001/download").content)
    assert document["counts"] == {"findings": 0, "unconfirmed": 1}
    assert document["unconfirmed"][0]["code"] == finding.code
    assert document["summary"]["awaiting_confirmation"] == 1


def test_a_scope_without_results_makes_no_file(team, run_with):  # noqa: F811
    """UC-9.1, 5a1: Sentra says so and writes nothing."""
    report = ask(team)

    assert report["status"] == ReportStatus.EMPTY
    assert report["message"] == "No results for the selected scope and period."
    assert report["checksum"] is None
    refused = team.client.get(f"{URL}/RP-001/download")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "report_not_ready"


def test_a_pdf_report_is_written_and_can_be_downloaded(team, run_with):  # noqa: F811
    """Step 3: PDF for reading. The check is the file itself, not its layout."""
    with_findings(team, run_with)

    report = ask(team, format="pdf")

    assert report["status"] == "ready" and report["size_bytes"] > 1000
    downloaded = team.client.get(f"{URL}/RP-001/download")
    assert downloaded.headers["content-type"] == "application/pdf"
    assert downloaded.content.startswith(b"%PDF-")
    assert 'filename="RP-001.pdf"' in downloaded.headers["content-disposition"]


def test_every_export_is_recorded(team, run_with):  # noqa: F811
    """UC-9.1 step 7, FR-10.2: who asked for it and who downloaded it."""
    with_findings(team, run_with)
    ask(team)

    team.client.get(f"{URL}/RP-001/download")

    actions = [
        entry.action for entry in team.db.scalars(select(AuditLogEntry).order_by(AuditLogEntry.seq))
    ]
    assert "report.requested" in actions and "report.downloaded" in actions


def test_an_executive_report_of_one_campaign_run_is_refused(team, run_with):  # noqa: F811
    """Step 2: an executive report covers a target or the organization, never a single run."""
    with_findings(team, run_with)
    run_id = str(team.db.scalar(select(Report.id)) or "")
    refused = team.client.post(
        URL,
        json={
            "type": "executive",
            "scope": "campaign_run",
            "format": "pdf",
            "campaign_run_id": run_id or "00000000-0000-0000-0000-000000000000",
        },
    )

    assert refused.status_code == 422


def test_only_an_analyst_or_a_manager_asks_for_a_report(team, run_with):  # noqa: F811
    """UC-9.1's actors. Every member may read the list."""
    with_findings(team, run_with)
    ask(team)
    log_in(team.client, "maya@example.com")  # AI Application Developer

    assert (
        team.client.post(
            URL, json={"type": "executive", "scope": "organization", "format": "pdf"}
        ).status_code
        == 403
    )
    listed = team.client.get(URL)
    assert listed.status_code == 200 and len(listed.json()["rows"]) == 1
    assert team.client.get(f"{URL}/RP-001/download").status_code == 200


def test_another_organization_sees_no_report(team, run_with):  # noqa: F811
    """NFR-3.3."""
    from tests.m01_users.test_organizations import create as create_organization
    from tests.m01_users.test_organizations import new_user

    with_findings(team, run_with)
    ask(team)
    new_user(team.db, "jonas@example.com")
    log_in(team.client, "jonas@example.com")
    create_organization(team.client, "Kestrel Logistics")

    assert team.client.get(URL).json()["rows"] == []
    assert team.client.get(f"{URL}/RP-001").status_code == 404


def verified(team, finding, **changes) -> Retest:  # noqa: F811
    """A finished retest of the finding, with the figures FR-8.5 freezes in it. The retest itself
    is UC-8.6 and is measured in tests/m08_remediation; here it is the input of the report."""
    remediation = Remediation(
        organization_id=finding.organization_id,
        finding_id=finding.id,
        version=1,
        status=RemediationStatus.EFFECTIVE,
        origin=Origin.GENERATED,
        root_cause="The answers quote what the retrieved documents say.",
        summary="One guardrail rule and one retrieval rule.",
        ai_generated=True,
    )
    team.db.add(remediation)
    team.db.flush()
    retest = Retest(
        organization_id=finding.organization_id,
        finding_id=finding.id,
        remediation_id=remediation.id,
        number=1,
        status=RetestStatus.COMPLETED,
        verdict=RetestVerdict.CLOSED,
        policy_version=4,
        changes_marked=1,
        test_code=finding.test_code,
        repetitions=5,
        replayed=[],
        before_attempts=5,
        before_successes=4,
        after_attempts=5,
        after_successes=0,
        risk_before=91,
        risk_band_before="critical",
        risk_after=87,
        risk_band_after="critical",
        benign_total=4,
        benign_changed=1,
        conclusion="The fix closes the weakness: no repeated attempt succeeded after it (0 of 5), "
        "against 4 of 5 before.",
        finished_at=datetime.now(UTC),
        **changes,
    )
    team.db.add(retest)
    team.db.commit()
    return retest


def test_a_technical_report_holds_the_verification_of_a_retested_finding(team, run_with):  # noqa: F811
    """UC-8.7, 5c1: the manager puts the before-and-after comparison in a report (FR-9.1). The
    figures are the retest's own, frozen when it ran, and every rate carries its counts."""
    finding = with_findings(team, run_with)
    verified(team, finding)

    ask(team, type="technical", scope="target", target_id=str(team.agent.id))

    document = json.loads(team.client.get(f"{URL}/RP-001/download").content)
    (shown,) = document["findings"]
    checked = shown["verification"]
    assert checked["retest"] == 1 and checked["verdict_label"] == "Fixed and Verified"
    assert checked["attack_success_before"] == "4 of 5 attempts (80 %)"
    assert checked["attack_success_after"] == "0 of 5 attempts (0 %)"
    assert checked["normal_use_affected"] == "1 of 4 requests (25 %)"
    assert (checked["risk_before"], checked["risk_after"]) == (91, 87)
    assert checked["policy_version"] == 4 and checked["changes_marked"] == 1
    assert checked["conclusion"].startswith("The fix closes the weakness")
    assert checked["out_of_date"] is False


def test_a_report_of_a_finding_without_a_retest_says_nothing_about_one(team, run_with):  # noqa: F811
    """A finding nobody has retested yet carries no verification, and the report leaves it out
    instead of showing empty figures."""
    with_findings(team, run_with)

    ask(team, type="technical", scope="target", target_id=str(team.agent.id))

    document = json.loads(team.client.get(f"{URL}/RP-001/download").content)
    assert document["findings"][0]["verification"] is None


def test_a_rolled_back_verification_says_so_in_the_report(team, run_with):  # noqa: F811
    """UC-8.8: what the retest proved is not in the traffic any more, so a reader of the report is
    told, instead of taking it for the application as it runs today. The PDF carries the same
    block, so it is written as well here."""
    finding = with_findings(team, run_with)
    verified(team, finding, out_of_date=True)

    ask(team, type="technical", scope="target", target_id=str(team.agent.id))
    ask(team, type="technical", scope="target", target_id=str(team.agent.id), format="pdf")

    document = json.loads(team.client.get(f"{URL}/RP-001/download").content)
    assert document["findings"][0]["verification"]["out_of_date"] is True
    printed = team.client.get(f"{URL}/RP-002/download")
    assert printed.status_code == 200 and printed.content.startswith(b"%PDF")
