from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "sentra",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "app.workers.tasks",
        "app.workers.reporting.emails",
        "app.workers.targets",
        "app.workers.campaigns",
        "app.workers.detection.judge",
        "app.workers.threat_models",
        "app.workers.remediation",
    ],
)
celery_app.conf.update(
    timezone="UTC",
    # The LLM judge's evaluations (FR-6.1) wait on a model, so they have their own queue and
    # worker (compose.yaml, analysis-worker) and never hold up the attempts of a run (NFR-1.4).
    task_routes={"detection.*": {"queue": "analysis"}},
    # A job whose worker stops before finishing goes back to the queue (NFR-2.2).
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    # A job that no worker finished is handed out again after this many seconds. A campaign run
    # waits at most lifecycle.MAX_COUNTDOWN_SECONDS for its next job, well below it.
    broker_transport_options={"visibility_timeout": 3600},
)
