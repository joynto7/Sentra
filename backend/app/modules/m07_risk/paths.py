"""The attack paths of a target (FR-7.3, UC-7.5 Explore Attack Paths).

The graph is the target's own structure: the components its Target Profile records (FR-2.5) with
the connections between them, and the open findings placed on the component each one affects
(UC-6.2). A path is a chain of findings that follows those connections from something an attacker
can reach to an impact.

Nothing here asks a model or sends a request. The same findings always give the same paths, and
every step is named from the profile, so an analyst can check each one (UC-7.5, quality
requirement 4; NFR-4.2). Only one thing is stored: an analyst's decision to dismiss a path (6a1).
"""

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import audit
from app.core.errors import FieldValidationError, NotFoundError
from app.core.tenancy import scoped_select
from app.modules.m01_users.models import User
from app.modules.m02_targets.models import ProfileStatus, Target, TargetProfile
from app.modules.m03_threat_models import components
from app.modules.m06_findings.models import (
    OPEN,
    ComponentKind,
    Finding,
    FindingStatus,
    component_label,
)
from app.modules.m06_findings.service import SEVERITY_RANK
from app.modules.m07_risk.models import AttackPathDismissal

# A node kind of the graph only. No threat and no finding sits on the input channel: a threat model
# names the components of the application itself (FR-3.1).
INPUT = "input"
INPUT_NAME = "User input"
INPUT_NOTE = "Every request to the target arrives here."
NOT_IN_PROFILE = "Not in the Target Profile. A finding names it, so it is drawn here."
NO_PROFILE = (
    "no_profile",
    "Map the target's profile first. The components of the graph come from it.",
)
NO_FINDINGS = "This target has no open finding, so there is nothing to place on its components."
ONE_FINDING = "Only one open finding is on this target, so there is no chain of steps to follow."
NO_CHAIN = (
    "No open finding of this target sits on a component that another finding's component leads "
    "to, so no multi-step path was found."
)
ALL_DISMISSED = "Every path that was found has been dismissed."
MAX_PATHS = 10  # what the panel of Screen 44 lists; further routes would be noise
MAX_ROUTES = 500  # a hard stop for the search, so a target with many components stays fast
MIN_REASON = 5  # as for an accepted threat gap (UC-3.3)
MAPPED = (ProfileStatus.READY, ProfileStatus.PARTIAL, ProfileStatus.REVIEWED)

# Where each kind of component sits in the application's pipeline. A path always moves forward
# along it, so it can never run in a circle, and two findings on the same kind of component are
# never linked: the profile records nothing that leads from one tool to another.
STAGE: dict[str, int] = {
    INPUT: 0,
    ComponentKind.KNOWLEDGE_SOURCE: 1,
    ComponentKind.SYSTEM_PROMPT: 2,
    ComponentKind.MODEL: 3,
    ComponentKind.TOOL: 4,
    ComponentKind.OUTPUT: 5,
}
# The profile records no way for an answer to write back into the system prompt or a knowledge
# source, so no step of a path ends there.
NO_WAY_IN = (ComponentKind.SYSTEM_PROMPT, ComponentKind.KNOWLEDGE_SOURCE)
# Where a path can end: an action the application carries out, or an answer that leaves it.
IMPACT_KINDS = (ComponentKind.TOOL, ComponentKind.OUTPUT)
ENTRY_STAGE = 1  # the request itself and the knowledge sources: what comes from outside
# The connections, and why each one exists. They are the only ones a path may follow.
EDGES: dict[tuple[str, str], str] = {
    (INPUT, ComponentKind.MODEL): "Every request to the target reaches the model.",
    (ComponentKind.KNOWLEDGE_SOURCE, ComponentKind.MODEL): (
        "The Target Profile lists this knowledge source, so the model retrieves from it."
    ),
    (ComponentKind.SYSTEM_PROMPT, ComponentKind.MODEL): (
        "The system prompt tells the model how to behave."
    ),
    (ComponentKind.MODEL, ComponentKind.TOOL): (
        "The Target Profile lists this tool, so the model can call it."
    ),
    (ComponentKind.TOOL, ComponentKind.MODEL): "What a tool answers goes back to the model.",
    (ComponentKind.MODEL, ComponentKind.OUTPUT): (
        "The model's answer leaves the application through this channel."
    ),
}
# How a step reads, by the kind of component it arrives at (NFR-4.2).
ARRIVAL = {
    INPUT: "A request arrives at the target.",
    ComponentKind.KNOWLEDGE_SOURCE: "Content placed in {label} is retrieved by the model.",
    ComponentKind.SYSTEM_PROMPT: "The request works on the model's own instructions.",
    ComponentKind.MODEL: "The model answers the request.",
    ComponentKind.TOOL: "The model calls {name}.",
    ComponentKind.OUTPUT: "The answer leaves the application through {name}.",
}


