"""Time-based one-time passwords (TOTP, RFC 6238): the 6-digit codes of authenticator apps
(FR-1.2).

Sentra and the app share a random secret once, through a QR code (UC-1.4 step 3). Afterwards both
compute the code on their own: HMAC-SHA1 of the secret and the number of 30-second steps since
1970, shortened to 6 digits (RFC 4226). So the code changes every 30 seconds, and the phone needs
no network connection.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote, urlencode

import segno

ISSUER = "Sentra"  # the name the app shows next to the codes
DIGITS = 6
PERIOD = 30  # seconds
# A phone's clock may be a little off, so the codes of the step before and after count too.
DRIFT_STEPS = 1


def new_secret() -> str:
    """20 random bytes (160 bits, as RFC 4226 recommends) in base32: 32 letters and digits."""
    return base64.b32encode(secrets.token_bytes(20)).decode()


def current_step(at: float | None = None) -> int:
    """The number of 30-second steps since 1 January 1970 (T in RFC 6238)."""
    return int((time.time() if at is None else at) // PERIOD)


def code_for(secret: str, step: int) -> str:
    """The code of one time step: HOTP (RFC 4226) with the step as the counter."""
    digest = hmac.new(base64.b32decode(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F  # "dynamic truncation": 4 bytes from a place the digest chooses
    number = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(number % 10**DIGITS).zfill(DIGITS)


def matching_step(
    secret: str, code: str, used_up_to: int | None = None, at: float | None = None
) -> int | None:
    """The time step whose code was entered, or None if the code is wrong or expired.

    Steps up to `used_up_to` have been used already and are refused, so a code that was seen once
    can't be used again (RFC 6238, section 5.2).
    """
    code = "".join(code.split())
    if len(code) != DIGITS or not code.isdigit():
        return None
    now = current_step(at)
    for step in range(now - DRIFT_STEPS, now + DRIFT_STEPS + 1):
        if used_up_to is not None and step <= used_up_to:
            continue
        if hmac.compare_digest(code_for(secret, step), code):
            return step
    return None


def setup_uri(secret: str, account: str) -> str:
    """The otpauth:// address inside the QR code, in the key URI format that authenticator apps
    read: the issuer and the account name label the codes in the app."""
    label = quote(f"{ISSUER}:{account}")
    query = urlencode(
        {
            "secret": secret,
            "issuer": ISSUER,
            "algorithm": "SHA1",
            "digits": DIGITS,
            "period": PERIOD,
        }
    )
    return f"otpauth://totp/{label}?{query}"


def qr_code(uri: str) -> str:
    """The QR code as an SVG data URI for an <img>: black on white, with the quiet zone around it
    that scanners need, also in dark mode."""
    return segno.make(uri, error="m", micro=False).svg_data_uri(
        scale=5, border=4, dark="#000", light="#fff"
    )
