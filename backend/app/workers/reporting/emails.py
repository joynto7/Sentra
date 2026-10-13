"""Notification e-mails (FR-9.3), sent by a worker so that a failed delivery is tried again."""

import smtplib

from app.core.email import send_email
from app.workers.celery_app import celery_app


@celery_app.task(
    name="notifications.send_email",
    # UC-9.3, 3a and NFR-2.3: a failed delivery is retried after about 1, 2, 4, 8, … seconds
    # (with a random part, so many workers don't retry at the same moment), at most 6 times.
    autoretry_for=(OSError, smtplib.SMTPException),
    retry_backoff=True,
    retry_backoff_max=600,
    max_retries=6,
)
def send_notification_email(to: str, subject: str, body: str) -> None:
    send_email(to, subject, body)
