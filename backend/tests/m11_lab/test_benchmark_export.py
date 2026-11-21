"""FR-11.5 (M11) Results Export: UC-11.6 Export Benchmark Results (2a) end to end.

The benchmark run is the one of tests/m11_lab/test_benchmark_metrics.py, so nothing is sent
anywhere and every value in the export is an invented one.
"""

import csv
import hashlib
import io

import pytest
from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m05_campaigns.models import Attempt
from app.modules.m06_findings.models import Outcome
from app.modules.m11_lab.models import AttemptLabel
from tests.m11_lab.test_benchmark_metrics import (  # noqa: F401
    DOCUMENT,
    SYSTEM_PROMPT,
    Result,
    analyst,
    benchmark_run,
    definition,
    lab_target,
    label_whole_sample,
    ran,
    zone,
)

URL = "/api/v1/lab/benchmarks"


@pytest.fixture
def measured(db, lab_target, definition):  # noqa: F811
    """A finished benchmark run: two strategies, one repetition each, with findings, attempts,
    verdicts and the judge's own answer."""
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(
        db,
        definition,
        run.repetition_rows[0],
        findings=[("LLM07", "System prompt", SYSTEM_PROMPT)],
        results=[Result(Outcome.MET, Outcome.MET), Result(Outcome.NOT_MET, Outcome.NOT_MET)],
    )
    ran(
        db,
        definition,
        run.repetition_rows[1],
        findings=[("LLM01", "Knowledge sources", DOCUMENT)],
        results=[Result(Outcome.MET, Outcome.MET)],
    )
    return run


def export(client, run, fmt="json", level="strategy"):
    response = client.post(f"{URL}/{run.code}/export", json={"format": fmt, "level": level})
    assert response.status_code == 200, response.text
    return response


def rows_of(response) -> list[dict]:
    """The CSV table, as a tool that skips comment lines reads it."""
    table = "\n".join(line for line in response.text.splitlines() if not line.startswith("#"))
    return list(csv.DictReader(io.StringIO(table)))


def test_the_json_export_carries_the_whole_experiment(analyst, measured):  # noqa: F811
    found = export(analyst, measured).json()

    assert found["export"]["level"] == "strategy"
    assert found["export"]["export_version"] == 1
    # Step 3: the configuration
    assert found["configuration"]["benchmark"] == measured.code
    assert [s["key"] for s in found["configuration"]["strategies"]] == ["A", "B"]
    assert found["configuration"]["attempt_budget"] == 40
    assert found["configuration"]["order_seed"] is not None
    # Step 4: the versions, the documented lists among them
    lists = found["versions"]["known_vulnerability_lists"]
    assert lists[0]["version"] == 1
    assert [item["id"] for item in lists[0]["known_vulnerabilities"]] == ["RAG-01", "RAG-02"]
    assert found["versions"]["lab_targets"]
    # The results at the chosen level
    assert [row["strategy"] for row in found["results"]] == ["A", "B"]
    assert found["results"][0]["discovery_rate_mean"] == 50.0
    assert found["results"][0]["discovery_rate_n"] == 1


def test_the_labels_go_with_the_results(analyst, measured):  # noqa: F811
    label_whole_sample(
        analyst,
        measured,
        {"ATTEMPT-1": AttemptLabel.SUCCESSFUL, "ATTEMPT-2": AttemptLabel.UNSURE},
    )

    found = export(analyst, measured).json()

    labels = found["labels"]["attempts"]
    assert len(labels) == 3  # ATTEMPT-1 of both repetitions and ATTEMPT-2 of the first
    assert {row["verdict"] for row in labels} == {"successful", "unsure"}
    assert all(row["labelled_at"] for row in labels)


def test_the_repetition_level_writes_one_row_per_repetition(analyst, measured, db):  # noqa: F811
    found = export(analyst, measured, level="repetition").json()

    assert len(found["results"]) == 2
    row = found["results"][0]
    assert (row["strategy"], row["repetition"], row["status"]) == ("A", 1, "completed")
    assert row["documented"] == 2
    assert row["discovered"] == 1
    assert row["attempts"] == 2
    assert row["llm_cost_usd"] == "0.400000"  # as the column stores it, not rounded


