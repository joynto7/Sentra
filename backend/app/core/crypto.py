"""Encryption of stored secrets, such as target credentials (FR-2.2, NFR-3.1).

AES-256-GCM: a 256-bit key, a new random 96-bit nonce for every value, and an authentication tag,
so a value that was changed in the database fails to decrypt instead of giving wrong text.

The key comes from the CREDENTIALS_KEY setting and is never stored in the database. Each value is
bound to a `context`, for example "target-credential:<target id>:<header name>", so an encrypted
value that is copied to another row cannot be decrypted there.

Stored format: "v1:" + base64(nonce + ciphertext with tag). The version allows a new key later.
"""

import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

VERSION = "v1:"
NONCE_BYTES = 12


class CryptoError(Exception):
    """The key is missing or invalid, or a stored value cannot be decrypted."""


def _cipher() -> AESGCM:
    raw = get_settings().credentials_key
    if not raw:
        raise CryptoError("CREDENTIALS_KEY is not set.")
    try:
        key = base64.b64decode(raw, validate=True)
    except binascii.Error as exc:
        raise CryptoError("CREDENTIALS_KEY must be base64.") from exc
    if len(key) != 32:
        raise CryptoError("CREDENTIALS_KEY must be 32 bytes long (AES-256).")
    return AESGCM(key)


def encrypt(plaintext: str, context: str) -> str:
    nonce = os.urandom(NONCE_BYTES)
    sealed = _cipher().encrypt(nonce, plaintext.encode(), context.encode())
    return VERSION + base64.b64encode(nonce + sealed).decode()


def decrypt(token: str, context: str) -> str:
    """Only the Target Connector decrypts credentials, at the moment it calls a target (FR-2.2)."""
    if not token.startswith(VERSION):
        raise CryptoError("Unknown encryption format.")
    try:
        data = base64.b64decode(token[len(VERSION) :], validate=True)
        plain = _cipher().decrypt(data[:NONCE_BYTES], data[NONCE_BYTES:], context.encode())
    except (binascii.Error, InvalidTag, ValueError) as exc:
        raise CryptoError("The value cannot be decrypted.") from exc
    return plain.decode()
