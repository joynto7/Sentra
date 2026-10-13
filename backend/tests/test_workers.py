from app.workers.celery_app import celery_app
from app.workers.tasks import ping


def test_ping_task_runs():
    assert ping.apply().get() == "pong"


def test_lost_jobs_are_requeued():
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
