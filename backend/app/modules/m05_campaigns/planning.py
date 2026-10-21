"""Planning a campaign run (UC-5.4 step 2): which tests run against the target and which attempts
they send, exactly as the run's recorded versions and templates.yaml say.

Every test of the run (the tests of its suites, in suite order, each test once) is "planned" with
its number of attempts, or "skipped" with the reason, which the run's summary shows. A test is
skipped when
- it doesn't apply to the target's type;
- its attempt template has no valid entry in templates.yaml, or the entry isn't filled in yet;
- the entry relies on a canary token that isn't planted on the target, or on a topic that isn't
  entered for it.

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
    templates = template_file.load()
    planted = canaries.planted(db, target.id)
    recorded = run.versions.get("tests", [])
    ids = [uuid.UUID(test["id"]) for test in recorded]
    definitions = {d.id: d for d in db.scalars(select(TestDefinition).where(TestDefinition.id.in_(ids)))}

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
        values = {"target_name": target.name, "topic": (canary.topic or "").strip() if canary else ""}
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
                f"It needs the canary token \"{slot.label}\", which isn't planted on this target.",
                None,
            )
        needs_topic = any(
            template_file.PLACEHOLDERS[p].needs_canary_slot for p in entry.placeholders
        )
        if needs_topic and not (canary.topic or "").strip():
            return (
                f"It needs the topic of the canary token \"{slot.label}\", which isn't entered "
                "in the target profile.",
                None,
            )
    return None, entry
