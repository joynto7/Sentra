from app.workers.celery_app import celery_app
from app.workers.tasks import ping


def test_ping_task_runs():
    assert ping.apply().get() == "pong"


def test_lost_jobs_are_requeued():
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True


def test_every_job_module_is_registered_with_the_worker():
    """A @job that is not in the Celery app's `include` list is never registered, so the API can
    place it on the queue but no worker ever runs it — and with RUN_JOBS_INLINE it is not even
    found. One assertion, so a new jobs file cannot be forgotten."""
    from pathlib import Path

    from app.workers.celery_app import celery_app

    folder = Path(__file__).resolve().parents[1] / "app" / "workers"
    modules = set()
    for path in folder.rglob("*.py"):
        if path.name in ("__init__.py", "jobs.py", "celery_app.py", "extensions.py"):
            continue
        if "@job(" in path.read_text(encoding="utf-8"):
            modules.add(
                "app.workers." + str(path.relative_to(folder).with_suffix("")).replace("/", ".")
            )

    assert modules <= set(celery_app.conf.include), (
        f"not registered: {sorted(modules - set(celery_app.conf.include))}"
    )
