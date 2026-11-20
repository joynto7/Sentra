"""Background jobs (architecture 2.5.4): the API places a job in the Task Queue and answers at
once; a Background Worker runs it with its own database session. Asynchronous operations return
the identifier of what they started, whose status the page then follows (API design, 2.5.7).

A job is a function `fn(db, *ids)`. @job registers it under a name and makes it a Celery task.
start() places it in the queue, or, with RUN_JOBS_INLINE (the tests), runs it at once in the
caller's session. Commit the row the job works on before starting it, so the worker finds it.
"""

import importlib
import logging
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.workers.celery_app import celery_app

logger = logging.getLogger("uvicorn.error")
REGISTRY: dict[str, Callable] = {}
QUEUE_DOWN = (
    "Sentra's background workers can't be reached right now, so this couldn't start. "
    "Try again in a minute."
)


def job(name: str, **options):
    def register(fn: Callable) -> Callable:
        REGISTRY[name] = fn

        @celery_app.task(name=name, **options)
        def task(*args: str) -> None:
            from app.modules import load_models

            load_models()  # every table, so the relationships between modules resolve
            with SessionLocal() as db:
                fn(db, *args)

        fn.task = task
        return fn

    return register


def start(db: Session, name: str, *args, countdown: float | None = None) -> bool:
    """Starts a job; IDs are passed as text, as they travel through the queue. Returns False when
    the queue can't be reached, and the caller then marks its row as failed with QUEUE_DOWN."""
    texts = [str(arg) for arg in args]
    if get_settings().run_jobs_inline:
        for module in celery_app.conf.include:  # registers every job
            importlib.import_module(module)
        REGISTRY[name](db, *texts)
        return True
    try:
        celery_app.send_task(name, args=texts, countdown=countdown)
    except Exception:  # e.g. Redis is down: kombu's OperationalError
        logger.exception("Couldn't queue the job %s", name)
        return False
    return True
