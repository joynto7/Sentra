import logging

from app.core.database import SessionLocal
from app.modules.m04_tests.library import sync_built_in_library

# Logged through uvicorn's logger, so the line appears in `docker compose logs api`.
log = logging.getLogger("uvicorn.error")


def on_startup() -> None:
    """Bring the built-in test library in the database up to date with library/*.yaml."""
    with SessionLocal() as db:
        result = sync_built_in_library(db)
    log.info(
        "Test library: %d added, %d updated, %d unchanged",
        result.added,
        result.updated,
        result.unchanged,
    )
