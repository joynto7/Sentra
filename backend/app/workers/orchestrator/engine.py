"""The run engine (FR-5.4, FR-5.6, FR-5.7; UC-5.4): what a Background Worker does with a campaign
run each time the run's job comes.

A worker works on a run in slices (NFR-6.4): it takes the run's lease, works on the run for at most
run_slice_seconds, gives the lease back and puts the run at the end of the queue, so every run gets
its turn. In each slice the engine
1. ignores a stale job, and looks again later at a run whose lease another worker holds (NFR-2.2);
2. before the first attempt, waits for the campaign's time window, checks the target's ownership
   again and plans the run (UC-5.4 steps 1-2, 1a);
3. calls the send loop (send_loop.py) with a RunContext;
4. ends, pauses or re-queues the run, as its limits and its users decide (steps 5-6).

The send loop sends the attempts. Every limit of a run is kept here, around it: no attempt beyond
the budget, the request rate, the time window or the organization's monthly limits, none after a
pause or a stop, none to a target that is no longer verified; and a run whose target is overloaded
or can't be reached stops or pauses (FR-5.7, NFR-2.3).
"""

import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.llm.masking import mask
from app.modules.m02_targets import verification
from app.modules.m02_targets.models import CheckStatus, Target, TargetStatus
from app.modules.m05_campaigns import lifecycle, limits, planning
from app.modules.m05_campaigns.lifecycle import now
from app.modules.m05_campaigns.models import (
    ENDED,
    Attempt,
    AttemptPriority,
    AttemptStatus,
    CampaignRun,
    EndReason,
    PauseKind,
    RunStatus,
)
from app.modules.m05_campaigns.window import Window
from app.workers.connector import pacing
from app.workers.connector.connector import Reply
from app.workers.connector.errors import (
    AddressRefused,
    BadResponse,
    BudgetExhausted,
    ConnectorError,
    NotVerified,
    TargetHTTPError,
    TargetOverloaded,
    TargetRedirect,
    TargetTimeout,
    TargetUnreachable,
)
from app.workers.orchestrator import hooks, live, send_loop

log = logging.getLogger("uvicorn.error")
STEP_SECONDS = 0.5  # a wait looks at the run this often, so a stop works within 5 s (FR-5.6)
MAX_REPLY_CHARS = 65_536  # of the masked reply kept with an attempt (Attempt.reply)
EXCERPT_CHARS = 500  # of the input and the reply in a live event
MAX_HOLD_SECONDS = 600  # the longest break an overloaded target gets before the next request
WORKER_ERROR_DELAY_SECONDS = 15
# A slice that sent nothing although attempts are left waits this long before the next one, so a
# send loop that returns too early doesn't keep a worker busy.
IDLE_DELAY_SECONDS = 5
sleep = time.sleep  # the tests replace it

ERROR_KIND = {
    TargetOverloaded: "overloaded",
    TargetUnreachable: "unreachable",
    TargetTimeout: "timeout",
    TargetHTTPError: "http_error",
    TargetRedirect: "redirect",
    BadResponse: "bad_response",
    NotVerified: "not_verified",
    AddressRefused: "address_refused",
    BudgetExhausted: "budget",
}
NO_SEND_LOOP = "No attempt was sent: the send loop of campaign runs isn't written yet."
INTERNAL_ERROR_TEXT = (
    "Stopped because Sentra failed several times in a row while working on this run. "
    "The attempts sent until then are kept."
)


class RunInterrupted(Exception):
    """The run may not send now: it was paused or stopped, its limits are reached, or another
    worker took it over. RunContext.wait() and an attempt's budget raise it, so nothing more is
    sent; the engine then reads why."""


@dataclass
class Decision:
    """What happens to the run when the slice ends."""

    kind: str  # "end", "pause" (automatic) or "later"
    message: str
    status: RunStatus | None = None  # for "end"
    reason: EndReason | None = None  # for "end"
    delay: float = 0.0  # for "pause" and "later": seconds until the run is looked at again
    limit_reached: bool = False  # a monthly limit: the administrators are told