def test_the_attempt_level_says_what_each_detection_decided(analyst, measured):  # noqa: F811
    label_whole_sample(
        analyst,
        measured,
        {"ATTEMPT-1": AttemptLabel.SUCCESSFUL, "ATTEMPT-2": AttemptLabel.UNSUCCESSFUL},
    )

    found = export(analyst, measured, level="attempt").json()

    assert len(found["results"]) == 3
    first = found["results"][0]
    assert first["combined_verdict"] == Outcome.MET
    assert first["judge_verdict"] == Outcome.MET
    assert first["in_blind_sample"] is True
    assert first["analyst_label"] == "successful"
    assert first["message"] == "ATTEMPT-1"
    assert first["content_available"] is True


def test_an_attempt_whose_content_was_deleted_is_exported_and_marked(
    analyst,  # noqa: F811
    measured,
    db,
):
    # UC-11.6, 2a: the retention period of UC-10.8 ended for this attempt's evidence.
    attempt = db.scalars(select(Attempt).order_by(Attempt.attempt_no)).first()
    attempt.reply = None
    db.commit()

    response = export(analyst, measured, level="attempt")
    found = response.json()

    gone = next(row for row in found["results"] if row["attempt_id"] == str(attempt.id))
    assert gone["content_available"] is False
    assert gone["message"] is None and gone["reply"] is None
    # 2a1: its result and its label are still there
    assert gone["combined_verdict"] == Outcome.MET
    assert gone["attempt_no"] == attempt.attempt_no


def test_the_csv_is_a_table_with_the_experiment_above_it(analyst, measured):  # noqa: F811
    response = export(analyst, measured, fmt="csv", level="repetition")

    assert response.headers["content-type"].startswith("text/csv")
    comments = [line for line in response.text.splitlines() if line.startswith("#")]
    assert any(line.startswith("# configuration_benchmark:") for line in comments)
    assert any("known_vulnerability_lists" in line for line in comments)
    assert any(line.startswith("# labels:") for line in comments)
    rows = rows_of(response)
    assert [row["strategy"] for row in rows] == ["A", "B"]
    assert rows[0]["documented"] == "2"


def test_the_checksum_is_of_the_file_that_was_downloaded(analyst, measured):  # noqa: F811
    response = export(analyst, measured, fmt="csv", level="attempt")

    assert response.headers["x-checksum-sha256"] == hashlib.sha256(response.content).hexdigest()
    assert 'filename="sentra-benchmark-BR-001-attempt-' in response.headers["content-disposition"]
    assert response.headers["x-export-rows"] == "3"


def test_the_export_is_recorded_in_the_audit_log(analyst, measured, db):  # noqa: F811
    response = export(analyst, measured, fmt="json", level="repetition")

    entry = db.scalars(
        select(AuditLogEntry).where(AuditLogEntry.action == "benchmark.exported")
    ).one()
    assert entry.details["format"] == "json"
    assert entry.details["level"] == "repetition"
    assert entry.details["rows"] == 2
    assert entry.details["checksum"] == response.headers["x-checksum-sha256"]
    assert measured.code in entry.summary


def test_the_dialog_is_told_how_many_rows_each_level_would_write(analyst, measured):  # noqa: F811
    found = analyst.get(f"{URL}/{measured.code}/export").json()

    assert found == {"strategy": 2, "repetition": 2, "attempt": 3, "labels": 0}


def test_only_a_security_analyst_exports_and_the_choices_are_checked(client, db, zone):  # noqa: F811
    import uuid as _uuid

    from app.modules.m01_users.models import Role
    from app.modules.m02_targets.models import Target
    from tests.m01_users.test_organizations import log_in
    from tests.m01_users.test_permissions import organization_with
    from tests.m11_lab.test_lab_deployment import deploy

    organization_with(
        db,
        client,
        {"priya@example.com": Role.SECURITY_ANALYST, "maya@example.com": Role.TARGET_OWNER},
    )
    log_in(client, "priya@example.com")
    target = db.get(Target, _uuid.UUID(deploy(client).json()["target_id"]))
    run = benchmark_run(db, target, repetitions=1)

    refused = client.post(f"{URL}/{run.code}/export", json={"format": "xml", "level": "strategy"})
    assert refused.status_code == 422

    log_in(client, "maya@example.com")
    assert client.get(f"{URL}/{run.code}/export").status_code == 200  # reading is open
    denied = client.post(f"{URL}/{run.code}/export", json={"format": "csv", "level": "strategy"})
    assert denied.status_code == 403