def _label(kind: str, name: str) -> str:
    """How a component is named on the page, as findings name theirs (Screen 39)."""
    return "Input channel: " + name if kind == INPUT else component_label(kind, name)


def _sentence(text: str, kind: str, name: str) -> str:
    return text.format(label=_label(kind, name), name=name)


@dataclass
class Node:
    """One component of the target, as the Target Profile records it."""

    kind: str
    name: str
    note: str = ""
    in_profile: bool = True
    side_effect: str = ""  # what a tool changes, as the profile says
    access: str = ""  # who may read a knowledge source, as the profile says
    findings: list[Finding] = field(default_factory=list)

    @property
    def id(self) -> str:
        return f"{self.kind}:{self.name}"

    @property
    def stage(self) -> int:
        return STAGE[self.kind]

    @property
    def label(self) -> str:
        return _label(self.kind, self.name)

    def arrival(self) -> str:
        return _sentence(ARRIVAL[self.kind], self.kind, self.name)

    def impact(self) -> str:
        """What is at stake where a path ends (UC-7.5 step 5)."""
        if self.kind == ComponentKind.OUTPUT:
            return f"At its end the answer leaves the application through {self.name}."
        if self.kind != ComponentKind.TOOL:
            return ""
        # The side effect is what a person typed into the profile, a verb phrase or not ("issues
        # a refund", "read-only"), so the sentence quotes it instead of continuing it.
        effect = self.side_effect.strip().rstrip(".")
        if effect:
            return (
                f"At its end the model calls {self.name}. Its side effect in the target profile: "
                f"{effect[0].lower()}{effect[1:]}."
            )
        return f"At its end the model calls {self.name}, an action of the application."

    def as_json(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "label": self.label,
            "stage": self.stage,
            "note": self.note,
            "in_profile": self.in_profile,
            "entry": self.stage <= ENTRY_STAGE,
            "impact": self.impact(),
            "findings": [f.code for f in self.findings],
        }


def _reaches(first: Node, second: Node) -> bool:
    """Whether what happens at `first` can go on to `second`, along the connections above."""
    return second.stage > first.stage and second.kind not in NO_WAY_IN


def _nodes(target: Target, profile: TargetProfile) -> list[Node]:
    """UC-7.5 step 2: the components of the target, in the order of the pipeline."""
    found = [Node(INPUT, INPUT_NAME, note=INPUT_NOTE)]
    for component in components.identify(target, profile):
        found.append(
            Node(
                component.kind.value,
                component.name,
                note=component.note,
                side_effect=component.side_effect,
                access=component.access,
            )
        )
    return found


def _edges(nodes: list[Node]) -> list[dict]:
    return [
        {"from": one.id, "to": other.id, "why": why}
        for one in nodes
        for other in nodes
        for why in [EDGES.get((one.kind, other.kind))]
        if why is not None
    ]