class RunContext:
    """What the send loop gets in one slice of a running run, and the only way it sends.

    - next_attempt(): the next attempt to send, or None when the send loop must return.
    - send_options(attempt): the keyword arguments of connector.send() for it. They carry the
      run's request rate, a wait that notices pause and stop, and the budget, which counts the
      attempt as sent at the last moment before the request (FR-5.6, FR-5.7).
    - replied(attempt, reply) / failed(attempt, error): the result of each attempt that was given
      to connector.send(). The engine records it, applies the safety limits, lets the extensions
      evaluate it and shows it on the live monitor.

    The engine's own exceptions, RunInterrupted and pacing.TooLongToWait, must reach the engine:
    they mean that nothing was sent.
    """

    def __init__(
        self,
        db: Session,
        run: CampaignRun,
        target: Target,
        owner: uuid.UUID,
        token: uuid.UUID,
        slice_ends: float,
    ) -> None:
        self.db = db
        self.run = run  # read it, don't change it: the engine does
        self.target = target
        self.decision: Decision | None = None
        self.taken = 0  # attempts sent in this slice
        self._owner, self._token, self._slice_ends = owner, token, slice_ends

    # ------------------------------------------------------------ for the send loop

    def next_attempt(self) -> Attempt | None:
        """A retry first, then the attempts that later features add while the run goes on, then
        the plan in order (AttemptPriority). None when no attempt is left, or when the run must not
        send another one in this slice: it was paused or stopped, a limit is reached, the slice is
        over. The lease is renewed each time."""
        if self.decision is not None or not self._may_go_on():
            return None
        return self.db.scalar(
            select(Attempt)
            .where(Attempt.campaign_run_id == self.run.id, Attempt.status == AttemptStatus.PLANNED)
            .order_by(Attempt.priority, Attempt.attempt_no)
            .limit(1)
            .execution_options(populate_existing=True)
        )

    def send_options(self, attempt: Attempt) -> dict:
        return {
            "session_id": attempt.session_id,
            "rate_per_minute": self.run.request_rate,
            "wait": self.wait,
            "max_wait": max(self._slice_ends - time.monotonic(), STEP_SECONDS),
            "budget": _AttemptBudget(self, attempt.id),
        }

    def wait(self, seconds: float) -> None:
        """Waits like time.sleep(), but looks at the run every half second and raises
        RunInterrupted as soon as it must not send any more (FR-5.6: a stop within 5 seconds)."""
        ends = time.monotonic() + seconds
        while (left := ends - time.monotonic()) > 0:
            if not self._still_ours():
                raise RunInterrupted()
            sleep(min(STEP_SECONDS, left))

    def replied(self, attempt: Attempt, reply: Reply) -> None:
        """Records the reply of an attempt that was sent: masked (NFR-3.6, NFR-8.2), at most
        64 KB. Then the extensions evaluate the raw reply (UC-5.4 step 4) and the monitor shows
        the attempt (UC-5.6 step 3). An attempt already sent is recorded even after a pause or a
        stop (UC-5.7, quality requirement 3)."""
        db = self.db
        if not self._sending(attempt):
            return
        attempt.status, attempt.finished_at = AttemptStatus.REPLIED, now()
        attempt.status_code, attempt.duration_ms = reply.status_code, reply.duration_ms
        attempt.reply = mask(reply.text).text[:MAX_REPLY_CHARS]
        attempt.reply_length = len(reply.text)
        if reply.tool_calls:
            attempt.tool_calls = mask(json.dumps(reply.tool_calls, ensure_ascii=False)).text
        self._count(
            attempts_replied=CampaignRun.attempts_replied + 1,
            overloads_in_a_row=0,
            errors_in_a_row=0,
            retries=0,
        )
        db.commit()
        results, problems = hooks.on_attempt(db, attempt, reply)
        if problems:
            attempt.hook_errors = problems
            db.commit()
            live.publish(self.run.id, "warning", {"message": _hook_warning(problems)})
        self._publish(attempt, results)

    def failed(self, attempt: Attempt, error: Exception) -> None:
        """Records why an attempt got no reply and applies the safety limits: a target that is
        overloaded (HTTP 429 or 503) gets a break, and stops the run after run_max_overloads
        answers in a row (FR-5.7); a target that can't be reached pauses the run, which tries
        again after increasing delays and stops after the last one (NFR-2.3); other errors stop
        the run after run_max_errors in a row. A request that was refused before it left Sentra
        (the target is no longer verified, its address is refused) stops the run at once."""
        if not isinstance(error, ConnectorError):
            raise error  # the engine's own signal, or Sentra's own failure: the engine handles it
        db = self.db
        db.refresh(attempt)
        settings = get_settings()
        if isinstance(error, BudgetExhausted):
            self._end(
                RunStatus.COMPLETED,
                EndReason.BUDGET_USED,
                lifecycle.END_TEXT[EndReason.BUDGET_USED],
            )
            return
        if isinstance(error, NotVerified):
            self._end(RunStatus.STOPPED, EndReason.OWNERSHIP_NOT_VERIFIED, self._unverified_text())
            return
        if isinstance(error, AddressRefused):
            self._end(
                RunStatus.STOPPED, EndReason.TARGET_ERRORS, f"Stopped automatically: {_said(error)}"
            )
            return
        if attempt.status not in (AttemptStatus.PLANNED, AttemptStatus.SENDING):
            log.warning("Attempt %s of run %s was already recorded", attempt.id, self.run.id)
            return
        sent = attempt.status == AttemptStatus.SENDING
        if not sent and not isinstance(error, TargetUnreachable):
            raise ValueError(
                f"Attempt {attempt.attempt_no} wasn't sent with its budget from send_options()."
            )
        if sent:
            attempt.status, attempt.finished_at = AttemptStatus.FAILED, now()
            attempt.error_kind = ERROR_KIND.get(type(error), "error")
            attempt.error_message = str(error)[:1000]
            attempt.status_code = getattr(error, "status_code", None)
            self._count(attempts_failed=CampaignRun.attempts_failed + 1)

        if isinstance(error, TargetOverloaded):
            self._count(
                overloads_in_a_row=CampaignRun.overloads_in_a_row + 1, errors_in_a_row=0, retries=0
            )
            db.commit()
            db.refresh(self.run)
            hold = min(error.retry_after or settings.run_retry_delays[0], MAX_HOLD_SECONDS)
            pacing.hold(db, self.target.id, now() + timedelta(seconds=hold))
            if self.run.overloads_in_a_row >= settings.run_max_overloads:
                self._end(
                    RunStatus.STOPPED,
                    EndReason.TARGET_OVERLOADED,
                    f"Stopped automatically: the target answered {self.run.overloads_in_a_row} "
                    "times in a row that it is overloaded (HTTP 429 or 503).",
                )
            else:
                warning = f"{_said(error)} Sentra waits {hold} seconds before the next attempt."
                live.publish(self.run.id, "warning", {"message": warning})
        elif isinstance(error, TargetUnreachable | TargetTimeout):
            if sent:
                self._retry(attempt)
            self._count(retries=CampaignRun.retries + 1, overloads_in_a_row=0, errors_in_a_row=0)
            db.commit()
            db.refresh(self.run)
            delays, retry = settings.run_retry_delays, self.run.retries
            if retry > len(delays):
                self._end(
                    RunStatus.STOPPED,
                    EndReason.TARGET_UNAVAILABLE,
                    f"Stopped automatically: the target still couldn't be reached after "
                    f"{len(delays)} retries. {_said(error)}",
                )
            else:
                delay = delays[retry - 1]
                self._decide(
                    Decision(
                        "pause",
                        f"Paused automatically: {_said(error)} Sentra tries again in {delay} "
                        f"seconds (retry {retry} of {len(delays)}).",
                        delay=delay,
                    )
                )
        else:
            self._count(
                errors_in_a_row=CampaignRun.errors_in_a_row + 1, overloads_in_a_row=0, retries=0
            )
            db.commit()
            db.refresh(self.run)
            if self.run.errors_in_a_row >= settings.run_max_errors:
                self._end(
                    RunStatus.STOPPED,
                    EndReason.TARGET_ERRORS,
                    f"Stopped automatically after {self.run.errors_in_a_row} errors in a row from "
                    f"the target. The last one: {_said(error)}",
                )
        db.commit()
        if sent:
            self._publish(attempt, {})

    # ------------------------------------------------------------ the engine's side

    def _may_go_on(self) -> bool:
        """The check before every attempt (UC-5.4 step 5): the run is still running and ours, the
        target still verified, and no limit is reached."""
        db = self.db
        renewed = db.execute(
            update(CampaignRun)
            .where(CampaignRun.id == self.run.id, CampaignRun.lease_owner == self._owner)
            .values(lease_until=now() + timedelta(seconds=lifecycle.lease_seconds()))
        ).rowcount
        db.commit()
        db.refresh(self.run)
        run = self.run
        if not renewed or not self._is_ours(run):
            return False
        if run.attempts_sent >= run.attempt_budget:
            self._end(
                RunStatus.COMPLETED,
                EndReason.BUDGET_USED,
                lifecycle.END_TEXT[EndReason.BUDGET_USED],
            )
            return False
        if run.window_ends_at is not None and run.window_ends_at <= now():
            self._end(
                RunStatus.COMPLETED,
                EndReason.TIME_WINDOW_ENDED,
                lifecycle.END_TEXT[EndReason.TIME_WINDOW_ENDED],
            )
            return False
        db.refresh(self.target)
        if self.target.status != TargetStatus.VERIFIED:
            self._end(RunStatus.STOPPED, EndReason.OWNERSHIP_NOT_VERIFIED, self._unverified_text())
            return False
        used = limits.usage(db, run.organization_id)
        in_force = limits.limits_for(db, run.organization_id)
        reached = limits.reached(in_force, used, launching=False)
        db.commit()
        # UC-10.6 step 5: the organization is told once a month when a limit comes close.
        limits.watch(db, run.organization_id, in_force, used)
        if reached:
            self._end(
                RunStatus.STOPPED,
                EndReason.USAGE_LIMIT_REACHED,
                f"Stopped automatically: {reached[1]}",
                limit_reached=True,
            )
            return False
        return time.monotonic() < self._slice_ends

    def _is_ours(self, run: CampaignRun) -> bool:
        return (
            run.status == RunStatus.RUNNING
            and run.dispatch_token == self._token
            and run.lease_owner == self._owner
        )

    def _still_ours(self) -> bool:
        """A quick look at the run, without loading the rest of it."""
        row = self.db.execute(
            select(CampaignRun.status, CampaignRun.dispatch_token, CampaignRun.lease_owner).where(
                CampaignRun.id == self.run.id
            )
        ).one()
        self.db.commit()
        return (row.status, row.dispatch_token, row.lease_owner) == (
            RunStatus.RUNNING,
            self._token,
            self._owner,
        )

    def _sending(self, attempt: Attempt) -> bool:
        """The attempt was counted as sent (its budget was taken) and nobody has recorded it yet,
        e.g. a worker that took over the run after this one's lease ran out."""
        self.db.refresh(attempt)
        if attempt.status == AttemptStatus.SENDING:
            return True
        if attempt.status == AttemptStatus.PLANNED:
            raise ValueError(
                f"Attempt {attempt.attempt_no} wasn't sent with its budget from send_options()."
            )
        log.warning("Attempt %s of run %s was already recorded", attempt.id, self.run.id)
        return False

    def _count(self, **values) -> None:
        """Changes the run's counters in the database itself, so no change is lost. Each kind of
        trouble counts only while it comes in a row."""
        self.db.execute(update(CampaignRun).where(CampaignRun.id == self.run.id).values(**values))

    def _retry(self, attempt: Attempt) -> None:
        """The same message again, first in line, in a new conversation (NFR-2.3)."""
        number = self.db.scalar(
            select(func.max(Attempt.attempt_no)).where(Attempt.campaign_run_id == self.run.id)
        )
        self.db.add(
            Attempt(
                organization_id=attempt.organization_id,
                campaign_run_id=attempt.campaign_run_id,
                attempt_no=number + 1,
                test_definition_id=attempt.test_definition_id,
                test_code=attempt.test_code,
                suite_code=attempt.suite_code,
                template=attempt.template,
                variant=attempt.variant,
                priority=AttemptPriority.RETRY,
                retry_of_id=attempt.id,
                input=attempt.input,
                session_id=uuid.uuid4().hex,
            )
        )
        self._count(attempts_planned=CampaignRun.attempts_planned + 1)

    def _unverified_text(self) -> str:
        return (
            f"Stopped automatically: {self.target.name} is no longer verified, so no further "
            "attempt is sent."
        )

    def _end(self, status: RunStatus, reason: EndReason, message: str, **more) -> None:
        self._decide(Decision("end", message, status=status, reason=reason, **more))

    def _decide(self, decision: Decision) -> None:
        """The first decision counts; an end replaces a pause or a wait."""
        if self.decision is None or (decision.kind == "end" and self.decision.kind != "end"):
            self.decision = decision

    def _publish(self, attempt: Attempt, results: dict) -> None:
        self.db.refresh(self.run)
        run = self.run
        live.publish(
            run.id,
            "attempt",
            {
                **attempt_data(attempt),
                "results": results,
                "progress": {
                    "attempts_planned": run.attempts_planned,
                    "attempts_sent": run.attempts_sent,
                    "attempts_replied": run.attempts_replied,
                    "attempts_failed": run.attempts_failed,
                    "attempt_budget": run.attempt_budget,
                },
            },
        )


