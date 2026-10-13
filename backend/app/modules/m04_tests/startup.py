import logging

from app.core.database import SessionLocal
from app.modules.m04_tests.library import sync_built_in_library
from app.modules.m04_tests.suites import sync_built_in_suites

# Logged through uvicorn's logger, so the line appears in `docker compose logs api`.
log = logging.getLogger("uvicorn.error")


def on_startup() -> None:
    """Bring the built-in tests and suites in the database up to date with library/."""
    with SessionLocal() as db:
        result = sync_built_in_library(db)
        suite_result = sync_built_in_suites(db)
    log.info(
        "Test library: %d added, %d updated, %d unchanged",
        result.added,
        result.updated,
        result.unchanged,
    )
    log.info(
        "Test suites: %d added, %d updated, %d unchanged",
        suite_result.added,
        suite_result.updated,
        suite_result.unchanged,
    )
