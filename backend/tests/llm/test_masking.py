"""Tests of the masking of secrets and personal data (NFR-9.6, NFR-8.2)."""

import pytest

from app.llm.masking import mask


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            "Contact arif.hossain@halcyonbank.com or +880 1712 345678.",
            "Contact [EMAIL_1] or [PHONE_1].",
        ),
        ("api_key=sk-ant-abcdefghijklmnopqrstuvwxyz123456", "api_key=[SECRET_1]"),
        ("password: hunter22", "password: [SECRET_1]"),
        (
            "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123",
            "Authorization: Bearer [SECRET_1]",
        ),
        ("AWS AKIAIOSFODNN7EXAMPLE", "AWS [SECRET_1]"),
        ("token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "token [SECRET_1]"),
        (
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
            "[SECRET_1]",
        ),
        ("Card 4111 1111 1111 1111", "Card [CARD_1]"),
        ("IBAN DE89 3704 0044 0532 0130 00", "IBAN [IBAN_1]"),
        ("SSN 078-05-1120", "SSN [ID_NUMBER_1]"),
        ("from 203.0.113.7 and 10.0.0.5", "from [IP_1] and [IP_2]"),
        ("call (02) 9876 5432 or +8801712345678", "call [PHONE_1] or [PHONE_2]"),
    ],
)
def test_secrets_and_personal_data_are_replaced(text, expected):
    assert mask(text).text == expected


def test_the_same_value_gets_the_same_placeholder():
    result = mask("From a@example.com to b@example.com, then a@example.com again")

    assert result.text == "From [EMAIL_1] to [EMAIL_2], then [EMAIL_1] again"
    assert result.counts == {"EMAIL": 2}


def test_ordinary_numbers_stay():
    text = (
        "Released 2026-10-13 (13.10.2026), version 1.105.0, 3 of 10 tests passed, order 12345, "
        "card-like 1234 5678 9012 3456 fails the Luhn check, local 127.0.0.1."
    )

    assert mask(text).text == text
