"""The adaptive testing agent (FR-5.5, UC-5.5): when a planned attempt doesn't reach its test's
objective, the agent may write the next one from what the target replied.

This file is the shell. What the agent is *told* — the fixed instructions and the refinement
rules — is `instructions.py`, which belongs to the person who writes Sentra's attack content; the
shell only reads it. What the shell is responsible for is everything that keeps a refinement
inside what the analyst approved:

- **Scope** (step 3, 3a1). A refinement is always a new attempt *of the same test*, so its
  category is the campaign's by construction, and the attempt is sent to the campaign's one
  verified target like any other. On top of that the proposal itself is checked: it must be text,
  within the length a target accepts, different from what was already tried, free of any address
  that isn't the target's own, and free of the target's canary tokens — the agent plants nothing.
  A proposal that fails is discarded with its reason, and the agent is asked once more (3a1).
- **Budget** (step 6, FR-5.7). The agent refines at most `agent_max_refinements_per_test` times
  along one chain, and only while a share of the run's attempt budget is still free. It never
  sends anything itself: it adds a planned attempt, which the run engine sends under the same
  budget, rate and limits as every other attempt.
- **Stopping** (2a1). The agent stops **for the whole run**, with one row that says why and an
  audit entry (FR-10.2), and the run goes on with its planned tests, when: the model can't be
  reached or the organization's monthly LLM cost limit is reached; the agent's own cost cap or its
  cap of refinements per run is reached; too many of its requests in a row fail; the target is
  no longer a verified one; or an analyst stops it by hand. That is UC-5.5's failed end condition,
  and it is not an error. The per-test chain limit is not a stop: it only ends that one chain.
- **The record** (step 5). Every request to the agent is a row of `agent_refinements`, sent or
  not, with the reason, the instructions version and what it cost; the attempt that comes of it
  carries the same reason, so the live monitor can show it.

The agent has no tools and reaches nothing: it gets text and returns text (quality requirement 2).
"""

import json
import logging
import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.llm import layer
from app.llm.config import LLMTask
from app.llm.layer import LLMError, LLMOutputError, LLMUnavailable
from app.llm.models import LLMUsage
from app.modules.m02_targets.models import Target, TargetCanary, TargetStatus
from app.modules.m04_tests.models import TestDefinition
from app.modules.m05_campaigns.lifecycle import now, record
from app.modules.m05_campaigns.models import (
    AgentRefinement,
    Attempt,
    AttemptPriority,
    AttemptStatus,
    CampaignRun,
    RefinementState,
)
from app.modules.m06_findings.models import DetectionVerdict, Outcome
from app.workers.agent import instructions as written
from app.workers.connector.connector import Reply

log = logging.getLogger("uvicorn.error")

MAX_MESSAGE_CHARS = 4_000  # what a refined attempt may be, as a target's own limits allow
NOT_CONFIGURED = (
    "The adaptive testing agent has no instructions yet, so this run uses its planned tests only."
)
NO_MODEL = (
    "No model is assigned to the adaptive testing agent, so this run uses its planned tests only."
)
BUDGET_SPENT = "The share of the attempt budget kept for refinements is used up."
RUN_CAP = "The agent reached its limit of {number} refinements for this run."
COST_CAP = "The agent reached its cost limit of ${cap:.2f} for this run."
FAILING = "The agent stopped after {number} requests in a row that gave nothing that could be sent."
NOT_VERIFIED = "The run's target is no longer a verified target, so the agent stopped."
BY_HAND = "Stopped by {who}."
OUT_OF_SCOPE = "The proposed attempt fell outside the approved scope: {why}"
NOTHING_USABLE = "The model proposed nothing that could be sent."


class Refinement(BaseModel):
    """What the agent must answer with, and the only thing the shell reads from it."""

    message: str = Field(description="The next attempt to send to the target.")
    reason: str = Field(description="One short sentence on why this attempt follows from the last.")


@dataclass
class Context:
    """What the agent is given (step 1): the test's objective and category, the attempt that was
    sent, what the target replied, and what has already been tried along this chain."""

    test_code: str
    category: str
    objective: str
    success_condition: str
    attempt: str
    reply: str
    tool_calls: str | None
    earlier: list[str] = field(default_factory=list)
    refinements_left: int = 0

    def as_data(self) -> str:
        """The plain form the shell sends when `instructions.py` offers no `context()` of its own.
        Everything here is data: the LLM layer delimits it and masks it (NFR-9.6)."""
        parts = [
            f"Test: {self.test_code} ({self.category})",
            f"Objective: {self.objective}",
            f"Success condition: {self.success_condition}",
            f"Attempt that was sent: {self.attempt}",
            f"The target replied: {self.reply}",
        ]
        if self.tool_calls:
            parts.append(f"Tool calls the target made: {self.tool_calls}")
        if self.earlier:
            parts.append("Already tried in this chain:\n- " + "\n- ".join(self.earlier))
        parts.append(f"Refinements left for this test: {self.refinements_left}")
        return "\n\n".join(parts)


