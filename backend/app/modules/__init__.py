"""Feature modules M1–M11, one package per module (NFR-5.1).

Each module package may contain:
    models.py   database tables
    schemas.py  request and response shapes
    service.py  business logic
    router.py   API endpoints, exposed as `router`

Modules are discovered automatically: adding a module never requires editing a
shared file, so team members can work on different modules without conflicts.
"""

import importlib
import pkgutil
from collections.abc import Iterator
from types import ModuleType

from fastapi import APIRouter


def _submodules(name: str) -> Iterator[ModuleType]:
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda i: i.name):
        if not info.ispkg:
            continue
        full_name = f"{__name__}.{info.name}.{name}"
        try:
            yield importlib.import_module(full_name)
        except ModuleNotFoundError as exc:
            if exc.name != full_name:
                raise


def load_models() -> None:
    """Import every module's models.py so that their tables are registered."""
    for _ in _submodules("models"):
        pass


def routers() -> list[APIRouter]:
    """The `router` of every module that has a router.py."""
    return [module.router for module in _submodules("router")]
