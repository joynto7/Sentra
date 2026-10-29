"""The tables of Module 3 (ER diagram 2, class diagram 2): every version of a target's threat
model, the threats of each version, and the jobs that generate new versions (UC-3.1).

Each ThreatModel row is one version (FR-3.3). A new version never changes an earlier one:
generating, editing and restoring always add a version, and the triggers below refuse any change
to what a stored version says. Only approving changes a version, once, from draft to approved."""

import uuid
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import (
    DDL,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    event,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.models import OrganizationScoped, UUIDPrimaryKey


def _now() -> datetime:
    return datetime.now(UTC)


class ThreatModelStatus(StrEnum):
    DRAFT = "draft"
    APPROVED = "approved"


class Origin(StrEnum):
    """How a version came about."""

    GENERATED = "generated"  # by the threat model job (UC-3.1)
    EDITED = "edited"  # saved by a person (UC-3.2 step 4)
    RESTORED = "restored"  # a copy of an earlier version (UC-3.4, 3a)


class ComponentKind(StrEnum):
    """The components of a target that FR-3.1 names."""

    MODEL = "model"
    SYSTEM_PROMPT = "system_prompt"
    KNOWLEDGE_SOURCE = "knowledge_source"
    TOOL = "tool"
    OUTPUT = "output"


class ThreatSource(StrEnum):
    BASELINE = "baseline"  # a baseline rule (UC-3.1 step 3)
    AI_SUGGESTED = "ai_suggested"  # suggested by the LLM (step 4)
    ANALYST = "analyst"  # added by a person (UC-3.2 step 3)


class JobStatus(StrEnum):
    QUEUED = "queued"  # waits until the target's running job has finished
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobTrigger(StrEnum):
    PROFILE_REVIEW = "profile_review"  # a profile review was completed (UC-3.1 trigger)
    REQUESTED = "requested"  # a person selected "Generate threat model"


class ThreatModel(UUIDPrimaryKey, OrganizationScoped, Base):
    """One version of the threat model of a target."""

    __tablename__ = "threat_models"
    __table_args__ = (UniqueConstraint("target_id", "version"),)

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int]
    status: Mapped[str] = mapped_column(String(10), default=ThreatModelStatus.DRAFT)
    origin: Mapped[str] = mapped_column(String(10))
    based_on_version: Mapped[int | None]  # the version it was made from
    profile_version: Mapped[int | None]  # the Target Profile version it was generated from
    # The components of the target (FR-3.1): [{"kind", "name", "note"}]
    components: Mapped[list] = mapped_column(JSONB, default=list)
    # It holds threats suggested by the LLM, so it is labelled AI-generated until a person has
    # approved it (NFR-9.4).
    ai_generated: Mapped[bool] = mapped_column(default=False)
    # How it was generated: {"trigger", "model", "suggested", "dropped", "baseline_only"}
    generation: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Who generated, saved or restored it; None when Sentra did it after a profile review
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    threats: Mapped[list["Threat"]] = relationship(
        back_populates="threat_model",
        cascade="all, delete-orphan",
        order_by="Threat.threat_no",
    )


class Threat(UUIDPrimaryKey, Base):
    """A threat to one component, in one version (a weak entity of its threat model)."""

    __tablename__ = "threats"
    __table_args__ = (UniqueConstraint("threat_model_id", "threat_no"),)

    threat_model_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("threat_models.id", ondelete="CASCADE"), index=True
    )
    # Stays the same from version to version, so versions can be compared (UC-3.4). A new
    # threat gets the next number of its target.
    threat_no: Mapped[int]
    title: Mapped[str] = mapped_column(String(200))
    component_kind: Mapped[str] = mapped_column(String(20))
    component_name: Mapped[str] = mapped_column(String(120))
    owasp: Mapped[list[str]] = mapped_column(JSONB)  # one or more of LLM01-LLM10 (FR-3.2)
    atlas: Mapped[str | None] = mapped_column(String(20))  # a MITRE ATLAS technique, if one applies
    likelihood: Mapped[int]  # 1-5
    impact: Mapped[int]  # 1-5
    source: Mapped[str] = mapped_column(String(15))
    rule: Mapped[str | None] = mapped_column(String(40))  # the baseline rule it comes from
    rationale: Mapped[str | None] = mapped_column(Text)  # why it applies
    # Who set the present likelihood and impact; None while they are the rule's or the LLM's.
    # Kept from version to version, so a new generation keeps a person's rating.
    rated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # Who changed it in this version (UC-3.2 step 3)
    edited_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    change_reason: Mapped[str | None] = mapped_column(String(300))
    # A removed threat stays in the version with its reason (UC-3.2, quality requirement 3)
    removed: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    removal_reason: Mapped[str | None] = mapped_column(String(300))

    threat_model: Mapped[ThreatModel] = relationship(back_populates="threats")

    @property
    def risk(self) -> int:
        """Likelihood × impact (class diagram 2: /risk), by which suites are recommended."""
        return self.likelihood * self.impact