class _AttemptBudget:
    """The budget of one attempt (connector.AttemptBudget). take() counts the attempt as sent and
    marks it on its way, in one transaction, at the last moment before the request. The database
    refuses an attempt beyond the budget (CampaignRun's check constraint) and an attempt of a run
    that isn't running or isn't this worker's any more."""

    def __init__(self, context: RunContext, attempt_id: uuid.UUID) -> None:
        self.context, self.attempt_id = context, attempt_id

    def take(self) -> None:
        context, db = self.context, self.context.db
        counted = db.execute(
            update(CampaignRun)
            .where(
                CampaignRun.id == context.run.id,
                CampaignRun.status == RunStatus.RUNNING,
                CampaignRun.dispatch_token == context._token,
                CampaignRun.lease_owner == context._owner,
                CampaignRun.attempts_sent < CampaignRun.attempt_budget,
                CampaignRun.window_ends_at.is_(None) | (CampaignRun.window_ends_at > now()),
            )
            .values(attempts_sent=CampaignRun.attempts_sent + 1)
        ).rowcount
        marked = (
            db.execute(
                update(Attempt)
                .where(Attempt.id == self.attempt_id, Attempt.status == AttemptStatus.PLANNED)
                .values(status=AttemptStatus.SENDING, sent_at=now())
            ).rowcount
            if counted
            else 0
        )
        if not marked:
            db.rollback()
            context._may_go_on()  # finds the reason: a stop, the budget, the time window …
            raise RunInterrupted()
        db.commit()
        context.taken += 1


