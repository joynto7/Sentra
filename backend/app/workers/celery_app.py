from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "sentra",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)
celery_app.conf.update(
    timezone="UTC",
    # A job whose worker stops before finishing goes back to the queue (NFR-2.2).
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
)
