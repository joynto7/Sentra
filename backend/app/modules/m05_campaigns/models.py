import uuid
from datetime import datetime, time
from decimal import Decimal
from enum import IntEnum, StrEnum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import OrganizationScoped, Timestamps, UUIDPrimaryKey


class ApprovalStatus(StrEnum):
    """Scope approval (FR-5.2, optional): until an organization requires it, none is needed."""

    NOT_REQUIRED = "not_required"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    REJECTED = "rejected"


class Campaign(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    """A planned security assessment of one target: what is tested, how much and how fast
    (FR-5.1). Creating it sends nothing to the target; each launch starts a CampaignRun."""

    __tablename__ = "campaigns"
    __table_args__ = (UniqueConstraint("organization_id", "number"),)

    number: Mapped[int]  # shown as C-238; counted per organization
    name: Mapped[str] = mapped_column(String(120))
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="RESTRICT"), index=True
    )
    # Suite codes: a run fixes and records the version of each suite and test it uses (FR-4.5).
    suites: Mapped[list[str]] = mapped_column(JSONB)
    adaptive_agent: Mapped[bool] = mapped_column(default=False)  # FR-5.5
    # FR-3.3: the threat model version the campaign was based on (the newest approved one when it
    # was created); None when the target had no approved threat model (UC-5.1, 2a)
    threat_model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("threat_models.id", ondelete="SET NULL")
    )
    attempt_budget: Mapped[int]
    request_rate: Mapped[int]  # per minute; never above the target's safe rate (FR-5.7)
    repetitions: Mapped[int]  # how often a successful attempt is repeated (FR-6.4)
    # An optional daily window, as clock times in the campaign's time zone (e.g. 02:00-05:00).
    window_start: Mapped[time | None] = mapped_column(Time)
    window_end: Mapped[time | None] = mapped_column(Time)
    time_zone: Mapped[str] = mapped_column(String(64))  # IANA name, e.g. Asia/Dhaka
    approval_status: Mapped[str] = mapped_column(
        String(20), default=ApprovalStatus.NOT_REQUIRED, server_default=ApprovalStatus.NOT_REQUIRED
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    @property
    def code(self) -> str:
        return f"C-{self.number:03d}"


class ScheduleKind(StrEnum):
    """UC-5.1 step 5: when the campaign runs. "Immediately" launches the first run at once
    (UC-5.3) and saves no schedule, so only these two kinds are ever stored."""

    ONCE = "once"
    RECURRING = "recurring"


class ScheduleFrequency(StrEnum):
    """How often a recurring schedule runs (FR-5.3: "such as weekly")."""

    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


class ScheduleStatus(StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    FINISHED = "finished"  # a one-off that has had its moment


class ScheduleResult(StrEnum):
    """What came of the schedule's last moment, shown with it (Screens 33 and 35)."""

    LAUNCHED = "launched"
    SKIPPED = "skipped"  # the campaign couldn't be launched then (UC-5.3, 3a and 4a)
    MISSED = "missed"  # the moment passed while Sentra wasn't running


class CampaignSchedule(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    """When a campaign runs by itself (FR-5.3): once at a moment, or daily, weekly or monthly at
    a clock time in the campaign's own time zone. The scheduler (app/workers/scheduler.py)
    launches a due schedule through UC-5.3 with the permissions of the member who saved it (1a1).
    A campaign has at most one schedule, and a run launched by hand doesn't change it."""

    __tablename__ = "campaign_schedules"
    __table_args__ = (
        UniqueConstraint("campaign_id"),
        Index("ix_campaign_schedules_due", "status", "next_run_at"),
        CheckConstraint("weekday IS NULL OR weekday BETWEEN 0 AND 6", name="schedule_weekday"),
        # 1-28, so that the day exists in every month
        CheckConstraint(
            "day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28", name="schedule_day_of_month"
        ),
    )

    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10))
    frequency: Mapped[str | None] = mapped_column(String(10))  # recurring only
    run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # once only
    # Recurring: the clock time in the campaign's time zone, and which day it falls on
    at_time: Mapped[time | None] = mapped_column(Time)
    weekday: Mapped[int | None] = mapped_column(SmallInteger)  # weekly: 0 = Monday … 6 = Sunday
    day_of_month: Mapped[int | None] = mapped_column(SmallInteger)  # monthly
    status: Mapped[str] = mapped_column(String(10), default=ScheduleStatus.ACTIVE)
    # When the next run starts, in UTC; None while the schedule is paused or finished
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_result: Mapped[str | None] = mapped_column(String(10))
    last_message: Mapped[str] = mapped_column(Text, default="", server_default="")
    last_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="SET NULL")
    )
    # Moments in a row that started no run; after a few the schedule pauses itself (scheduler.py)
    misses: Mapped[int] = mapped_column(default=0, server_default="0")
    # Whose permissions a scheduled run uses (UC-5.3, 1a1)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class RunType(StrEnum):
    CAMPAIGN = "campaign"
    RETEST = "retest"  # UC-8.6: a run without a campaign
    BENCHMARK = "benchmark"  # UC-11.4: a run without a campaign


