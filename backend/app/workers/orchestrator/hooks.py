"""Extension points of a campaign run (NFR-5.3): later modules plug into every run without the
run engine importing them, and without any change to it.

A package of app/workers/ or app/modules/ takes part by adding a module hooks.py with either or
both of these functions:

    ORDER = 10  # optional: lower numbers run first (detection before findings before risk)

    def on_attempt(db, attempt, reply) -> dict | None:
        '''After every attempt that got a reply, e.g. the detection (FR-6.1). `reply` is the raw
        reply of the Target Connector; the attempt row holds only the masked text. What it returns
        is added to the attempt's live event under the package's name.'''

    def on_run_end(db, run) -> None:
        '''Once, when the run has ended, e.g. the target's risk score (FR-7.2).'''

Each call runs in a savepoint: a failing extension is rolled back and recorded with the attempt
or the run, and the run goes on. An extension doesn't need to commit; the engine does. How the
modules are found and called is app/workers/extensions.py, which the scheduler uses as well.
"""

from types import ModuleType

from sqlalchemy.orm import Session

from app.workers import extensions
from app.workers.extensions import label

_modules: list[ModuleType] | None = None


def modules() -> list[ModuleType]:
    global _modules
    if _modules is None:
        _modules = extensions.discover("hooks", skip=("orchestrator",))
    return _modules


def on_attempt(db: Session, attempt, reply) -> tuple[dict, list[dict]]:
    """The results of every extension for one attempt, and the problems of those that failed."""
    results, problems = {}, []
    for module in modules():
        result, error = extensions.call(db, module, "on_attempt", attempt, reply)
        if error:
            problems.append({"extension": label(module), "error": error})
        elif isinstance(result, dict):
            results[label(module)] = result
    return results, problems


def on_run_end(db: Session, run) -> list[dict]:
    problems = []
    for module in modules():
        _, error = extensions.call(db, module, "on_run_end", run)
        if error:
            problems.append({"extension": label(module), "error": error})
    return problems
