from app.workers.celery_app import celery_app


@celery_app.task(name="system.ping")
def ping() -> str:
    """Smallest possible job, used to check that the queue and a worker are running."""
    return "pong"