class ThreatModelJob(UUIDPrimaryKey, OrganizationScoped, Base):
    """One request to generate a threat model (UC-3.1 step 1). The page follows it until the new
    version is there, and a target has at most one running job."""

    __tablename__ = "threat_model_jobs"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    trigger: Mapped[str] = mapped_column(String(20))
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int | None]  # the version it made
    message: Mapped[str | None] = mapped_column(Text)  # why it failed, or used no LLM


class ThreatModelSelection(UUIDPrimaryKey, OrganizationScoped, Base):
    """UC-3.3 steps 5-6: the test suites a Security Analyst accepted as the default for the
    target's new campaigns. The newest row counts; earlier ones stay as the history."""

    __tablename__ = "threat_model_selections"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    threat_model_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("threat_models.id", ondelete="CASCADE")
    )
    suites: Mapped[list[str]] = mapped_column(JSONB)  # suite codes; the tests aren't copied
    # The threats these suites don't cover, recorded with the selection (UC-3.3 success end)
    uncovered: Mapped[list[int]] = mapped_column(JSONB, default=list)
    saved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


class ThreatGapAcceptance(UUIDPrimaryKey, OrganizationScoped, Base):
    """UC-3.3, 3a1: the reason why a threat that no test covers is accepted for now. It belongs
    to the threat's number, so it stays with the threat in later versions."""

    __tablename__ = "threat_gap_acceptances"

    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("targets.id", ondelete="CASCADE"), index=True
    )
    threat_model_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("threat_models.id", ondelete="CASCADE")
    )  # the version it was accepted in
    threat_no: Mapped[int]
    reason: Mapped[str] = mapped_column(String(300))
    accepted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    accepted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )


# FR-3.3: a stored version is never changed. Attached to the tables, so the tests' create_all()
# makes the triggers as well as the migration does. A version may still be approved once, and a
# deleted user's ID becomes NULL (ON DELETE SET NULL).
VERSION_FIXED_FUNCTION = DDL(
    """
CREATE OR REPLACE FUNCTION sentra_threat_model_version_fixed() RETURNS trigger AS $$
BEGIN
    IF (NEW.organization_id, NEW.target_id, NEW.version, NEW.origin, NEW.based_on_version,
        NEW.profile_version, NEW.components, NEW.ai_generated, NEW.generation, NEW.created_at)
       IS DISTINCT FROM
       (OLD.organization_id, OLD.target_id, OLD.version, OLD.origin, OLD.based_on_version,
        OLD.profile_version, OLD.components, OLD.ai_generated, OLD.generation, OLD.created_at)
       OR (OLD.status = 'approved' AND (NEW.status, NEW.approved_at)
           IS DISTINCT FROM (OLD.status, OLD.approved_at)) THEN
        RAISE EXCEPTION 'A threat model version can''t be changed. Save a new version instead.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql
"""
)
VERSION_FIXED_TRIGGER = DDL(
    "CREATE TRIGGER threat_models_version_fixed BEFORE UPDATE ON threat_models "
    "FOR EACH ROW EXECUTE FUNCTION sentra_threat_model_version_fixed()"
)
THREAT_FIXED_FUNCTION = DDL(
    """
CREATE OR REPLACE FUNCTION sentra_threat_fixed() RETURNS trigger AS $$
BEGIN
    IF (NEW.threat_model_id, NEW.threat_no, NEW.title, NEW.component_kind, NEW.component_name,
        NEW.owasp, NEW.atlas, NEW.likelihood, NEW.impact, NEW.source, NEW.rule, NEW.rationale,
        NEW.change_reason, NEW.removed, NEW.removal_reason)
       IS DISTINCT FROM
       (OLD.threat_model_id, OLD.threat_no, OLD.title, OLD.component_kind, OLD.component_name,
        OLD.owasp, OLD.atlas, OLD.likelihood, OLD.impact, OLD.source, OLD.rule, OLD.rationale,
        OLD.change_reason, OLD.removed, OLD.removal_reason) THEN
        RAISE EXCEPTION 'A stored threat can''t be changed. Save a new version instead.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql
"""
)
THREAT_FIXED_TRIGGER = DDL(
    "CREATE TRIGGER threats_fixed BEFORE UPDATE ON threats "
    "FOR EACH ROW EXECUTE FUNCTION sentra_threat_fixed()"
)
event.listen(ThreatModel.__table__, "after_create", VERSION_FIXED_FUNCTION)
event.listen(ThreatModel.__table__, "after_create", VERSION_FIXED_TRIGGER)
event.listen(Threat.__table__, "after_create", THREAT_FIXED_FUNCTION)
event.listen(Threat.__table__, "after_create", THREAT_FIXED_TRIGGER)
