"""The versions of a threat model (FR-3.3). Every new version gets the target's next number, and
each threat keeps its number from version to version, so versions can be compared (UC-3.4)."""

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import AppError, ConflictError, NotFoundError
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import Target
from app.modules.m03_threat_models import frameworks
from app.modules.m03_threat_models.baseline import Draft
from app.modules.m03_threat_models.models import (
    ComponentKind,
    Origin,
    Threat,
    ThreatModel,
    ThreatModelStatus,
    ThreatSource,
)
from app.modules.m03_threat_models.schemas import VersionIn


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


# ---------------------------------------------------------------- reviewing (UC-3.2, UC-3.4)

MIN_REASON = 5
EDITABLE = ("title", "owasp", "atlas", "likelihood", "impact")


def _newer(model: ThreatModel, seen: int) -> ConflictError:
    """5b: someone saved a newer version while the user was reviewing."""
    return ConflictError(
        f"Someone saved version {model.version} while you were reviewing version {seen}. Review "
        "their changes first.",
        code="newer_version",
        details=[{"field": "base_version", "message": str(model.version)}],
    )


def _copy(threat: Threat) -> Draft:
    """A threat taken into the next version: what people decided stays, the mark "changed in
    this version" doesn't."""
    return Draft(
        title=threat.title,
        component_kind=threat.component_kind,
        component_name=threat.component_name,
        owasp=list(threat.owasp),
        atlas=threat.atlas,
        likelihood=threat.likelihood,
        impact=threat.impact,
        source=threat.source,
        rule=threat.rule,
        rationale=threat.rationale or "",
        extra={
            "threat_no": threat.threat_no,
            "rated_by_id": threat.rated_by_id,
            "change_reason": threat.change_reason,
            "removed": threat.removed,
            "removal_reason": threat.removal_reason,
        },
    )


def _mapping(
    owasp: list[str], atlas: str | None, where: str, problems: list[dict]
) -> tuple[list[str], str | None]:
    """FR-3.2: at least one OWASP category (3a); an ATLAS technique only if well-formed."""
    codes = frameworks.clean_owasp(owasp)
    if not codes:
        problems.append(
            {"field": f"{where}.owasp", "message": "Choose at least one OWASP category."}
        )
    technique = (atlas or "").strip() or None
    if technique and not frameworks.valid_atlas(technique):
        problems.append(
            {"field": f"{where}.atlas", "message": "Use a MITRE ATLAS ID such as AML.T0051."}
        )
    return codes, technique


def save(db: Session, target: Target, user: User, data: VersionIn) -> ThreatModel:
    """UC-3.2 steps 3-4: the changes become the next version; the version they were made to stays
    as it was (FR-3.3)."""
    base = latest(db, target.id)
    if base is None:
        raise NotFoundError("This target has no threat model yet.")
    if data.base_version != base.version:
        raise _newer(base, data.base_version)
    drafts = {t.threat_no: _copy(t) for t in base.threats}
    problems: list[dict] = []
    touched: set[int] = set()

    def find(number: int, where: str) -> Draft | None:
        if number in touched:
            problems.append({"field": where, "message": f"Threat {number} is changed twice."})
            return None
        touched.add(number)
        if number not in drafts:
            problems.append({"field": where, "message": f"There is no threat {number}."})
            return None
        return drafts[number]

    changed = 0
    for edit in data.edit:
        where = f"threats.{edit.number}"
        draft = find(edit.number, where)
        if draft is None:
            continue
        if draft.extra["removed"]:
            problems.append({"field": where, "message": "Restore the threat before changing it."})
            continue
        owasp, atlas = _mapping(edit.owasp, edit.atlas, where, problems)
        after = {
            "title": " ".join(edit.title.split()),
            "owasp": owasp,
            "atlas": atlas,
            "likelihood": edit.likelihood,
            "impact": edit.impact,
        }
        if all(getattr(draft, f) == after[f] for f in EDITABLE):
            continue
        if (draft.likelihood, draft.impact) != (edit.likelihood, edit.impact):
            draft.extra["rated_by_id"] = user.id
        for name, value in after.items():
            setattr(draft, name, value)
        draft.extra.update(edited_by_id=user.id, change_reason=edit.reason.strip() or None)
        changed += 1
    removed = 0
    for removal in data.remove:
        where = f"threats.{removal.number}"
        draft = find(removal.number, where)
        if draft is None:
            continue
        if draft.extra["removed"]:
            problems.append({"field": where, "message": "This threat is removed already."})
        elif len(removal.reason.strip()) < MIN_REASON:
            problems.append(
                {"field": f"{where}.reason", "message": "Give a reason for removing it."}
            )
        else:
            draft.extra.update(
                removed=True, removal_reason=removal.reason.strip(), edited_by_id=user.id
            )
            removed += 1
    restored = 0
    for number in data.restore:
        where = f"threats.{number}"
        draft = find(number, where)
        if draft is not None and not draft.extra["removed"]:
            problems.append({"field": where, "message": "This threat isn't removed."})
        elif draft is not None:
            draft.extra.update(removed=False, removal_reason=None, edited_by_id=user.id)
            restored += 1
    components = {(c["kind"], c["name"].lower()): c["name"] for c in base.components}
    added: list[Draft] = []
    for index, new in enumerate(data.add):
        where = f"add.{index}"
        owasp, atlas = _mapping(new.owasp, new.atlas, where, problems)
        kind, name = new.component_kind, " ".join(new.component_name.split())
        if kind not in {k.value for k in ComponentKind}:
            problems.append({"field": f"{where}.component", "message": "Choose a component."})
            continue
        if kind != ComponentKind.OUTPUT:
            # Outputs may be named freely; other components come from the Target Profile.
            if (kind, name.lower()) not in components:
                problems.append(
                    {"field": f"{where}.component", "message": "Choose one of the components."}
                )
                continue
            name = components[(kind, name.lower())]
        added.append(
            Draft(
                title=" ".join(new.title.split()),
                component_kind=kind,
                component_name=name,
                owasp=owasp,
                atlas=atlas,
                likelihood=new.likelihood,
                impact=new.impact,
                source=ThreatSource.ANALYST.value,
                extra={
                    "rated_by_id": user.id,
                    "edited_by_id": user.id,
                    "change_reason": new.reason.strip() or None,
                },
            )
        )
    if problems:
        raise AppError(
            "Some changes can't be saved.",
            code="validation_error",
            status_code=422,
            details=problems,
        )
    if not (changed or removed or restored or added):
        raise AppError("There are no changes to save.", code="no_changes", status_code=422)
    model = store(
        db,
        target,
        origin=Origin.EDITED,
        based_on=base,
        components=base.components,
        drafts=list(drafts.values()) + added,
        created_by_id=user.id,
        profile_version=base.profile_version,
    )
    counts = {"changed": changed, "added": len(added), "removed": removed, "restored": restored}
    audit.record(
        db,
        organization_id=target.organization_id,
        actor=user,
        action="threat_model.saved",
        summary=f"Saved version {model.version} of the threat model of {target.name}: "
        + ", ".join(f"{n} {what}" for what, n in counts.items() if n),
        item=audit.Item("threat_model", target.id, f"{target.name}, version {model.version}"),
        details={"version": model.version, "based_on": base.version, **counts},
    )
    db.commit()
    return model