def attempt_data(attempt: Attempt) -> dict:
    """An attempt as the live monitor shows it (UC-5.6 step 3)."""
    return {
        "attempt_no": attempt.attempt_no,
        "test_code": attempt.test_code,
        "suite_code": attempt.suite_code,
        "variant": attempt.variant,
        "status": attempt.status,
        "retry_of": attempt.retry_of_id,
        "repeat_of": attempt.repeat_of_id,  # FR-6.4: a repetition of that attempt
        "refinement_reason": attempt.refinement_reason,  # FR-5.5: the agent wrote it, and why
        "sent_at": attempt.sent_at,
        "finished_at": attempt.finished_at,
        "status_code": attempt.status_code,
        "duration_ms": attempt.duration_ms,
        "input": (attempt.input or "")[:EXCERPT_CHARS],
        "reply": (attempt.reply or "")[:EXCERPT_CHARS],
        "reply_length": attempt.reply_length,
        "error": attempt.error_message,
    }


def _said(error: Exception) -> str:
    """A connector error's message as a sentence."""
    text = str(error).strip()
    return text if text.endswith((".", "!", "?")) else f"{text}."


def _hook_warning(problems: list[dict]) -> str:
    names = ", ".join(p["extension"] for p in problems)
    return f"An extension couldn't evaluate an attempt: {names}."