def _place(nodes: list[Node], findings: list[Finding]) -> dict[uuid.UUID, Node]:
    """UC-7.5 step 3: each open finding on the component it affects. A component the profile no
    longer lists keeps its own node, so the finding is never silently dropped."""
    by_component = {(node.kind, node.name.lower()): node for node in nodes}
    where: dict[uuid.UUID, Node] = {}
    for finding in findings:
        key = (finding.component_kind, finding.component_name.lower())
        node = by_component.get(key)
        if node is None:
            node = Node(finding.component_kind, finding.component_name, NOT_IN_PROFILE, False)
            by_component[key] = node
            nodes.append(node)
        node.findings.append(finding)
        where[finding.id] = node
    return where


def _routes(nodes: list[Node]) -> list[list[Node]]:
    """Step 4: the routes through the components on which every step carries at least one open
    finding, each followed as far as it goes. A route, not a combination of findings: three
    findings on one knowledge source and two on the model are one way in, not six of them, so
    what the panel of Screen 44 lists stays readable and every path is a different route."""
    carrying = [node for node in nodes if node.findings]
    found: list[list[Node]] = []

    def walk(route: list[Node]) -> None:
        if len(found) >= MAX_ROUTES:
            return
        onward = [node for node in carrying if _reaches(route[-1], node)]
        if not onward:
            if len(route) > 1 and route[-1].kind in IMPACT_KINDS:
                found.append(route)
            return
        for node in onward:
            walk([*route, node])

    for start in carrying:
        if not any(_reaches(other, start) for other in carrying):
            walk([start])
    return _maximal(found)


def _holds(short: list[str], long: list[str]) -> bool:
    """Whether the longer route goes through every component of the shorter one, in order."""
    rest = iter(long)
    return all(any(one == other for other in rest) for one in short)


def _maximal(routes: list[list[Node]]) -> list[list[Node]]:
    """A route that a longer one goes through says nothing new: the longer one already shows the
    findings on the way. Only the longer one is a path."""
    ids = [[node.id for node in route] for route in routes]
    return [
        route
        for index, route in enumerate(routes)
        if not any(
            len(other) > len(ids[index]) and _holds(ids[index], other)
            for position, other in enumerate(ids)
            if position != index
        )
    ]


def _key(route: list[Node]) -> str:
    """The name of a path: a digest of its components and of the findings on them, in order. A
    dismissal holds while the path is the same (6a1); a new finding on the way makes a new path,
    which is shown again, so a dismissal never hides fresh evidence."""
    steps = ";".join(
        f"{node.id}|{','.join(str(finding.id) for finding in node.findings)}" for node in route
    )
    return hashlib.sha256(steps.encode()).hexdigest()[:32]


def _unconfirmed(finding: Finding) -> bool:
    """3a: a finding that only the LLM judge supports still needs an analyst (NFR-9.3)."""
    return finding.status == FindingStatus.REQUIRES_CONFIRMATION


def _rank(severity: str) -> int:
    return SEVERITY_RANK.get(severity, len(SEVERITY_RANK))


def _finding_json(finding: Finding, node: Node) -> dict:
    return {
        "code": finding.code,
        "title": finding.title,
        "severity": finding.severity,
        "status": finding.status,
        "category": finding.category,
        "unconfirmed": _unconfirmed(finding),
        "last_seen_at": finding.last_seen_at,
        "node_id": node.id,
        "component": {"kind": node.kind, "name": node.name, "label": node.label},
        "in_profile": node.in_profile,
    }


def _severity(route: list[Node]) -> str:
    """Step 5: the severity of a path is the highest of the findings on it. The impact at its end
    is only reached when every step holds, so the path is as serious as its worst step."""
    return min((finding.severity for node in route for finding in node.findings), key=_rank)


def _description(route: list[Node], codes: list[str]) -> str:
    """The path in plain language (NFR-4.2): where it starts, which components it runs through and
    which findings are on it. What is at stake at its end is its own sentence (`impact`)."""
    labels = [node.label for node in route]
    through = (
        f"From there it runs to {labels[-1]}."
        if len(route) == 2
        else f"From there it runs through {', '.join(labels[1:-1])} to {labels[-1]}."
    )
    many = f"{len(codes)} open findings are on it"
    count = "1 open finding is on it" if len(codes) == 1 else many
    return f"{route[0].arrival()} {through} {count}: {', '.join(codes)}."


