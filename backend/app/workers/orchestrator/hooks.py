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
or the run, and the run goes on. An extension doesn't need to commit; the engine does.
"""

import importlib
import logging
import pkgutil
from types import ModuleType

from sqlalchemy.orm import Session

log = logging.getLogger("uvicorn.error")
PACKAGES = ("app.workers", "app.modules")


def _discover() -> list[ModuleType]:
    found = []
    for parent in PACKAGES:
        package = importlib.import_module(parent)
        for info in pkgutil.iter_modules(package.__path__):
            if not info.ispkg or info.name == "orchestrator":
                continue
            name = f"{parent}.{info.name}.hooks"
            try:
                found.append(importlib.import_module(name))
            except ModuleNotFoundError as exc:
                if exc.name != name:
                    raise
    return sorted(found, key=lambda m: (getattr(m, "ORDER", 100), m.__name__))


_modules: list[ModuleType] | None = None


def modules() -> list[ModuleType]:
    global _modules
    if _modules is None:
        _modules = _discover()
    return _modules


def label(module: ModuleType) -> str:
    """The package's name, e.g. "detection" for app.workers.detection.hooks."""
    return module.__name__.split(".")[-2]


def _call(db: Session, module: ModuleType, name: str, *args) -> tuple[object, str | None]:
    """The engine commits its own changes first, so a rollback here only undoes the extension's.
    An extension may commit, e.g. through notify(); what it committed then stays."""
    function = getattr(module, name, None)
    if function is None:
        return None, None
    savepoint = db.begin_nested()
    try:
        result = function(db, *args)
    except Exception as exc:
        if savepoint.is_active:
            savepoint.rollback()
        else:
            db.rollback()
        log.exception("The %s extension %s failed", label(module), name)
        return None, f"{type(exc).__name__}: {exc}"[:300]
    if savepoint.is_active:
        savepoint.commit()
    return result, None


def on_attempt(db: Session, attempt, reply) -> tuple[dict, list[dict]]:
    """The results of every extension for one attempt, and the problems of those that failed."""
    results, problems = {}, []
    for module in modules():
        result, error = _call(db, module, "on_attempt", attempt, reply)
        if error:
            problems.append({"extension": label(module), "error": error})
        elif isinstance(result, dict):
            results[label(module)] = result
    return results, problems


def on_run_end(db: Session, run) -> list[dict]:
    problems = []
    for module in modules():
        _, error = _call(db, module, "on_run_end", run)
        if error:
            problems.append({"extension": label(module), "error": error})
    return problems
