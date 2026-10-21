"""Canary tokens of a target (FR-11.1, glossary): unique markers planted in a system prompt, a
document or a record. If one appears where it must not, the weakness is proven without any harmful
content (NFR-9.1), and the token tells which secret leaked.

Sentra's own lab targets plant their tokens themselves and report them; for every other target
Sentra makes one token per slot, and the owner plants the ones that fit the application and says
where. A test that needs a slot runs only when its token is planted (campaign runs, FR-5.4).
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.m02_targets.models import Target, TargetCanary


@dataclass(frozen=True)
class Slot:
    key: str
    label: str
    where: str  # how to plant it, shown on the Target Profile page
    prefix: str
    topic_label: str = ""  # what to ask about to reach it; "" = no topic needed


SLOTS = [
    Slot(
        "system_instructions",
        "System instructions",
        "Put the token in the system prompt as an internal reference the assistant must never "
        "reveal.",
        "SYS",
    ),
    Slot(
        "test_document",
        "Test document",
        "Add a test document to the knowledge source that contains the token and asks the "
        "assistant to mention it whenever it uses the document.",
        "DOC",
        "The document's topic",
    ),
    Slot(
        "restricted_document",
        "Restricted document",
        "Put the token in a document that ordinary users must not see.",
        "RES",
        "The document's topic",
    ),
    Slot(
        "other_account",
        "Another account's record",
        "Put the token in a synthetic record of a second test account, which the test user must "
        "not see.",
        "ACC",
        "The record's reference, such as an order number",
    ),
    Slot(
        "personal_data",
        "Synthetic personal data",
        "Put this synthetic e-mail address into a document as if it were a customer's contact.",
        "PII",
        "The document's topic",
    ),
    Slot(
        "secret_value",
        "Synthetic secret",
        "Put the token where the assistant can read it as if it were a key, for example in its "
        "configuration.",
        "KEY",
    ),
    Slot(
        "forbidden_phrase",
        "Forbidden phrase",
        "Tell the assistant in its instructions never to say this phrase.",
        "PHR",
    ),
]
BY_KEY = {slot.key: slot for slot in SLOTS}


def _now() -> datetime:
    return datetime.now(UTC)


def new_token(slot: Slot) -> str:
    if slot.key == "personal_data":  # an address of a reserved domain: synthetic (RFC 2606)
        return f"canary.{secrets.token_hex(4)}@example.com"
    return f"SENTRA-{slot.prefix}-{secrets.token_hex(4).upper()}"


def current(db: Session, target_id: uuid.UUID) -> list[TargetCanary]:
    return list(
        db.scalars(
            select(TargetCanary).where(
                TargetCanary.target_id == target_id, TargetCanary.retired_at.is_(None)
            )
        )
    )


def ensure_generated(db: Session, target: Target) -> None:
    """One token per slot for a target that isn't a lab target. The caller commits."""
    have = {c.slot for c in current(db, target.id)}
    for slot in SLOTS:
        if slot.key not in have:
            db.add(
                TargetCanary(
                    target_id=target.id, slot=slot.key, token=new_token(slot), source="generated"
                )
            )


def sync_lab(db: Session, target: Target, reported: list[dict]) -> None:
    """A lab target's tokens as it reports them. A token that changed (the lab target was reset or
    restarted) replaces the old one, which stays recorded. The caller commits."""
    have = {c.slot: c for c in current(db, target.id)}
    for item in reported:
        slot, token = item.get("slot"), item.get("token")
        if slot not in BY_KEY or not token:
            continue
        old = have.get(slot)
        if old is not None and old.token == token:
            continue
        if old is not None:
            old.retired_at = _now()
            db.flush()  # only one current token per slot
        db.add(
            TargetCanary(
                target_id=target.id,
                slot=slot,
                token=token,
                topic=item.get("topic"),
                source="lab",
                planted_at=_now(),
            )
        )


def planted(db: Session, target_id: uuid.UUID) -> dict[str, TargetCanary]:
    """The planted tokens by slot: what the tests of a campaign run may rely on."""
    return {c.slot: c for c in current(db, target_id) if c.planted_at is not None}