def _path_json(route: list[Node]) -> dict:
    on_it = [(node, finding) for node in route for finding in node.findings]
    codes = [finding.code for _, finding in on_it]
    return {
        "key": _key(route),
        "code": "",  # AP-1, AP-2 …: given by _order(), the order the panel of Screen 44 lists
        "severity": _severity(route),
        "impact": route[-1].impact(),
        "description": _description(route, codes),
        "has_unconfirmed": any(_unconfirmed(finding) for _, finding in on_it),
        "node_ids": [node.id for node in route],
        "finding_codes": codes,
        "steps": [
            {
                "number": position,
                "sentence": node.arrival(),
                "component": {"kind": node.kind, "name": node.name, "label": node.label},
                "findings": [_finding_json(finding, node) for finding in node.findings],
            }
            for position, node in enumerate(route, start=1)
        ],
    }


def _order(paths: list[dict], *, number: bool = True) -> list[dict]:
    """Ordered by what is at stake (UC-7.5 step 5), the longest route first among equals. Only the
    paths the view shows are numbered; a dismissed path keeps no number of its own."""
    paths.sort(key=lambda path: (_rank(path["severity"]), -len(path["steps"]), path["node_ids"]))
    if number:
        for position, path in enumerate(paths, start=1):
            path["code"] = f"AP-{position}"
    return paths


def open_findings(db: Session, organization_id: uuid.UUID, target_id: uuid.UUID) -> list[Finding]:
    """The target's open findings, the most severe first, as the list beside the graph has them."""
    found = list(
        db.scalars(
            scoped_select(Finding, organization_id).where(
                Finding.target_id == target_id, Finding.status.in_(OPEN)
            )
        )
    )
    found.sort(key=lambda f: (_rank(f.severity), f.number))
    return found


def _dismissals(db: Session, target_id: uuid.UUID) -> dict[str, AttackPathDismissal]:
    rows = db.scalars(
        select(AttackPathDismissal).where(AttackPathDismissal.target_id == target_id)
    ).all()
    return {row.path_key: row for row in rows}