# ---------------------------------------------------------------- is there anything to do?


def enabled(run: CampaignRun) -> bool:
    """The campaign had the agent switched on when the run was launched (UC-5.1 step 4). A run's
    settings are a copy, so turning the campaign's switch off later doesn't change a run going."""
    return bool((run.settings or {}).get("adaptive_agent"))


def _stopped(db: Session, run_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(func.count())
            .select_from(AgentRefinement)
            .where(
                AgentRefinement.campaign_run_id == run_id,
                AgentRefinement.state == RefinementState.STOPPED,
            )
        )
        or 0
    ) > 0


def _chain(db: Session, attempt: Attempt) -> list[Attempt]:
    """The attempts of this test in this run that the agent wrote, oldest first."""
    return list(
        db.scalars(
            select(Attempt)
            .where(
                Attempt.campaign_run_id == attempt.campaign_run_id,
                Attempt.test_code == attempt.test_code,
                Attempt.refinement_reason.is_not(None),
            )
            .order_by(Attempt.attempt_no)
        )
    )


def _budget_left(db: Session, run: CampaignRun) -> int:
    """How many refinements the run's remaining attempt budget still allows. The agent uses at
    most its share of the budget, so a run can never spend everything on refinements (FR-5.7)."""
    settings = get_settings()
    share = int(run.attempt_budget * settings.agent_budget_share)
    used = _sent_total(db, run.id)
    planned = (
        db.scalar(
            select(func.count())
            .select_from(Attempt)
            .where(Attempt.campaign_run_id == run.id, Attempt.status == AttemptStatus.PLANNED)
        )
        or 0
    )
    room = run.attempt_budget - run.attempts_sent - planned
    return max(0, min(share - used, room))


def _sent_total(db: Session, run_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(AgentRefinement)
            .where(
                AgentRefinement.campaign_run_id == run_id,
                AgentRefinement.state == RefinementState.SENT,
            )
        )
        or 0
    )


def _cost(db: Session, run_id: uuid.UUID) -> Decimal:
    """What the agent's requests have cost in this run, failed ones included: the layer records
    every request, and the run's cost on the monitor counts the same rows (UC-5.6 step 2)."""
    return db.scalar(
        select(func.coalesce(func.sum(LLMUsage.cost_usd), 0)).where(
            LLMUsage.campaign_run_id == run_id, LLMUsage.task == LLMTask.ADAPTIVE_TESTING.value
        )
    ) or Decimal(0)


def _failures_in_a_row(db: Session, run_id: uuid.UUID) -> int:
    """How many of the newest requests in a row gave nothing that could be sent: an answer that
    couldn't be used, or a proposal outside the scope. A sent refinement ends the streak."""
    states = db.scalars(
        select(AgentRefinement.state)
        .where(AgentRefinement.campaign_run_id == run_id)
        .order_by(AgentRefinement.created_at.desc(), AgentRefinement.id.desc())
        .limit(get_settings().agent_max_failures_in_a_row)
    )
    streak = 0
    for state in states:
        if state not in (RefinementState.REFUSED, RefinementState.DISCARDED):
            break
        streak += 1
    return streak


def limit_reached(db: Session, run: CampaignRun, target: Target | None) -> str | None:
    """Why the agent must stop for the rest of this run, or None. These are the run-wide limits
    (FR-5.7); the per-test chain limit and the budget share only end one chain and are not here."""
    settings = get_settings()
    if target is None or target.status != TargetStatus.VERIFIED or target.id != run.target_id:
        return NOT_VERIFIED
    if _sent_total(db, run.id) >= settings.agent_max_refinements_per_run:
        return RUN_CAP.format(number=settings.agent_max_refinements_per_run)
    if _cost(db, run.id) >= Decimal(str(settings.agent_cost_cap_usd)):
        return COST_CAP.format(cap=settings.agent_cost_cap_usd)
    if _failures_in_a_row(db, run.id) >= settings.agent_max_failures_in_a_row:
        return FAILING.format(number=settings.agent_max_failures_in_a_row)
    return None


