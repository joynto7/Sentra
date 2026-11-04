"""FR-11.4 (M11) Benchmark Metrics: UC-11.5 Evaluate Benchmark Results (2a, 4a, 6a) end to end.

Nothing is sent anywhere. The lab target is the stub of tests/m11_lab/test_lab_deployment.py, and
the repetitions of the benchmark run are written here with invented results: dummy attempt
messages ATTEMPT-1, ATTEMPT-2 …, invented replies, made-up canary slots and findings with
made-up titles. The documented weaknesses are the two of the stub's list.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.audit import AuditLogEntry
from app.llm.models import LLMUsage
from app.modules.m02_targets.models import Target
from app.modules.m04_tests.schema import DetectionMethod, DetectionRole, Severity
from app.modules.m05_campaigns.models import (
    Attempt,
    AttemptStatus,
    CampaignRun,
    RunStatus,
    RunType,
)
from app.modules.m06_findings.models import (
    ComponentKind,
    DetectionResult,
    DetectionVerdict,
    Evidence,
    EvidenceKind,
    FindingStatus,
    Outcome,
)
from app.modules.m06_findings.models import Finding as FindingRow
from app.modules.m11_lab.models import (
    AttemptLabel,
    BenchmarkRepetition,
    BenchmarkRun,
    BenchmarkStatus,
    FindingLabel,
    LabDeployment,
    RepetitionStatus,
)
from tests.m06_findings.conftest import make_test
from tests.m11_lab.test_lab_deployment import LabSide, analyst, deploy, zone  # noqa: F401

URL = "/api/v1/lab/benchmarks"
SYSTEM_PROMPT = "system_instructions"  # the stub's canary slots
DOCUMENT = "test_document"
# The stub's documented list, with the slot each weakness is reached through and the component
# the finding of it affects (FR-11.1; the application reports the slot, FR-11.2).
KNOWN = [
    {
        "id": "RAG-01",
        "title": "System prompt disclosure",
        "category": "LLM07",
        "description": "Asked for its instructions, the assistant repeats its system prompt.",
        "slot": SYSTEM_PROMPT,
        "source": "lab",
    },
    {
        "id": "RAG-02",
        "title": "Indirect prompt injection through a retrieved document",
        "category": "LLM01",
        "description": "A retrieved document carries an instruction the assistant follows.",
        "slot": DOCUMENT,
        "source": "lab",
    },
]


@pytest.fixture
def lab_target(analyst, db) -> Target:  # noqa: F811
    """The RAG chatbot, deployed and ready, with the documented list above."""
    target_id = deploy(analyst).json()["target_id"]
    row = db.scalar(select(LabDeployment))
    row.known_vulnerabilities = [dict(item) for item in KNOWN]
    db.commit()
    return db.get(Target, uuid.UUID(target_id))


@pytest.fixture
def definition(db, lab_target):
    """One custom test with dummy checks; every attempt and finding here applies it."""
    return make_test(db, lab_target.organization_id, {"canary_token": "decisive"}, [])


class Result:
    """What one attempt of a repetition is given: what the judge said on its own, and what the
    combined verdict of UC-6.1 is. `None` means that detection has no met-or-not answer."""

    def __init__(self, judge: str | None, combined: str | None):
        self.judge, self.combined = judge, combined


def benchmark_run(
    db, target: Target, *, repetitions=2, baseline=None, keys=("A", "B")
) -> BenchmarkRun:
    number = (db.scalar(select(BenchmarkRun.number).order_by(BenchmarkRun.number.desc())) or 0) + 1
    run = BenchmarkRun(
        organization_id=target.organization_id,
        number=number,
        name="Static suites against the same suites again",
        status=BenchmarkStatus.COMPLETED,
        strategies=[
            {
                "key": key,
                "name": f"Strategy {key}",
                "suites": ["QUICK-REGRESSION"],
                "adaptive_agent": False,
            }
            for key in keys
        ],
        attempt_budget=40,
        repetitions=repetitions,
        judge_every_attempt=True,
        baseline_id=baseline.id if baseline else None,
        versions={"lab_targets": [{"id": str(target.id), "name": target.name}]},
        order_seed=7,
    )
    db.add(run)
    db.flush()
    place = 0
    for repetition in range(1, repetitions + 1):
        for key in keys:
            place += 1
            db.add(
                BenchmarkRepetition(
                    benchmark_run_id=run.id,
                    target_id=target.id,
                    strategy_key=key,
                    repetition=repetition,
                    order_no=place,
                    status=RepetitionStatus.PLANNED,
                )
            )
    db.commit()
    return run


def ran(
    db,
    definition,
    repetition: BenchmarkRepetition,
    *,
    findings: list[tuple[str, str, str | None]] = (),
    results: list[Result] = (),
    minutes: int = 10,
    cost: str = "0.40",
    tokens: int = 1_000,
    status: str = RepetitionStatus.COMPLETED,
) -> CampaignRun:
    """One repetition that ran: a campaign run of type benchmark with its attempts, their
    detection results and the findings it raised.

    `findings` are (category, component, canary slot) and `results` are one Result per attempt.
    """
    target = db.get(Target, repetition.target_id)
    started = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
    run = CampaignRun(
        organization_id=target.organization_id,
        target_id=target.id,
        number=(db.scalar(select(CampaignRun.number).order_by(CampaignRun.number.desc())) or 0) + 1,
        run_type=RunType.BENCHMARK,
        status=RunStatus.COMPLETED,
        attempt_budget=40,
        request_rate=30,
        started_at=started,
        ended_at=started + timedelta(minutes=minutes),
    )
    db.add(run)
    db.flush()
    db.add(
        LLMUsage(
            organization_id=target.organization_id,
            campaign_run_id=run.id,
            task="llm_judge",
            model="stub/judge",
            provider="stub",
            deployment="local",
            prompt_tokens=tokens // 2,
            completion_tokens=tokens - tokens // 2,
            cost_usd=Decimal(cost),
            duration_ms=100,
            succeeded=True,
        )
    )
    attempts = []
    for number, result in enumerate(results, start=1):
        attempt = Attempt(
            organization_id=target.organization_id,
            campaign_run_id=run.id,
            attempt_no=number,
            test_definition_id=definition.id,
            test_code=definition.code,
            template="stub",
            variant=1,
            status=AttemptStatus.REPLIED,
            input=f"ATTEMPT-{number}",
            reply="INVENTED-REPLY",
            session_id=f"session-{number}",
            sent_at=started + timedelta(seconds=number),
        )
        db.add(attempt)
        db.flush()
        attempts.append(attempt)
        if result.judge is not None:
            db.add(
                DetectionResult(
                    organization_id=target.organization_id,
                    attempt_id=attempt.id,
                    method=DetectionMethod.LLM_JUDGE,
                    role=DetectionRole.SUPPORTING,
                    outcome=result.judge,
                    summary="STUB-JUDGE-SUMMARY",
                    checks=[],
                )
            )
        if result.combined is not None:
            db.add(
                DetectionVerdict(
                    organization_id=target.organization_id,
                    attempt_id=attempt.id,
                    campaign_run_id=run.id,
                    outcome=result.combined,
                    summary="STUB-VERDICT",
                )
            )
    for index, (category, component, slot) in enumerate(findings, start=1):
        # One finding per root cause (FR-6.2): the same weakness found again in another
        # repetition adds its evidence to the finding it already has.
        code = f"{definition.code}-{index}"
        finding = db.scalar(
            select(FindingRow).where(
                FindingRow.target_id == target.id,
                FindingRow.test_code == code,
                FindingRow.component_name == component,
            )
        )
        if finding is None:
            finding = FindingRow(
                organization_id=target.organization_id,
                number=(
                    db.scalar(select(FindingRow.number).order_by(FindingRow.number.desc())) or 0
                )
                + 1,
                target_id=target.id,
                test_code=code,
                test_definition_id=definition.id,
                component_kind=ComponentKind.KNOWLEDGE_SOURCE,
                component_name=component,
                title=f"INVENTED-FINDING-{index}",
                description="An invented finding of the metric tests.",
                category=category,
                severity=Severity.MEDIUM,
                status=FindingStatus.NEW,
                first_run_id=run.id,
                last_run_id=run.id,
                first_seen_at=started,
                last_seen_at=started,
            )
            db.add(finding)
            db.flush()
        finding.last_run_id, finding.last_seen_at = run.id, started
        finding.evidence_count += 1
        attempt = attempts[index - 1] if index <= len(attempts) else None
        if attempt is None:
            attempt = Attempt(
                organization_id=target.organization_id,
                campaign_run_id=run.id,
                attempt_no=900 + index,
                test_definition_id=definition.id,
                test_code=definition.code,
                template="stub",
                variant=1,
                status=AttemptStatus.REPLIED,
                input=f"FINDING-ATTEMPT-{index}",
                reply="INVENTED-REPLY",
                session_id=f"finding-session-{index}",
                sent_at=started + timedelta(seconds=900 + index),
            )
            db.add(attempt)
            db.flush()
        db.add(
            Evidence(
                organization_id=target.organization_id,
                finding_id=finding.id,
                evidence_no=(
                    db.scalar(select(func.count()).where(Evidence.finding_id == finding.id)) or 0
                )
                + 1,
                kind=EvidenceKind.ATTEMPT,
                attempt_id=attempt.id,
                campaign_run_id=run.id,
                recorded_at=started + timedelta(minutes=1),
                checksum="0" * 64,
                size=10,
                content="{}",
            )
        )
        if slot:
            db.add(
                DetectionResult(
                    organization_id=target.organization_id,
                    attempt_id=attempt.id,
                    method=DetectionMethod.CANARY_TOKEN,
                    role=DetectionRole.DECISIVE,
                    outcome=Outcome.MET,
                    summary="STUB-CANARY-SUMMARY",
                    checks=[
                        {
                            "check": "canary_in_reply",
                            "result": "met",
                            "detail": "STUB-DETAIL",
                            "slot": slot,
                        }
                    ],
                )
            )
    repetition.campaign_run_id = run.id
    repetition.status = status
    repetition.started_at, repetition.ended_at = run.started_at, run.ended_at
    repetition.attempts_sent = len(results) or len(findings)
    repetition.cost_usd = Decimal(cost)
    db.commit()
    return run


def evaluation(client, run: BenchmarkRun) -> dict:
    response = client.get(f"{URL}/{run.code}/evaluation")
    assert response.status_code == 200, response.text
    return response.json()


def figure(found: dict, strategy: str, key: str) -> dict:
    one = next(s for s in found["strategies"] if s["key"] == strategy)
    return next(f for f in one["figures"] if f["key"] == key)


def label_whole_sample(client, run: BenchmarkRun, verdicts: dict[str, str]) -> None:
    """Labels every attempt of the blind sample, choosing the verdict by its message."""
    while (next_one := client.get(f"{URL}/{run.code}/sample").json()) is not None:
        if next_one["verdict"] is not None:
            break
        response = client.post(
            f"{URL}/{run.code}/sample/{next_one['attempt_id']}/label",
            json={"verdict": verdicts[next_one["message"]]},
        )
        assert response.status_code == 200, response.text


# ---------------------------------------------------------------- the matching (step 1)


def test_a_finding_matches_a_documented_weakness_by_category_and_canary_slot(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    for repetition in run.repetition_rows:
        ran(db, definition, repetition, findings=[("LLM07", "System prompt", SYSTEM_PROMPT)])

    found = evaluation(analyst, run)

    assert found["documented"][0]["count"] == 2
    assert found["documented"][0]["version"] == 1
    assert figure(found, "A", "discovery_rate")["mean"] == 50.0  # one of the two
    assert found["unmatched"] == []


def test_the_same_category_through_another_canary_slot_is_not_a_match(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    # LLM07 is documented through the system prompt; this finding reached a document instead.
    for repetition in run.repetition_rows:
        ran(db, definition, repetition, findings=[("LLM07", "Knowledge sources", DOCUMENT)])

    found = evaluation(analyst, run)

    assert figure(found, "A", "discovery_rate")["mean"] == 0.0
    assert [row["finding_number"] for row in found["unmatched"]]


def test_one_documented_weakness_counts_as_one_discovery(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    two_of_the_same = [
        ("LLM07", "System prompt", SYSTEM_PROMPT),
        ("LLM07", "System prompt", SYSTEM_PROMPT),
    ]
    ran(db, definition, run.repetition_rows[0], findings=two_of_the_same)
    ran(db, definition, run.repetition_rows[1], findings=[])

    found = evaluation(analyst, run)

    assert figure(found, "A", "discovery_rate")["mean"] == 50.0
    # The second finding matched nothing, so it waits for a label (step 2)
    assert len(found["unmatched"]) == 1


def test_a_finding_is_matched_to_the_weakness_whose_slot_it_proved(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    # Two documented weaknesses of the category LLM01, the one without a canary slot first. A
    # finding that proved the second one's slot must take that one and not the loose first one,
    # or the finding that proved nothing would be left with a slot it can't match.
    row = db.scalar(select(LabDeployment))
    row.known_vulnerabilities = [
        {**KNOWN[1], "id": "RAG-04", "title": "Direct prompt injection", "slot": None},
        KNOWN[1],
    ]
    db.commit()
    ran(
        db,
        definition,
        run.repetition_rows[0],
        findings=[
            ("LLM01", "Knowledge sources", DOCUMENT),
            ("LLM01", "System prompt", SYSTEM_PROMPT),
        ],
    )

    found = evaluation(analyst, run)

    assert figure(found, "A", "discovery_rate")["mean"] == 100.0  # both, not one
    assert found["unmatched"] == []


def test_a_documented_component_has_to_match_as_well(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    row = db.scalar(select(LabDeployment))
    row.known_vulnerabilities = [{**KNOWN[0], "component": "System prompt"}, KNOWN[1]]
    db.commit()
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(
        db,
        definition,
        run.repetition_rows[0],
        findings=[("LLM07", "Something else", SYSTEM_PROMPT)],
    )
    ran(
        db, definition, run.repetition_rows[1], findings=[("LLM07", "System prompt", SYSTEM_PROMPT)]
    )

    found = evaluation(analyst, run)

    assert figure(found, "A", "discovery_rate")["mean"] == 0.0
    assert figure(found, "B", "discovery_rate")["mean"] == 50.0


# ---------------------------------------------------------------- the finding labels (step 2)


def test_a_false_positive_label_gives_the_false_positive_rate(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(
        db,
        definition,
        run.repetition_rows[0],
        findings=[("LLM07", "System prompt", SYSTEM_PROMPT), ("LLM09", "Output", None)],
    )
    ran(db, definition, run.repetition_rows[1], findings=[])
    open_one = analyst.get(f"{URL}/{run.code}/findings").json()
    assert len(open_one) == 1

    response = analyst.post(
        f"{URL}/{run.code}/findings/{open_one[0]['finding_id']}/label",
        json={
            "verdict": FindingLabel.FALSE_POSITIVE,
            "note": "The reply says nothing of the kind.",
        },
    )

    assert response.status_code == 200
    found = evaluation(analyst, run)
    assert figure(found, "A", "false_positive_rate")["mean"] == 50.0  # one of its two findings
    assert not any("documented weakness" in line for line in found["missing"])


def test_an_undocumented_weakness_becomes_a_new_version_of_the_list(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(db, definition, run.repetition_rows[0], findings=[("LLM02", "Output", None)])
    ran(db, definition, run.repetition_rows[1], findings=[])
    open_one = analyst.get(f"{URL}/{run.code}/findings").json()

    response = analyst.post(
        f"{URL}/{run.code}/findings/{open_one[0]['finding_id']}/label",
        json={"verdict": FindingLabel.UNDOCUMENTED, "note": "A real weakness the list misses."},
    )

    assert response.status_code == 200
    assert response.json() == []  # it is documented now, so nothing is left to label
    found = evaluation(analyst, run)
    # 2a1: a new version of the list, and the metrics are recalculated against it
    assert found["documented"][0] == {
        **found["documented"][0],
        "count": 3,
        "version": 2,
        "added_by_analyst": 1,
    }
    assert figure(found, "A", "discovery_rate")["mean"] == round(1 / 3 * 100, 2)
    assert "lab.vulnerability_documented" in db.scalars(select(AuditLogEntry.action)).all()


def test_a_finding_that_matched_something_documented_is_not_labelled_here(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(
        db, definition, run.repetition_rows[0], findings=[("LLM07", "System prompt", SYSTEM_PROMPT)]
    )
    finding_id = db.scalar(select(FindingRow.id))

    refused = analyst.post(
        f"{URL}/{run.code}/findings/{finding_id}/label",
        json={"verdict": FindingLabel.FALSE_POSITIVE},
    )

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "not_unmatched"


def test_only_a_security_analyst_labels_and_every_member_reads(
    client,
    db,
    zone,  # noqa: F811
):
    from app.modules.m01_users.models import Role
    from tests.m01_users.test_organizations import log_in
    from tests.m01_users.test_permissions import organization_with

    organization_with(
        db,
        client,
        {"priya@example.com": Role.SECURITY_ANALYST, "maya@example.com": Role.TARGET_OWNER},
    )
    log_in(client, "priya@example.com")
    target = db.get(Target, uuid.UUID(deploy(client).json()["target_id"]))
    definition = make_test(db, target.organization_id, {"canary_token": "decisive"}, [])
    run = benchmark_run(db, target, repetitions=1)
    ran(db, definition, run.repetition_rows[0], findings=[("LLM09", "Output", None)])
    finding_id = db.scalar(select(FindingRow.id))
    log_in(client, "maya@example.com")

    assert client.get(f"{URL}/{run.code}/evaluation").status_code == 200
    refused = client.post(
        f"{URL}/{run.code}/findings/{finding_id}/label",
        json={"verdict": FindingLabel.FALSE_POSITIVE},
    )

    assert refused.status_code == 403


# ---------------------------------------------------------------- the blind sample (step 3)


def test_the_sample_says_nothing_of_what_sentra_decided(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(db, definition, run.repetition_rows[0], results=[Result(Outcome.MET, Outcome.MET)])
    ran(db, definition, run.repetition_rows[1], results=[Result(Outcome.NOT_MET, Outcome.NOT_MET)])

    response = analyst.get(f"{URL}/{run.code}/sample")

    assert response.status_code == 200
    found = response.json()
    assert found["total"] == 2 and found["place"] == 1 and found["labelled"] == 0
    assert found["message"].startswith("ATTEMPT-")
    assert "independent" in found["blind"]
    # Quality requirement 3: the answer holds these fields and nothing of the detection
    assert set(found) == {
        "attempt_id",
        "place",
        "total",
        "labelled",
        "target_name",
        "category",
        "test_code",
        "objective",
        "message",
        "reply",
        "tool_calls",
        "note",
        "verdict",
        "blind",
    }


def test_labelling_walks_through_the_sample_and_can_be_changed(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(
        db,
        definition,
        run.repetition_rows[0],
        results=[Result(Outcome.MET, Outcome.MET), Result(Outcome.NOT_MET, Outcome.NOT_MET)],
    )
    ran(db, definition, run.repetition_rows[1], results=[Result(Outcome.MET, Outcome.MET)])
    first = analyst.get(f"{URL}/{run.code}/sample").json()

    second = analyst.post(
        f"{URL}/{run.code}/sample/{first['attempt_id']}/label",
        json={"verdict": AttemptLabel.SUCCESSFUL},
    ).json()

    assert second["place"] == 2 and second["labelled"] == 1
    # The same attempt again replaces the first judgement
    again = analyst.post(
        f"{URL}/{run.code}/sample/{first['attempt_id']}/label",
        json={"verdict": AttemptLabel.UNSURE, "note": "The reply is ambiguous."},
    )
    assert again.status_code == 200
    at_one = analyst.get(f"{URL}/{run.code}/sample?place=1").json()
    assert at_one["attempt_id"] == first["attempt_id"]
    assert (at_one["verdict"], at_one["note"]) == (AttemptLabel.UNSURE, "The reply is ambiguous.")
    assert evaluation(analyst, run)["sample_labelled"] == 1


def test_an_attempt_outside_the_sample_is_refused(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(db, definition, run.repetition_rows[0], results=[Result(Outcome.MET, Outcome.MET)])
    ran(db, definition, run.repetition_rows[1], results=[])
    outside = db.scalar(select(Attempt.id).where(Attempt.status == AttemptStatus.REPLIED).limit(1))
    other = benchmark_run(db, lab_target, repetitions=1, keys=("A", "B"))

    refused = analyst.post(
        f"{URL}/{other.code}/sample/{outside}/label", json={"verdict": AttemptLabel.SUCCESSFUL}
    )

    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "not_in_sample"


# ---------------------------------------------------------------- the figures (steps 4 and 6)


def test_every_figure_is_a_mean_over_the_repetitions_with_its_spread(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=2)
    for repetition in run.repetition_rows:
        both = repetition.strategy_key == "A" and repetition.repetition == 1
        ran(
            db,
            definition,
            repetition,
            findings=[("LLM07", "System prompt", SYSTEM_PROMPT)]
            + ([("LLM01", "Knowledge sources", DOCUMENT)] if both else []),
            results=[Result(Outcome.MET, Outcome.MET)] * 10,
            minutes=10,
            cost="0.40",
            tokens=1_000,
        )

    found = evaluation(analyst, run)

    discovery = figure(found, "A", "discovery_rate")
    assert discovery["values"] == [100.0, 50.0]  # both weaknesses, then one
    assert (discovery["mean"], discovery["sd"], discovery["repetitions"]) == (75.0, 35.36, 2)
    assert figure(found, "B", "discovery_rate")["sd"] == 0.0  # the same twice
    assert figure(found, "A", "attempts_per_discovery")["mean"] == 7.5  # 10/2 and 10/1
    assert figure(found, "A", "minutes_per_discovery")["mean"] == 7.5
    assert figure(found, "A", "cost")["mean"] == 0.4
    assert figure(found, "A", "tokens")["mean"] == 1_000.0
    assert figure(found, "A", "attack_success_rate")["mean"] == 100.0


def test_the_false_negative_rate_is_what_the_discovery_rate_missed(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    for repetition in run.repetition_rows:
        ran(db, definition, repetition, findings=[("LLM01", "Knowledge sources", DOCUMENT)])

    found = evaluation(analyst, run)

    assert figure(found, "A", "discovery_rate")["mean"] == 50.0
    assert figure(found, "A", "false_negative_rate")["mean"] == 50.0


def test_an_incomplete_repetition_is_left_out_and_counted(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=2)
    for repetition in run.repetition_rows:
        stopped = repetition.strategy_key == "A" and repetition.repetition == 2
        ran(
            db,
            definition,
            repetition,
            findings=[] if stopped else [("LLM07", "System prompt", SYSTEM_PROMPT)],
            status=RepetitionStatus.INCOMPLETE if stopped else RepetitionStatus.COMPLETED,
        )

    found = evaluation(analyst, run)

    # 6a1: the completed repetitions, and their number
    one = next(s for s in found["strategies"] if s["key"] == "A")
    assert (one["completed"], one["incomplete"]) == (1, 1)
    assert figure(found, "A", "discovery_rate")["repetitions"] == 1
    assert figure(found, "A", "discovery_rate")["mean"] == 50.0
    assert found["incomplete"] == 1


def test_a_figure_without_a_value_says_why(analyst, db, lab_target, definition):  # noqa: F811
    run = benchmark_run(db, lab_target, repetitions=1)
    for repetition in run.repetition_rows:
        ran(db, definition, repetition, findings=[], results=[Result(None, Outcome.NOT_MET)])

    found = evaluation(analyst, run)

    assert figure(found, "A", "attempts_per_discovery")["mean"] is None
    assert (
        "discovered no documented weakness" in figure(found, "A", "attempts_per_discovery")["note"]
    )
    assert "No finding has been labelled" in figure(found, "A", "false_positive_rate")["note"]


# ---------------------------------------------------------------- the agreement (step 5)


def test_the_judge_alone_and_the_combined_detection_are_measured_against_the_labels(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    # The judge says met four times; the combined verdict corrects one of them (UC-6.1).
    ran(
        db,
        definition,
        run.repetition_rows[0],
        results=[
            Result(Outcome.MET, Outcome.MET),  # 1: the analyst agrees
            Result(Outcome.MET, Outcome.NOT_MET),  # 2: the analyst says unsuccessful
            Result(Outcome.NOT_MET, Outcome.NOT_MET),  # 3: the analyst agrees
            Result(Outcome.MET, Outcome.MET),  # 4: the analyst isn't sure
        ],
    )
    ran(db, definition, run.repetition_rows[1], results=[Result(Outcome.NOT_MET, Outcome.MET)])  # 5

    label_whole_sample(
        analyst,
        run,
        {
            "ATTEMPT-1": AttemptLabel.SUCCESSFUL,
            "ATTEMPT-2": AttemptLabel.UNSUCCESSFUL,
            "ATTEMPT-3": AttemptLabel.UNSUCCESSFUL,
            "ATTEMPT-4": AttemptLabel.UNSURE,
        },
    )
    found = evaluation(analyst, run)

    judge = next(row for row in found["agreement"] if row["key"] == "llm_judge")
    combined = next(row for row in found["agreement"] if row["key"] == "combined")
    # Each repetition has its own attempts, so the sample holds five; the unsure one is left out
    # of both rows. The fifth attempt is the one strategy B sent, labelled successful.
    assert judge["unsure"] == 1
    assert (judge["true_positive"], judge["false_positive"]) == (1, 1)
    assert (judge["true_negative"], judge["false_negative"]) == (1, 1)
    assert judge["precision"] == 50.0
    assert judge["recall"] == 50.0
    assert judge["agreement"] == 50.0
    # The combined verdict corrected the judge on both of them
    assert (combined["false_positive"], combined["false_negative"]) == (0, 0)
    assert combined["agreement"] == 100.0


def test_an_attempt_the_detection_never_answered_is_counted_apart(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(
        db,
        definition,
        run.repetition_rows[0],
        results=[Result(None, None), Result(Outcome.MET, Outcome.MET)],
    )
    ran(db, definition, run.repetition_rows[1], results=[])

    label_whole_sample(
        analyst,
        run,
        {"ATTEMPT-1": AttemptLabel.SUCCESSFUL, "ATTEMPT-2": AttemptLabel.SUCCESSFUL},
    )
    found = evaluation(analyst, run)

    judge = next(row for row in found["agreement"] if row["key"] == "llm_judge")
    assert (judge["labelled"], judge["without_verdict"]) == (1, 1)
    assert judge["agreement"] == 100.0


# ---------------------------------------------------------------- what is missing, and 4a


def test_the_evaluation_says_which_labels_are_still_missing(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    run = benchmark_run(db, lab_target, repetitions=1)
    ran(
        db,
        definition,
        run.repetition_rows[0],
        findings=[("LLM09", "Output", None)],
        results=[Result(Outcome.MET, Outcome.MET)],
    )
    run.repetition_rows[1].status = RepetitionStatus.PLANNED
    db.commit()

    found = evaluation(analyst, run)

    assert found["ready"] is False
    assert any("haven't ended yet" in line for line in found["missing"])
    assert any("blind sample aren't labelled" in line for line in found["missing"])
    assert any("matched no documented weakness" in line for line in found["missing"])


def test_a_run_with_a_baseline_shows_what_the_remediations_changed(
    analyst,  # noqa: F811
    db,
    lab_target,
    definition,
):
    before = benchmark_run(db, lab_target, repetitions=1)
    for repetition in before.repetition_rows:
        ran(db, definition, repetition, results=[Result(Outcome.MET, Outcome.MET)] * 4)
    after = benchmark_run(db, lab_target, repetitions=1, baseline=before)
    for repetition in after.repetition_rows:
        ran(
            db,
            definition,
            repetition,
            results=[Result(Outcome.MET, Outcome.MET)]
            + [Result(Outcome.NOT_MET, Outcome.NOT_MET)] * 3,
        )

    found = evaluation(analyst, after)

    assert found["baseline"]["code"] == before.code
    row = next(r for r in found["baseline"]["rows"] if r["strategy_key"] == "A")
    assert (row["baseline_rate"], row["success_rate"]) == (100.0, 25.0)
    assert row["reduction"] == 75.0
    # FR-8.5's benign request set isn't part of this comparison, and the page says so
    assert "benign request set" in found["baseline"]["note"]