def _names(db: Session, ids: list[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    wanted = {one for one in ids if one is not None}
    if not wanted:
        return {}
    return dict(db.execute(select(User.id, User.name).where(User.id.in_(wanted))).all())


def _profile(db: Session, target_id: uuid.UUID) -> TargetProfile | None:
    profile = db.scalar(select(TargetProfile).where(TargetProfile.target_id == target_id))
    return profile if profile is not None and profile.status in MAPPED else None


def _reason_why_none(findings: list[Finding], routes: int, hidden: int) -> str:
    """4a1, and the two cases before it: the view says why there is no path."""
    if not findings:
        return NO_FINDINGS
    if len(findings) == 1:
        return ONE_FINDING
    if routes and not hidden:
        return ""
    return ALL_DISMISSED if routes else NO_CHAIN


def view(db: Session, target: Target) -> dict:
    """UC-7.5 steps 2-5 for one target. Without a profile the graph can't be drawn, so the findings
    are listed on their own and the view says why (the failed end condition)."""
    findings = open_findings(db, target.organization_id, target.id)
    profile = _profile(db, target.id)
    target_json = {
        "id": target.id,
        "name": target.name,
        "type": target.type,
        "environment": target.environment,
    }
    if profile is None:
        bare = [Node(f.component_kind, f.component_name, NOT_IN_PROFILE, False) for f in findings]
        return {
            "target": target_json,
            "blocker": {"code": NO_PROFILE[0], "message": NO_PROFILE[1]},
            "nodes": [],
            "edges": [],
            "paths": [],
            "dismissed": [],
            "findings": [_finding_json(f, n) for f, n in zip(findings, bare, strict=True)],
            "unconfirmed": sum(_unconfirmed(f) for f in findings),
            "no_paths_reason": "",
            "profile_version": None,
        }
    nodes = _nodes(target, profile)
    where = _place(nodes, findings)
    dismissed_rows = _dismissals(db, target.id)
    names = _names(db, [row.dismissed_by_id for row in dismissed_rows.values()])
    routes = _routes(nodes)
    shown, hidden = [], []
    for route in routes:
        path = _path_json(route)
        row = dismissed_rows.get(path["key"])
        if row is None:
            shown.append(path)
            continue
        path["reason"] = row.reason
        path["dismissed_at"] = row.dismissed_at
        path["dismissed_by"] = names.get(row.dismissed_by_id, "")
        hidden.append(path)
    return {
        "target": target_json,
        "blocker": None,
        "nodes": [node.as_json() for node in nodes],
        "edges": _edges(nodes),
        "paths": _order(shown)[:MAX_PATHS],
        "dismissed": _order(hidden, number=False),
        "findings": [_finding_json(finding, where[finding.id]) for finding in findings],
        "unconfirmed": sum(_unconfirmed(f) for f in findings),
        "no_paths_reason": _reason_why_none(findings, len(routes), len(hidden)),
        "profile_version": profile.version,
    }


# ---------------------------------------------------------------- dismissing a path (6a1)


def _codes(path: dict) -> list[str]:
    return list(path["finding_codes"])


def _in_view(db: Session, target: Target, path_key: str) -> dict:
    shown = view(db, target)
    for path in shown["paths"] + shown["dismissed"]:
        if path["key"] == path_key:
            return path
    raise NotFoundError(
        "This attack path is not in the target's view. Its findings may have changed since."
    )


def dismiss(db: Session, target: Target, user: User, path_key: str, reason: str) -> dict:
    """6a1: an analyst considers a path implausible. It disappears from the view and from the
    reports of FR-9.1, and the decision is kept with its reason."""
    if len(reason.strip()) < MIN_REASON:
        raise FieldValidationError("reason", "Give a reason for dismissing this path.")
    path = _in_view(db, target, path_key)
    row = db.scalar(
        select(AttackPathDismissal).where(
            AttackPathDismissal.target_id == target.id,
            AttackPathDismissal.path_key == path_key,
        )
    )
    if row is None:
        row = AttackPathDismissal(
            organization_id=target.organization_id,
            target_id=target.id,
            path_key=path_key,
            finding_codes=_codes(path),
        )
        db.add(row)
    row.reason = reason.strip()[:300]
    row.dismissed_by_id = user.id
    row.dismissed_at = datetime.now(UTC)
    audit.record(
        db,
        organization_id=target.organization_id,
        actor=user,
        action="attack_path.dismissed",
        summary=(
            f"Dismissed the attack path {' → '.join(_codes(path))} of {target.name}: {row.reason}"
        ),
        item=audit.Item("attack_path", target.id, f"{target.name}, {'-'.join(_codes(path))}"),
        details={"findings": _codes(path), "severity": path["severity"], "path_key": path_key},
    )
    db.commit()
    return view(db, target)


def restore(db: Session, target: Target, user: User, path_key: str) -> dict:
    """Taking a dismissal back, so a path that was hidden by mistake is shown again."""
    row = db.scalar(
        select(AttackPathDismissal).where(
            AttackPathDismissal.target_id == target.id,
            AttackPathDismissal.path_key == path_key,
        )
    )
    if row is None:
        raise NotFoundError("This attack path was not dismissed.")
    codes = list(row.finding_codes)
    db.delete(row)
    audit.record(
        db,
        organization_id=target.organization_id,
        actor=user,
        action="attack_path.restored",
        summary=f"Showed the attack path {' → '.join(codes)} of {target.name} again",
        item=audit.Item("attack_path", target.id, f"{target.name}, {'-'.join(codes)}"),
        details={"findings": codes, "path_key": path_key},
    )
    db.commit()
    return view(db, target)