def stop(db: Session, run: CampaignRun, reason: str, *, after: Attempt | None = None, actor=None):
    """Stops the agent for the rest of the run (UC-5.5, 2a1): one row says why, and the audit log
    gets an entry (FR-10.2) in the actor's name, or Sentra's own when nobody stopped it. The
    run itself is untouched. The caller commits. Stopping twice records nothing the second time."""
    if _stopped(db, run.id):
        return None
    row = _record(db, run, after, RefinementState.STOPPED, reason)
    record(
        db,
        run,
        "campaign.agent_stopped",
        f"Stopped the adaptive testing agent of campaign run {run.number}",
        actor=actor,
        details={"reason": reason[:500]},
    )
    return row


# ---------------------------------------------------------------- the scope check (step 3)


def _canaries(db: Session, target_id: uuid.UUID) -> list[str]:
    return list(db.scalars(select(TargetCanary.token).where(TargetCanary.target_id == target_id)))


def in_scope(db: Session, message: str, target: Target, earlier: list[str]) -> str | None:
    """Why this proposal may not be sent, or None when it may be. The category and the target are
    not checked here: a refinement is another attempt of the same test, which the run engine sends
    to the campaign's one verified target."""
    text = (message or "").strip()
    if not text:
        return "it is empty"
    if len(text) > MAX_MESSAGE_CHARS:
        return f"it is longer than the {MAX_MESSAGE_CHARS:,} characters an attempt may be"
    if any(text == was.strip() for was in earlier):
        return "it repeats an attempt that was already sent"
    for token in _canaries(db, target.id):
        if token and token in text:
            return "it contains one of the target's canary tokens"
    for address in _addresses(text):
        if address != _host(target.endpoint_url):
            return f"it names {address}, which is not the target"
    return None


def _host(url: str) -> str:
    rest = url.split("//", 1)[-1]
    return rest.split("/", 1)[0].split("@")[-1].split(":")[0].lower()


def _addresses(text: str) -> set[str]:
    """Every host an attempt names, so that nothing is pointed at another system (NFR-9.2)."""
    import re

    found = set()
    for match in re.finditer(r"\b(?:https?://|ftp://|ssh://)([^\s/\\'\"<>)\]]+)", text, re.I):
        found.add(match.group(1).split("@")[-1].split(":")[0].lower())
    return found


# ---------------------------------------------------------------- one refinement (steps 1-5)


def _record(db: Session, run: CampaignRun, after: Attempt, state: str, reason: str, **fields):
    row = AgentRefinement(
        organization_id=run.organization_id,
        campaign_run_id=run.id,
        # Written here and not by the database, so the trail keeps the order it happened in:
        # two rows of one transaction would share `now()`.
        created_at=now(),
        after_attempt_id=after.id if after is not None else None,
        test_code=after.test_code if after is not None else "",
        state=state,
        reason=reason[:2000],
        **fields,
    )
    db.add(row)
    db.flush()
    return row


def _ask(db: Session, run: CampaignRun, context: Context) -> tuple[Refinement | None, dict]:
    """Step 2: the model writes the next attempt. The instructions are Sentra's own text and the
    target's words go in as data, which the LLM layer delimits and masks (NFR-3.6, NFR-9.6)."""
    data = written.context(context) if hasattr(written, "context") else context.as_data()
    done = layer.complete(
        db,
        LLMTask.ADAPTIVE_TESTING,
        instructions=written.INSTRUCTIONS,
        data=data,
        organization_id=run.organization_id,
        schema=Refinement,
        campaign_run_id=run.id,
        max_tokens=800,
    )
    about = {
        "model": done.model,
        "cost_usd": done.cost_usd,
        "instructions_version": (written.VERSION or None),
    }
    if isinstance(done.parsed, Refinement):
        return done.parsed, about
    try:  # a model that answered JSON without the layer parsing it
        return Refinement(**json.loads(done.text)), about
    except Exception:
        return None, about