# ---------------------------------------------------------------- the job


def advance(db: Session, run_id: uuid.UUID, token: uuid.UUID | None) -> None:
    """The job campaigns.advance_run: one slice of work on a run.

    Every change of the run's status happens on its locked row, as it is in the database now
    (lifecycle.lock), so a pause or a stop that the API makes at the same moment is never undone."""
    run = lifecycle.lock(db, run_id)
    if run is None:
        db.rollback()
        return
    at = now()
    if run.status in ENDED:  # ended while no worker held it, e.g. after a worker was lost
        if run.finalized_at is not None:
            db.rollback()
        elif lifecycle.lease_free(run, at):
            db.commit()
            lifecycle.finalize(db, run.id)
        else:
            lifecycle.check_later(db, run)
        return
    if token is None or run.dispatch_token != token:
        db.rollback()  # a stale job: a newer one is queued, or the run is paused
        return
    if not lifecycle.lease_free(run, at):
        lifecycle.check_later(db, run)
        return
    if run.status == RunStatus.PAUSED and run.pause_kind != PauseKind.AUTOMATIC:
        db.rollback()  # paused by a person: it waits for "Resume"
        return
    owner = uuid.uuid4()
    run.lease_owner, run.lease_until = owner, at + timedelta(seconds=lifecycle.lease_seconds())
    # An attempt that a lost worker left on its way isn't sent again (NFR-2.2).
    db.execute(
        update(Attempt)
        .where(Attempt.campaign_run_id == run.id, Attempt.status == AttemptStatus.SENDING)
        .values(
            status=AttemptStatus.INTERRUPTED,
            finished_at=at,
            error_message=lifecycle.INTERRUPTED_TEXT,
        )
    )
    changed = False
    if run.status == RunStatus.PAUSED:  # paused automatically: its time to try again has come
        run.status, run.pause_kind, run.paused_at = RunStatus.RUNNING, None, None
        run.status_message, changed = "Trying again.", True
    elif run.status == RunStatus.RUNNING and run.status_message != "Running.":
        run.status_message, changed = "Running.", True  # e.g. after a wait for the target's turn
    run.wake_at = None
    db.commit()
    if changed:
        lifecycle.publish_status(run)
    try:
        decision, sent = _work(db, run, owner, token)
    except Exception:
        log.exception("Campaign run %s failed in the worker", run_id)
        db.rollback()
        _worker_failed(db, run_id, owner)
        return
    _finish(db, run_id, owner, decision, sent)


