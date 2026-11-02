"""Planning a campaign run (UC-5.4 step 2): which tests run against the target and which attempts
they send, exactly as the run's recorded versions and templates.yaml say.

Every test of the run (the tests of its suites, in suite order, each test once) is "planned" with
its number of attempts, or "skipped" with the reason, which the run's summary shows. A test is
skipped when
- it doesn't apply to the target's type;
- its attempt template has no valid entry in templates.yaml, or the entry isn't filled in yet;
- the entry relies on a canary token that isn't planted on the target, or on a topic that isn't
  entered for it.

A run can also carry the attempts it repeats instead of a campaign's suites: `settings["replay"]`
names the attempts of earlier runs and how often each is sent again. A retest uses it (FR-8.4,
UC-8.6 step 3), because before and after have to be measured with the same requests, not merely
with the same template; the messages come from the stored attempts, so nothing is built here.

Each message of a template entry becomes one attempt, sent in a new conversation with the target.
The placeholders are filled from the target's own registration and profile, never from its
replies (templates.PLACEHOLDERS). The attempts of all tests are interleaved (the first message of
every test, then the second of every test, …), so a small budget still reaches every test.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.m02_targets import canaries
from app.modules.m02_targets.models import Target, TargetCanary
from app.modules.m04_tests.models import TestDefinition
from app.modules.m05_campaigns.models import Attempt, AttemptPriority, CampaignRun
from app.modules.m05_campaigns.service import TYPE_NAME
from app.workers.orchestrator import templates as template_file
from app.workers.orchestrator.templates import TemplateEntry, Templates


@dataclass
class Plan:
    tests: list[dict] = field(default_factory=list)  # for CampaignRun.plan
    attempts: list[Attempt] = field(default_factory=list)
    # The digest of the file and of each entry the attempts come from (FR-4.5)
    templates: dict = field(default_factory=dict)

    @property
    def planned(self) -> int:
        return sum(1 for test in self.tests if test["status"] == "planned")


def plan(db: Session, run: CampaignRun, target: Target) -> Plan:
    """The tests and attempts of `run`. The attempts are added to the session; the caller
    commits."""
    replay = (run.settings or {}).get("replay")
    if replay:
        return _replay(db, run, replay)
    templates = template_file.load()
    planted = canaries.planted(db, target.id)
    recorded = run.versions.get("tests", [])
    ids = [uuid.UUID(test["id"]) for test in recorded]
    definitions = {
        d.id: d for d in db.scalars(select(TestDefinition).where(TestDefinition.id.in_(ids)))
    }

    result = Plan(templates={"file": templates.digest, "entries": {}})
    messages_of: list[tuple[TestDefinition, dict, list[str]]] = []
    for test in recorded:
        definition = definitions.get(uuid.UUID(test["id"]))
        row = {
            "code": test["code"],
            "version": test["version"],
            "name": definition.name if definition else test["code"],
            "suites": test.get("suites", []),
            "template": definition.attempt_template if definition else None,
            "status": "skipped",
            "reason": None,
            "attempts": 0,
        }
        result.tests.append(row)
        if definition is None:
            row["reason"] = "Its test definition can't be found."
            continue
        reason, entry = _usable_entry(definition, target, templates, planted)
        if reason:
            row["reason"] = reason
            continue
        canary = planted.get(entry.canary_slot) if entry.canary_slot else None
        # One value for every placeholder of templates.PLACEHOLDERS
        values = {
            "target_name": target.name,
            "topic": (canary.topic or "").strip() if canary else "",
        }
        messages = [template_file.fill(message, values) for message in entry.messages]
        row["status"], row["attempts"] = "planned", len(messages)
        result.templates["entries"][definition.attempt_template] = entry.digest()
        messages_of.append((definition, test, messages))

    number = 0
    for variant in range(1, template_file.MAX_MESSAGES + 1):
        for definition, test, messages in messages_of:
            if variant > len(messages):
                continue
            number += 1
            suites = test.get("suites") or [None]
            attempt = Attempt(
                organization_id=run.organization_id,
                campaign_run_id=run.id,
                attempt_no=number,
                test_definition_id=definition.id,
                test_code=definition.code,
                suite_code=suites[0],
                template=definition.attempt_template,
                variant=variant,
                priority=AttemptPriority.PLANNED,
                input=messages[variant - 1],
                session_id=uuid.uuid4().hex,
            )
            db.add(attempt)
            result.attempts.append(attempt)
    return result


def _replay(db: Session, run: CampaignRun, replay: dict) -> Plan:
    """The attempts of a run that repeats earlier ones (FR-8.4): each attempt named in
    `settings["replay"]` is sent again `times` times, in its own new conversation with the target.

    The message, the test definition and the attempt template are the ones of the stored attempt,
    so the request is the same as the one that was answered before. An attempt that can't be found
    any more, or that belongs to another target, is left out and the plan says so.
    """
    times = max(1, int(replay.get("times") or 1))
    wanted = [uuid.UUID(str(one)) for one in replay.get("attempt_ids") or []]
    earlier = {
        attempt.id: attempt
        for attempt in db.scalars(
            select(Attempt)
            .join(CampaignRun, CampaignRun.id == Attempt.campaign_run_id)
            .where(
                Attempt.id.in_(wanted),
                Attempt.organization_id == run.organization_id,
                CampaignRun.target_id == run.target_id,
            )
        )
    }
    found = [earlier[one] for one in wanted if one in earlier]
    missing = len(wanted) - len(found)
    result = Plan(
        templates={"file": "replay", "entries": {}, "replayed": [str(a.id) for a in found]}
    )
    by_test: dict[str, dict] = {}
    for attempt in found:
        row = by_test.setdefault(
            attempt.test_code,
            {
                "code": attempt.test_code,
                "version": _version_of(run, attempt.test_code),
                "name": attempt.test_code,
                "suites": [attempt.suite_code] if attempt.suite_code else [],
                "template": attempt.template,
                "status": "planned",
                "reason": None,
                "attempts": 0,
            },
        )
        row["attempts"] += times
    result.tests = list(by_test.values())
    if missing:
        result.tests.append(
            {
                "code": "",
                "version": 0,
                "name": "Attempts that are no longer there",
                "suites": [],
                "template": None,
                "status": "skipped",
                "reason": f"{missing} of the attempts to repeat couldn't be found any more.",
                "attempts": 0,
            }
        )
    number = 0
    for _ in range(times):  # the first attempt of every message, then the second, …
        for attempt in found:
            number += 1
            again = Attempt(
                organization_id=run.organization_id,
                campaign_run_id=run.id,
                attempt_no=number,
                test_definition_id=attempt.test_definition_id,
                test_code=attempt.test_code,
                suite_code=attempt.suite_code,
                template=attempt.template,
                variant=attempt.variant,
                priority=AttemptPriority.PLANNED,
                input=attempt.input,
                session_id=uuid.uuid4().hex,
            )
            db.add(again)
            result.attempts.append(again)
    return result


def _version_of(run: CampaignRun, code: str) -> int:
    """The version of the test the run recorded for its own traceability (FR-4.5)."""
    for test in (run.versions or {}).get("tests", []):
        if test.get("code") == code:
            return int(test.get("version") or 0)
    return 0


def _usable_entry(
    definition: TestDefinition,
    target: Target,
    templates: Templates,
    planted: dict[str, TargetCanary],
) -> tuple[str | None, TemplateEntry | None]:
    """The template entry the test's attempts come from, or why the test is skipped."""
    if target.type not in definition.target_types:
        return f"It doesn't apply to a {TYPE_NAME.get(target.type, target.type)}.", None
    name = definition.attempt_template
    problem = templates.problem(name)
    if problem:
        return f"Its attempt template {name} can't be used: {problem}", None
    entry = templates.entries.get(name)
    if entry is None:
        return f"Its attempt template {name} has no entry in templates.yaml.", None
    if not entry.filled_in:
        return f"Its attempt template {name} isn't filled in yet in templates.yaml.", None
    if entry.canary_slot:
        slot = canaries.BY_KEY[entry.canary_slot]
        canary = planted.get(entry.canary_slot)
        if canary is None:
            return (
                f'It needs the canary token "{slot.label}", which isn\'t planted on this target.',
                None,
            )
        needs_topic = any(
            template_file.PLACEHOLDERS[p].needs_canary_slot for p in entry.placeholders
        )
        if needs_topic and not (canary.topic or "").strip():
            return (
                f'It needs the topic of the canary token "{slot.label}", which isn\'t entered '
                "in the target profile.",
                None,
            )
    return None, entry
