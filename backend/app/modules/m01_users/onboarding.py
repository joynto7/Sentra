"""The first-run setup of a member in an organization (Screen: Welcome).

A few questions, one at a time, each skippable, and a first task to start with. What is asked now
is only what helps the next minutes; the rest is asked later, one question at a time, once the
person has seen the product (progressive profiling). Nothing here grants access: the first task a
person can pick is limited by their role's permissions in the interface, and the server still
decides every action.

Only fixed choices are stored, never free text, so there is nothing personal or sensitive in it.
"""

from sqlalchemy.orm import Session

from app.core.errors import FieldValidationError
from app.modules.m01_users.models import Membership

# The questions and the answers each accepts. `goal` and `first_task` come in the setup; the others
# are asked afterwards, one at a time.
CHOICES: dict[str, frozenset[str]] = {
    "goal": frozenset({"own_app", "evaluate", "company", "learn"}),
    "first_task": frozenset({"register_target", "lab", "campaign", "review", "invite", "explore"}),
    "team_size": frozenset({"1", "2-10", "11-50", "50+"}),
    "experience": frozenset({"new", "some", "expert"}),
}
LAST_STEP = 4


def state(membership: Membership) -> dict:
    kept = membership.onboarding or {}
    return {
        "done": bool(kept.get("done")),
        "skipped": bool(kept.get("skipped")),
        "step": int(kept.get("step", 0)),
        "answers": {k: v for k, v in (kept.get("answers") or {}).items() if k in CHOICES},
    }


def save(db: Session, membership: Membership, step: int | None, answers: dict[str, str]) -> dict:
    """Keeps the step reached and the choices made; a question left out stays as it was."""
    for key, value in answers.items():
        if key not in CHOICES:
            raise FieldValidationError(key, "That question does not exist.")
        if value not in CHOICES[key]:
            raise FieldValidationError(key, "That is not one of the choices.")
    if step is not None and not 0 <= step <= LAST_STEP:
        raise FieldValidationError("step", "That step does not exist.")
    kept = dict(membership.onboarding or {})
    if step is not None and not kept.get("done"):
        kept["step"] = step
    kept["answers"] = {**(kept.get("answers") or {}), **answers}
    membership.onboarding = kept  # a new object, so the change is noticed
    db.commit()
    return state(membership)


def finish(db: Session, membership: Membership, *, skipped: bool) -> dict:
    kept = dict(membership.onboarding or {})
    kept["done"] = True
    kept["skipped"] = skipped
    membership.onboarding = kept
    db.commit()
    return state(membership)


def restart(db: Session, membership: Membership) -> dict:
    """Opens the setup again from the first step; the choices made before stay."""
    kept = dict(membership.onboarding or {})
    kept["done"] = False
    kept["skipped"] = False
    kept["step"] = 0
    membership.onboarding = kept
    db.commit()
    return state(membership)


def next_question(membership: Membership) -> str | None:
    """The question to ask after the setup, if any is left. The caller shows one at a time."""
    if not (membership.onboarding or {}).get("done"):
        return None
    answered = state(membership)["answers"]
    for key in ("team_size", "experience"):
        if key not in answered:
            return key
    return None