def refine(db: Session, attempt: Attempt, reply: Reply) -> dict | None:
    """UC-5.5 for one attempt that got a reply. Returns what the live monitor shows under
    "agent", or None when the agent had nothing to do with this attempt."""
    run = db.get(CampaignRun, attempt.campaign_run_id)
    if run is None or not enabled(run) or _stopped(db, run.id):
        return None
    if not (written.INSTRUCTIONS or "").strip():
        # Nothing to say to the model yet: the run goes on with its planned tests, and the run's
        # own page says why once (UC-5.5, failed end condition). The live stream stays quiet.
        stop(db, run, NOT_CONFIGURED, after=attempt)
        db.commit()
        return None
    verdict = db.scalar(select(DetectionVerdict).where(DetectionVerdict.attempt_id == attempt.id))
    if verdict is not None and verdict.outcome == Outcome.MET:
        return None  # the objective is reached; there is nothing to refine (step 6)
    target = db.get(Target, run.target_id)
    why_stop = limit_reached(db, run, target)
    if why_stop is not None:  # FR-5.7: a limit of the whole run is reached
        stop(db, run, why_stop, after=attempt)
        db.commit()
        return {"stopped": why_stop, "discarded": 0}
    chain = _chain(db, attempt)
    left = get_settings().agent_max_refinements_per_test - len(chain)
    if left <= 0 or _budget_left(db, run) <= 0:
        return None
    definition = db.get(TestDefinition, attempt.test_definition_id)
    earlier = [one.input for one in chain] + [attempt.input]
    context = Context(
        test_code=attempt.test_code,
        category=definition.category if definition else "",
        objective=definition.objective if definition else "",
        success_condition=definition.success_condition if definition else "",
        attempt=attempt.input,
        reply=attempt.reply or reply.text,
        tool_calls=attempt.tool_calls,
        earlier=[one.input for one in chain],
        refinements_left=left,
    )
    discarded = 0
    for _try in range(2):  # 3a1: a proposal outside the scope is discarded and another is asked
        if _try:  # a failure of the first request may have used up the failures allowed in a row
            why_stop = limit_reached(db, run, target)
            if why_stop is not None:
                stop(db, run, why_stop, after=attempt)
                db.commit()
                return {"stopped": why_stop, "discarded": discarded}
        try:
            proposal, about = _ask(db, run, context)
        except LLMOutputError as exc:  # it answered, but not in the form that was asked for
            _record(db, run, attempt, RefinementState.REFUSED, f"{NOTHING_USABLE} {exc}")
            db.commit()
            continue
        except (LLMUnavailable, LLMError) as exc:  # 2a1: it can't be reached, or the cost limit
            stop(db, run, f"The agent stopped: {exc}", after=attempt)
            db.commit()
            return {"stopped": str(exc), "discarded": discarded}
        if proposal is None:
            _record(db, run, attempt, RefinementState.REFUSED, NOTHING_USABLE, **about)
            db.commit()
            continue
        why = in_scope(db, proposal.message, target, earlier)
        if why is not None:
            _record(
                db, run, attempt, RefinementState.DISCARDED, OUT_OF_SCOPE.format(why=why), **about
            )
            db.commit()
            earlier.append(proposal.message)
            discarded += 1
            continue
        follow_up = _add_attempt(db, run, attempt, proposal)
        _record(
            db,
            run,
            attempt,
            RefinementState.SENT,
            proposal.reason.strip()[:2000],
            attempt_id=follow_up.id,
            **about,
        )
        db.commit()
        log.info(
            "The agent added attempt %s to run %s (%s)",
            follow_up.attempt_no,
            run.number,
            attempt.test_code,
        )
        return {
            "refined": True,
            "attempt_no": follow_up.attempt_no,
            "reason": follow_up.refinement_reason,
            "discarded": discarded,
        }
    return {"refined": False, "discarded": discarded}


def _add_attempt(db: Session, run: CampaignRun, after: Attempt, proposal: Refinement) -> Attempt:
    """Step 4: the refinement joins the run as an ordinary attempt, so it is sent, evaluated,
    counted and limited exactly like a planned one. It goes before the rest of the plan but after
    retries (AttemptPriority.FOLLOW_UP), and starts a conversation of its own."""
    highest = (
        db.scalar(select(func.max(Attempt.attempt_no)).where(Attempt.campaign_run_id == run.id))
        or 0
    )
    follow_up = Attempt(
        organization_id=run.organization_id,
        campaign_run_id=run.id,
        attempt_no=highest + 1,
        test_definition_id=after.test_definition_id,
        test_code=after.test_code,
        suite_code=after.suite_code,
        template=after.template,
        variant=after.variant,
        priority=AttemptPriority.FOLLOW_UP,
        status=AttemptStatus.PLANNED,
        input=proposal.message.strip(),
        session_id=uuid.uuid4().hex,
        refinement_reason=proposal.reason.strip()[:2000],
    )
    db.add(follow_up)
    db.flush()
    return follow_up
