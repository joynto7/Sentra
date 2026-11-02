"""How a module takes part in work that another part of Sentra drives (NFR-5.3).

A package of app/modules/ or app/workers/ adds a module of an agreed name, and whoever drives the
work finds it by itself: nothing has to import it, and nothing has to be listed anywhere. Two
places use this:

    hooks.py      the extension points of a campaign run (orchestrator/hooks.py)
    schedules.py  the work that is due at a time (workers/scheduler.py)

Every call runs in a savepoint, so one module's failure neither stops the others nor undoes their
work; the caller is given the problem in words and records it where its own work can be seen.
"""

import importlib
import logging
import pkgutil
from collections.abc import Callable
from types import ModuleType

from sqlalchemy.orm import Session

log = logging.getLogger("uvicorn.error")
PACKAGES = ("app.workers", "app.modules")


def discover(name: str, *, skip: tuple[str, ...] = (), order: str = "ORDER") -> list[ModuleType]:
    """Every `<package>.<name>` module there is, in the order the packages ask for: a module with
    a lower `order` attribute goes first (100 without one), then by name."""
    found = []
    for parent in PACKAGES:
        package = importlib.import_module(parent)
        for info in pkgutil.iter_modules(package.__path__):
            if not info.ispkg or info.name in skip:
                continue
            full_name = f"{parent}.{info.name}.{name}"
            try:
                found.append(importlib.import_module(full_name))
            except ModuleNotFoundError as exc:
                if exc.name != full_name:  # the module itself imports something that is missing
                    raise
    return sorted(found, key=lambda module: (getattr(module, order, 100), module.__name__))


def label(module: ModuleType) -> str:
    """The package's name, for example "detection" for app.workers.detection.hooks."""
    return module.__name__.split(".")[-2]


def call(db: Session, module: ModuleType, name: str, *args) -> tuple[object, str | None]:
    """Calls `module.name(db, *args)` in a savepoint and returns what it gave back, or the
    problem it ran into in words. A module that isn't interested in this call has no such
    function, and nothing happens. The caller commits; a module may commit its own work."""
    function: Callable | None = getattr(module, name, None)
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
