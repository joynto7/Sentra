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


def email_change(name: str, new_email: str, token: str) -> tuple[str, str]:
    link = f"{get_settings().web_url}/confirm-email?token={token}"
    return (
        "Confirm your new e-mail address for Sentra",
        f"Hello {name},\n\n"
        f"Confirm that {new_email} is the new e-mail address of your Sentra account:\n{link}\n\n"
        "The link works once and is valid for 24 hours. Until then your old address stays in use.\n"
        "If you did not ask for this, you can ignore this e-mail.\n",
    )


def email_changed(name: str, new_email: str) -> tuple[str, str]:
    return (
        "Your Sentra e-mail address was changed",
        f"Hello {name},\n\n"
        f"The e-mail address of your Sentra account is now {new_email}.\n"
        "If you did not do this, contact your organization administrator immediately.\n",
    )


def password_changed_in_profile(name: str) -> tuple[str, str]:
    return (
        "Your Sentra password was changed",
        f"Hello {name},\n\n"
        "The password of your Sentra account was just changed in your profile, and your other "
        "sessions were logged out.\n"
        "If you did not do this, reset your password immediately and contact your "
        "organization administrator.\n",
    )


# ---------------------------------------------------------------- two-step verification (FR-1.2)

NOT_YOU = (
    "If you did not do this, reset your password immediately and contact your "
    "organization administrator.\n"
)


def mfa_enabled(name: str) -> tuple[str, str]:
    return (
        "Two-step verification is on for your Sentra account",
        f"Hello {name},\n\n"
        "Two-step verification was just turned on for your Sentra account. From now on, every "
        "login asks for a code from your authenticator app.\n\n"
        "Keep your recovery codes somewhere safe: each one lets you log in once without your "
        "phone.\n" + NOT_YOU,
    )


def recovery_code_used(name: str, left: int) -> tuple[str, str]:
    link = f"{get_settings().web_url}/account/security"
    codes = "1 recovery code is" if left == 1 else f"{left} recovery codes are"
    return (
        "A recovery code was used to log in to Sentra",
        f"Hello {name},\n\n"
        "A recovery code was just used to log in to your Sentra account, so it no longer works. "
        f"{codes} left. You can generate new ones here:\n{link}\n\n" + NOT_YOU,
    )


def recovery_codes_renewed(name: str) -> tuple[str, str]:
    return (
        "New Sentra recovery codes were generated",
        f"Hello {name},\n\n"
        "New recovery codes were just generated for your Sentra account. The old codes no longer "
        "work.\n" + NOT_YOU,
    )


def mfa_required(name: str, organization: str) -> tuple[str, str]:
    link = f"{get_settings().web_url}/account/security"
    return (
        f"{organization} requires two-step verification",
        f"Hello {name},\n\n"
        f"{organization} now requires two-step verification for every member on Sentra. You'll "
        "be asked to set it up at your next login, or you can do it now:\n"
        f"{link}\n\n"
        "You need an authenticator app on your phone that supports time-based codes (TOTP).\n",
    )
