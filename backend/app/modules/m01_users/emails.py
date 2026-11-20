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


def role_changed(name: str, organization: str, role: str) -> tuple[str, str]:
    return (
        f"Your role in {organization} has changed",
        f"Hello {name},\n\n"
        f"Your role in {organization} on Sentra is now: {role}.\n"
        "It applies from your next action in Sentra.\n\n"
        "If you have questions, contact your organization administrator.\n",
    )


def invitation(organization: str, inviter: str, role: str, token: str) -> tuple[str, str]:
    link = f"{get_settings().web_url}/invitations/accept?token={token}"
    article = "an" if role[0] in "AEIOU" else "a"
    return (
        f"{inviter} invited you to {organization} on Sentra",
        f"Hello,\n\n"
        f"{inviter} invited you to join {organization} on Sentra as {article} {role}.\n\n"
        f"Accept the invitation here:\n{link}\n\n"
        "The link works once, only for this e-mail address, and expires in 7 days.\n"
        "If you did not expect this invitation, you can ignore this e-mail.\n",
    )


def invitation_answered(
    name: str, email: str, organization: str, accepted: bool
) -> tuple[str, str]:
    answer = "accepted" if accepted else "declined"
    return (
        f"{email} {answer} your invitation to {organization}",
        f"Hello {name},\n\n{email} {answer} your invitation to join {organization} on Sentra.\n",
    )


def removed_from(name: str, organization: str) -> tuple[str, str]:
    return (
        f"You were removed from {organization}",
        f"Hello {name},\n\n"
        f"An administrator removed you from {organization} on Sentra, so you can no longer open "
        "its data. If you think this is a mistake, contact the organization's administrator.\n",
    )
