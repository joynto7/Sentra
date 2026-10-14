"""Texts of the e-mails sent by M1. Links point to the web application."""

from app.core.config import get_settings


def verification(name: str, token: str) -> tuple[str, str]:
    link = f"{get_settings().web_url}/verify-email?token={token}"
    return (
        "Confirm your e-mail address for Sentra",
        f"Hello {name},\n\n"
        f"Confirm your e-mail address to activate your Sentra account:\n{link}\n\n"
        "The link works once and is valid for 24 hours.\n"
        "If you did not create an account, you can ignore this e-mail.\n",
    )


def already_registered(name: str) -> tuple[str, str]:
    link = f"{get_settings().web_url}/forgot-password"
    return (
        "Someone tried to create a Sentra account with your e-mail address",
        f"Hello {name},\n\n"
        "Someone tried to create a new Sentra account with this e-mail address, but you "
        "already have one. If this was you, log in, or reset your password here:\n"
        f"{link}\n\n"
        "If it was not you, no action is needed.\n",
    )


def password_reset(name: str, token: str) -> tuple[str, str]:
    link = f"{get_settings().web_url}/reset-password?token={token}"
    return (
        "Reset your Sentra password",
        f"Hello {name},\n\n"
        f"Choose a new password here:\n{link}\n\n"
        "The link works once and expires in 30 minutes.\n"
        "If you did not ask for a reset, you can ignore this e-mail;\n"
        "your password stays the same.\n",
    )


def password_changed(name: str) -> tuple[str, str]:
    return (
        "Your Sentra password was changed",
        f"Hello {name},\n\n"
        "The password of your Sentra account was just changed, and all sessions were logged out.\n"
        "If you did not do this, reset your password immediately and contact your "
        "organization administrator.\n",
    )
