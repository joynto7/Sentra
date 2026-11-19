import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

# Messages "sent" while EMAIL_BACKEND=memory (the tests read them from here).
outbox: list[EmailMessage] = []


def send_email(to: str, subject: str, body: str) -> None:
    """Send a plain-text e-mail. In development, Mailpit catches it: http://localhost:8025"""
    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    if settings.email_backend == "memory":
        outbox.append(message)
        return
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        smtp.send_message(message)
