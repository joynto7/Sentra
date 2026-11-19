"""Tests for the encryption of stored secrets (NFR-3.1) and the address check (NFR-3.4)."""

import base64

import pytest

from app.core import crypto
from app.core.addresses import is_public
from app.core.config import get_settings


def test_a_secret_is_encrypted_and_decrypted_with_its_context():
    sealed = crypto.encrypt("sk-live-secret", "target-credential:1:x-api-key")

    assert sealed.startswith("v1:") and "sk-live-secret" not in sealed
    assert crypto.decrypt(sealed, "target-credential:1:x-api-key") == "sk-live-secret"
    # The same text encrypts differently every time (a new random nonce).
    assert crypto.encrypt("sk-live-secret", "c") != crypto.encrypt("sk-live-secret", "c")


def test_a_value_in_the_wrong_place_or_changed_cannot_be_decrypted():
    sealed = crypto.encrypt("sk-live-secret", "target-credential:1:x-api-key")
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt(sealed, "target-credential:2:x-api-key")
    raw = bytearray(base64.b64decode(sealed[3:]))
    raw[-1] ^= 1  # change one bit
    with pytest.raises(crypto.CryptoError):
        crypto.decrypt(
            "v1:" + base64.b64encode(bytes(raw)).decode(), "target-credential:1:x-api-key"
        )


@pytest.mark.parametrize("key", ["", "not base64!", base64.b64encode(b"too short").decode()])
def test_a_missing_or_wrong_key_is_refused(monkeypatch, key):
    monkeypatch.setattr(get_settings(), "credentials_key", key)
    with pytest.raises(crypto.CryptoError):
        crypto.encrypt("x", "c")


@pytest.mark.parametrize(
    ("address", "public"),
    [
        ("93.184.215.14", True),
        ("2606:4700:4700::1111", True),
        ("10.1.2.3", False),  # private network
        ("192.168.1.10", False),
        ("127.0.0.1", False),  # this machine
        ("169.254.169.254", False),  # cloud metadata service
        ("100.64.0.1", False),  # shared address space
        ("::1", False),
        ("fd00:ec2::254", False),  # cloud metadata service over IPv6
        ("::ffff:10.0.0.1", False),  # a private IPv4 address written as IPv6
        ("224.0.0.1", False),  # multicast
    ],
)
def test_only_public_internet_addresses_are_public(address, public):
    assert is_public(address) is public