def _work(
    db: Session, run: CampaignRun, owner: uuid.UUID, token: uuid.UUID
) -> tuple[Decision | None, int]:
    """One slice; returns what happens next and how many attempts were sent."""
    started = time.monotonic()
    target = db.get_one(Target, run.target_id)
    if run.status == RunStatus.QUEUED:
        window = Window.of(run.settings)
        if window is not None and window.closes_at(now()) is None:
            opens = window.opens_at(now())
            waiting = f"Waiting for its time window, {window.label()}."
            return Decision("later", waiting, delay=(opens - now()).total_seconds()), 0
        decision = _start(db, run.id, owner, token, target, window)
        if decision is not None:
            return decision, 0

    context = RunContext(db, run, target, owner, token, started + get_settings().run_slice_seconds)
    try:
        send_loop.send_attempts(context)
    except RunInterrupted:
        pass
    except pacing.TooLongToWait as wait:
        context._decide(
            Decision(
                "later",
                "Waiting for the target's turn: its request rate allows the next attempt in "
                f"{wait.seconds:.0f} seconds.",
                delay=wait.seconds,
            )
        )
    except NotImplementedError:
        db.rollback()
        context._end(RunStatus.STOPPED, EndReason.INTERNAL_ERROR, NO_SEND_LOOP)
    return context.decision, context.taken