class RunTrigger(StrEnum):
    MANUAL = "manual"  # "Launch" (UC-5.3 step 1)
    SCHEDULE = "schedule"  # the campaign's schedule (UC-5.3, 1a; FR-5.3)
    API = "api"  # a CI/CD pipeline through the API (UC-5.3, 1a; FR-9.5)


class RunStatus(StrEnum):
    """The states of the lifecycle of a campaign run (report 2.3.2). Queued, running and paused
    form Active; completed, stopped and cancelled form Ended."""

    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    STOPPED = "stopped"
    CANCELLED = "cancelled"


ACTIVE = (RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.PAUSED)
ENDED = (RunStatus.COMPLETED, RunStatus.STOPPED, RunStatus.CANCELLED)


class EndReason(StrEnum):
    """Why a run ended (UC-5.6 step 5). The first four complete it, the next six stop it, the
    last one cancels it. ownership_not_verified cancels a run before its first attempt (UC-5.4,
    1a) and stops one that has started (its target became unverified, e.g. a new endpoint)."""

    TESTS_FINISHED = "tests_finished"  # every planned attempt was sent
    BUDGET_USED = "budget_used"  # FR-5.4
    TIME_WINDOW_ENDED = "time_window_ended"  # FR-5.4; UC-5.7, 4a
    NOTHING_TO_RUN = "nothing_to_run"  # every test was skipped
    STOPPED_BY_USER = "stopped_by_user"  # UC-5.7, 1a and 1b
    TARGET_OVERLOADED = "target_overloaded"  # FR-5.7: repeated HTTP 429 or 503
    TARGET_ERRORS = "target_errors"  # repeated errors of another kind
    TARGET_UNAVAILABLE = "target_unavailable"  # still unreachable after the retries (NFR-2.3)
    USAGE_LIMIT_REACHED = "usage_limit_reached"  # a monthly limit (UC-10.6 step 6)
    INTERNAL_ERROR = "internal_error"  # Sentra itself failed several times in a row
    OWNERSHIP_NOT_VERIFIED = "ownership_not_verified"  # UC-5.4, 1a
    QUEUE_UNAVAILABLE = "queue_unavailable"  # the start job couldn't be queued


class PauseKind(StrEnum):
    USER = "user"  # UC-5.7 step 1
    AUTOMATIC = "automatic"  # the target can't be reached; Sentra retries (NFR-2.3)


class CampaignRun(UUIDPrimaryKey, Timestamps, OrganizationScoped, Base):
    """One execution of a campaign (FR-5.4): the versions it uses, its plan, its progress and why
    it ended. The run's own row is the source of truth for every worker: pause and stop are
    signalled through it (FR-5.6), and the lease makes sure only one worker works on it at a time
    (NFR-2.2)."""

    __tablename__ = "campaign_runs"
    __table_args__ = (
        UniqueConstraint("campaign_id", "number"),
        # UC-5.3, 4a: one run of a campaign at a time, even when two launches meet.
        Index(
            "uq_campaign_runs_one_active",
            "campaign_id",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running', 'paused')"),
        ),
        Index("ix_campaign_runs_organization_created", "organization_id", "created_at"),
        # FR-5.7: the database itself refuses an attempt beyond the budget.
        CheckConstraint("attempts_sent <= attempt_budget", name="within_budget"),
    )

    # None for retests and benchmark runs, which belong to no campaign (report, ER diagram 3)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("campaigns.id", ondelete="RESTRICT")
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="RESTRICT"), index=True
    )
    number: Mapped[int]  # within the campaign: R-238-2 is the second run of C-238
    run_type: Mapped[str] = mapped_column(String(20), default=RunType.CAMPAIGN)
    trigger: Mapped[str] = mapped_column(String(20), default=RunTrigger.MANUAL)
    status: Mapped[str] = mapped_column(String(20), default=RunStatus.QUEUED, index=True)
    # What the run is doing or why it ended, in words for the monitor (UC-5.6, NFR-2.3)
    status_message: Mapped[str] = mapped_column(Text, default="")
    end_reason: Mapped[str | None] = mapped_column(String(30))
    launched_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    # The campaign's settings at launch: a later change of the campaign doesn't change a run
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    # FR-3.3: the threat model version the run was based on, taken from the campaign when it was
    # launched; None when the campaign had none (UC-5.1, 2a). `versions` holds its number, this
    # column answers which runs a version was used by (UC-3.4 step 2).
    threat_model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("threat_models.id", ondelete="SET NULL"), index=True
    )
    # The exact versions it uses (UC-5.3 step 4, FR-4.5): suites, tests, threat model, templates
    versions: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Each test with "planned" or "skipped" and the reason (UC-5.4 step 2)
    plan: Mapped[dict] = mapped_column(JSONB, default=dict)
    attempt_budget: Mapped[int]
    request_rate: Mapped[int]  # per minute
    attempts_planned: Mapped[int] = mapped_column(default=0)
    attempts_sent: Mapped[int] = mapped_column(default=0)  # every request that left Sentra
    attempts_replied: Mapped[int] = mapped_column(default=0)
    attempts_failed: Mapped[int] = mapped_column(default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0))

    # Safety limits (FR-5.7) and graceful degradation (NFR-2.3)
    overloads_in_a_row: Mapped[int] = mapped_column(default=0)
    errors_in_a_row: Mapped[int] = mapped_column(default=0)
    retries: Mapped[int] = mapped_column(default=0)  # while the target can't be reached
    # Unexpected failures of Sentra's own code in a row; the run stops after a few (NFR-2.3)
    worker_errors: Mapped[int] = mapped_column(default=0)
    # When the time window the run sends in closes (FR-5.4); None without a window, and before
    # the window opens
    window_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paused_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    pause_kind: Mapped[str | None] = mapped_column(String(10))
    # When a worker looks at the run next: after a wait for the target's turn, a retry, or the
    # opening of the time window
    wake_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Execution (NFR-2.2): each queued job carries the token; a job with an older token is stale.
    # The worker that works on the run holds the lease and renews it before every attempt.
    dispatch_token: Mapped[uuid.UUID | None]
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_owner: Mapped[uuid.UUID | None]
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set once the end of the run has been handled: hooks, notifications (UC-5.4 step 7)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ownership_check_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ownership_verifications.id", ondelete="SET NULL")
    )
    # Problems of the extensions (on_run_end), kept for the summary
    hook_errors: Mapped[list | None] = mapped_column(JSONB)


