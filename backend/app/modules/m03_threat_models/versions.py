"""The versions of a threat model (FR-3.3). Every new version gets the target's next number, and
each threat keeps its number from version to version, so versions can be compared (UC-3.4)."""

import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.m02_targets.models import Target
from app.modules.m03_threat_models.baseline import Draft
from app.modules.m03_threat_models.models import (
    Threat,
    ThreatModel,
    ThreatModelStatus,
    ThreatSource,
)


def latest(db: Session, target_id: uuid.UUID) -> ThreatModel | None:
    return db.scalar(
        select(ThreatModel)
        .where(ThreatModel.target_id == target_id)
        .order_by(ThreatModel.version.desc())
        .limit(1)
    )


def get(db: Session, target_id: uuid.UUID, version: int) -> ThreatModel | None:
    return db.scalar(
        select(ThreatModel).where(
            ThreatModel.target_id == target_id, ThreatModel.version == version
        )
    )


def _normalise(title: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", title.lower()).split())


def key(item: Draft | Threat) -> tuple:
    """What makes two threats of different versions the same threat: the baseline rule and the
    component, or else the component and the title."""
    component = (item.component_kind, item.component_name.lower())
    if item.rule:
        return ("rule", item.rule, *component)
    return ("title", *component, _normalise(item.title))


def title_key(item: Draft | Threat) -> tuple:
    return (item.component_kind, item.component_name.lower(), _normalise(item.title))


def next_threat_no(db: Session, target_id: uuid.UUID) -> int:
    """A number no threat of the target has had, so a removed threat's number is never reused."""
    highest = db.scalar(
        select(func.max(Threat.threat_no))
        .join(ThreatModel, ThreatModel.id == Threat.threat_model_id)
        .where(ThreatModel.target_id == target_id)
    )
    return (highest or 0) + 1


def store(
    db: Session,
    target: Target,
    *,
    origin: str,
    based_on: ThreatModel | None,
    components: list[dict],
    drafts: list[Draft],
    created_by_id: uuid.UUID | None,
    generation: dict | None = None,
    profile_version: int | None = None,
) -> ThreatModel:
    """Adds the next draft version; earlier versions stay as they are (FR-3.3). The caller
    commits."""
    previous = latest(db, target.id)
    number = (previous.version if previous else 0) + 1
    next_no = next_threat_no(db, target.id)
    model = ThreatModel(
        organization_id=target.organization_id,
        target_id=target.id,
        version=number,
        status=ThreatModelStatus.DRAFT,
        origin=origin,
        based_on_version=based_on.version if based_on else None,
        profile_version=profile_version,
        components=components,
        ai_generated=any(
            d.source == ThreatSource.AI_SUGGESTED and not d.extra.get("removed") for d in drafts
        ),
        generation=generation or {},
        created_by_id=created_by_id,
    )
    for draft in drafts:
        number_of_threat = draft.extra.get("threat_no")
        if number_of_threat is None:
            number_of_threat, next_no = next_no, next_no + 1
        model.threats.append(
            Threat(
                threat_no=number_of_threat,
                title=draft.title,
                component_kind=draft.component_kind,
                component_name=draft.component_name,
                owasp=draft.owasp,
                atlas=draft.atlas,
                likelihood=draft.likelihood,
                impact=draft.impact,
                source=draft.source,
                rule=draft.rule,
                rationale=draft.rationale or None,
                rated_by_id=draft.extra.get("rated_by_id"),
                edited_by_id=draft.extra.get("edited_by_id"),
                change_reason=draft.extra.get("change_reason"),
                removed=bool(draft.extra.get("removed", False)),
                removal_reason=draft.extra.get("removal_reason"),
            )
        )
    db.add(model)
    db.flush()
    return model