def _start(
    db: Session,
    run_id: uuid.UUID,
    owner: uuid.UUID,
    token: uuid.UUID,
    target: Target,
    window: Window | None,
) -> Decision | None:
    """UC-5.4 steps 1-2: the target's ownership is checked again, then the attempts are planned.
    A run whose target can't be confirmed is cancelled before any attempt (1a1). A run that was
    paused or stopped during the check is left as it is: the next check before an attempt sees
    it."""
    check = verification.recheck(db, target)  # reaches the target's domain: no lock is held
    run = lifecycle.lock(db, run_id)
    if run is None or (run.status, run.lease_owner, run.dispatch_token) != (
        RunStatus.QUEUED,
        owner,
        token,
    ):
        db.rollback()
        return None
    run.ownership_check_id = check.id
    if check.status != CheckStatus.PASSED:
        db.commit()
        return Decision(
            "end",
            f"Cancelled before its first attempt: the ownership of {target.name} couldn't be "
            f"confirmed again. {check.message}",
            status=RunStatus.CANCELLED,
            reason=EndReason.OWNERSHIP_NOT_VERIFIED,
        )
    plan = planning.plan(db, run, target)
    run.plan = {"tests": plan.tests}
    run.versions = {**run.versions, "templates": plan.templates}
    run.attempts_planned = len(plan.attempts)
    run.status, run.started_at = RunStatus.RUNNING, now()
    run.status_message = "Running."
    if window is not None:
        run.window_ends_at = window.closes_at(run.started_at)
    db.commit()
    lifecycle.publish_status(run)
    live.publish(
        run.id,
        "plan",
        {
            "tests": len(plan.tests),
            "planned": plan.planned,
            "skipped": len(plan.tests) - plan.planned,
            "attempts": len(plan.attempts),
        },
    )
    if not plan.attempts:
        return Decision(
            "end",
            lifecycle.END_TEXT[EndReason.NOTHING_TO_RUN],
            status=RunStatus.COMPLETED,
            reason=EndReason.NOTHING_TO_RUN,
        )
    return None