class AttemptStatus(StrEnum):
    PLANNED = "planned"
    SENDING = "sending"  # on its way to the target
    REPLIED = "replied"
    FAILED = "failed"  # the target answered with an error, or couldn't be reached
    INTERRUPTED = "interrupted"  # the worker stopped while it was on its way (NFR-2.2)
    NOT_SENT = "not_sent"  # the run ended before it was its turn


class AttemptPriority(IntEnum):
    """The order in which a run sends its attempts: a retry first, then the attempts that later
    features add while the run goes on (repetitions FR-6.4, refinements FR-5.5), then the plan."""

    RETRY = 0
    FOLLOW_UP = 1
    PLANNED = 2


class Attempt(UUIDPrimaryKey, OrganizationScoped, Base):
    """One request that a run sends to its target, numbered within its run (report, ER diagram 3).
    It applies exactly one version of a test definition. The reply is stored masked (NFR-8.2);
    the detection gets the raw reply through the run's extension points."""

    __tablename__ = "attempts"
    __table_args__ = (
        UniqueConstraint("campaign_run_id", "attempt_no"),
        Index("ix_attempts_next", "campaign_run_id", "status", "priority", "attempt_no"),
        Index("ix_attempts_run_sent", "campaign_run_id", "sent_at"),
        Index("ix_attempts_organization_sent", "organization_id", "sent_at"),
    )

    campaign_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("campaign_runs.id", ondelete="CASCADE")
    )
    attempt_no: Mapped[int]
    test_definition_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("test_definitions.id", ondelete="RESTRICT")
    )
    test_code: Mapped[str] = mapped_column(String(40))
    suite_code: Mapped[str | None] = mapped_column(String(40))
    template: Mapped[str] = mapped_column(String(80))
    variant: Mapped[int]  # which message of the template: 1, 2 or 3
    priority: Mapped[int] = mapped_column(SmallInteger, default=AttemptPriority.PLANNED)
    retry_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("attempts.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(15), default=AttemptStatus.PLANNED)
    input: Mapped[str] = mapped_column(Text)  # the message that is sent
    session_id: Mapped[str] = mapped_column(String(64))  # the conversation at the target
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status_code: Mapped[int | None]
    duration_ms: Mapped[int | None]
    # The reply as plain text, masked (NFR-3.6, NFR-8.2), at most 64 KB
    reply: Mapped[str | None] = mapped_column(Text)
    reply_length: Mapped[int | None]  # characters of the whole reply
    tool_calls: Mapped[str | None] = mapped_column(Text)  # masked JSON, as the target named them
    error_kind: Mapped[str | None] = mapped_column(String(20))
    error_message: Mapped[str | None] = mapped_column(Text)
    refinement_reason: Mapped[str | None] = mapped_column(Text)  # FR-5.5, Sprint 3
    # Problems of the extensions (on_attempt) with this attempt
    hook_errors: Mapped[list | None] = mapped_column(JSONB)