def approve(db: Session, target: Target, user: User, version: int) -> ThreatModel:
    """UC-3.2 steps 5-6: only a person approves, never Sentra (NFR-9.3), and the approval is
    recorded with the person's name (FR-10.2)."""
    model = get(db, target.id, version)
    if model is None:
        raise NotFoundError(f"Version {version} of this threat model doesn't exist.")
    if model.status == ThreatModelStatus.APPROVED:
        raise ConflictError(f"Version {version} is approved already.", code="already_approved")
    newest = latest(db, target.id)
    if newest is not None and newest.version != version:
        raise _newer(newest, version)
    model.status = ThreatModelStatus.APPROVED
    model.approved_at, model.approved_by_id = datetime.now(UTC), user.id
    audit.record(
        db,
        organization_id=target.organization_id,
        actor=user,
        action="threat_model.approved",
        summary=f"Approved version {version} of the threat model of {target.name}",
        item=audit.Item("threat_model", target.id, f"{target.name}, version {version}"),
        details={"version": version},
    )
    db.commit()
    return model


def restore(db: Session, target: Target, user: User, version: int) -> ThreatModel:
    """UC-3.4, 3a: an earlier version becomes the next draft, which must be approved again."""
    earlier = get(db, target.id, version)
    if earlier is None:
        raise NotFoundError(f"Version {version} of this threat model doesn't exist.")
    newest = latest(db, target.id)
    if newest is not None and newest.version == version:
        raise ConflictError("This is the newest version already.", code="newest_version")
    model = store(
        db,
        target,
        origin=Origin.RESTORED,
        based_on=earlier,
        components=earlier.components,
        drafts=[_copy(t) for t in earlier.threats],
        created_by_id=user.id,
        profile_version=earlier.profile_version,
    )
    audit.record(
        db,
        organization_id=target.organization_id,
        actor=user,
        action="threat_model.restored",
        summary=f"Restored version {version} of the threat model of {target.name} as version "
        f"{model.version}",
        item=audit.Item("threat_model", target.id, f"{target.name}, version {model.version}"),
        details={"version": model.version, "restored": version},
    )
    db.commit()
    return model


def _shown(value) -> str:
    if isinstance(value, list):
        return ", ".join(value)
    return "—" if value is None else str(value)


def differences(old: ThreatModel, new: ThreatModel) -> dict:
    """UC-3.4 step 4: the threats added, removed and changed from `old` to `new`, with the reasons
    recorded for removals and changes."""
    before = {t.threat_no: t for t in old.threats if not t.removed}
    after_all = {t.threat_no: t for t in new.threats}
    after = {n: t for n, t in after_all.items() if not t.removed}

    def item(threat: Threat, reason: str | None) -> dict:
        return {
            "number": threat.threat_no,
            "title": threat.title,
            "component_name": threat.component_name,
            "owasp": list(threat.owasp),
            "atlas": threat.atlas,
            "likelihood": threat.likelihood,
            "impact": threat.impact,
            "reason": reason,
        }

    added = [item(t, t.change_reason) for n, t in sorted(after.items()) if n not in before]
    removed = [
        item(t, after_all[n].removal_reason if n in after_all else None)
        for n, t in sorted(before.items())
        if n not in after
    ]
    changed = []
    for number, new_threat in sorted(after.items()):
        old_threat = before.get(number)
        if old_threat is None:
            continue
        fields = [
            {
                "field": name,
                "before": _shown(getattr(old_threat, name)),
                "after": _shown(getattr(new_threat, name)),
            }
            for name in EDITABLE
            if getattr(old_threat, name) != getattr(new_threat, name)
        ]
        if fields:
            changed.append(
                {
                    "number": number,
                    "title": new_threat.title,
                    "component_name": new_threat.component_name,
                    "changes": fields,
                    "reason": new_threat.change_reason,
                }
            )
    return {"added": added, "removed": removed, "changed": changed}