def _finish(
    db: Session, run_id: uuid.UUID, owner: uuid.UUID, decision: Decision | None, sent: int
) -> None:
    """The end of a slice: the lease is given back, and the run ends, pauses or is queued again."""
    run = lifecycle.lock(db, run_id)
    if run is None or run.lease_owner != owner:
        db.rollback()  # another worker took the run over
        return
    run.lease_owner = run.lease_until = None
    run.worker_errors = 0
    countdown: float | None = None
    queue = False
    if run.status in ENDED or run.status == RunStatus.PAUSED:
        pass  # stopped or paused by a person while the slice went on
    elif decision is not None and decision.kind == "end":
        _end_run(db, run, decision)
    elif decision is not None and decision.kind == "pause":
        run.status, run.pause_kind, run.paused_at = RunStatus.PAUSED, PauseKind.AUTOMATIC, now()
        run.paused_by_id = None
        run.status_message = decision.message
        run.wake_at = now() + timedelta(seconds=decision.delay)
        lifecycle.record(
            db,
            run,
            "campaign.run_paused",
            f"Paused campaign run {_label(db, run)} automatically: its target can't be reached",
            details={"retry_in_seconds": decision.delay},
        )
        queue, countdown = True, decision.delay
    elif decision is not None and decision.kind == "later":
        run.status_message = decision.message
        run.wake_at = now() + timedelta(seconds=decision.delay)
        queue, countdown = True, decision.delay
    elif run.status == RunStatus.RUNNING and _planned_left(db, run) == 0:
        finished = Decision(
            "end",
            lifecycle.END_TEXT[EndReason.TESTS_FINISHED],
            status=RunStatus.COMPLETED,
            reason=EndReason.TESTS_FINISHED,
        )
        _end_run(db, run, finished)
    else:  # the slice is over: the run waits for its next turn (NFR-6.4)
        queue, countdown = True, (None if sent else IDLE_DELAY_SECONDS)
    db.commit()
    lifecycle.publish_status(run)
    if queue:
        if not lifecycle.dispatch(db, run, countdown):
            log.warning("Campaign run %s couldn't be queued again; recover() picks it up", run.id)
    elif run.status in ENDED:
        lifecycle.finalize(db, run.id)
        if decision is not None and decision.limit_reached and run.end_reason == decision.reason:
            lifecycle.notify_limit(db, run.organization_id, decision.message.split(": ", 1)[-1])


def _end_run(db: Session, run: CampaignRun, decision: Decision) -> None:
    """Ends the locked run as decided; Sentra's own stops are recorded in the audit log."""
    lifecycle.end(db, run, decision.status, decision.reason, decision.message)
    if decision.status == RunStatus.COMPLETED:
        return
    verb = "Stopped" if decision.status == RunStatus.STOPPED else "Cancelled"
    lifecycle.record(
        db,
        run,
        f"campaign.run_{verb.lower()}",
        f"{verb} campaign run {_label(db, run)} automatically: {decision.reason.replace('_', ' ')}",
        details={"reason": decision.reason, "message": decision.message},
    )


def _label(db: Session, run: CampaignRun) -> str:
    return lifecycle.code(run, lifecycle.campaign_of(db, run))


def _planned_left(db: Session, run: CampaignRun) -> int:
    return db.scalar(
        select(func.count()).where(
            Attempt.campaign_run_id == run.id, Attempt.status == AttemptStatus.PLANNED
        )
    )


def _worker_failed(db: Session, run_id: uuid.UUID, owner: uuid.UUID) -> None:
    """Sentra's own code failed during the slice (NFR-2.3): the run is tried again a little later,
    and stops after run_max_worker_errors failures in a row."""
    run = lifecycle.lock(db, run_id)
    if run is None or run.lease_owner != owner:
        db.rollback()
        return
    run.lease_owner = run.lease_until = None
    run.worker_errors += 1
    retry = False
    if run.status in ENDED or run.status == RunStatus.PAUSED:
        pass  # stopped or paused by a person meanwhile
    elif run.worker_errors >= get_settings().run_max_worker_errors:
        failed = Decision(
            "end", INTERNAL_ERROR_TEXT, status=RunStatus.STOPPED, reason=EndReason.INTERNAL_ERROR
        )
        _end_run(db, run, failed)
    else:
        run.status_message = "Sentra had a problem with this run and tries again shortly."
        retry = True
    db.commit()
    lifecycle.publish_status(run)
    if retry:
        lifecycle.dispatch(db, run, WORKER_ERROR_DELAY_SECONDS * run.worker_errors)
    elif run.status in ENDED:
        lifecycle.finalize(db, run.id)
