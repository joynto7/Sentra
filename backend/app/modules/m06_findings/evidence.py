"""The evidence of findings (FR-6.3; UC-6.2 steps 3-4; NFR-2.4, NFR-6.2, NFR-8.2).

Evidence is what proves a finding: the attempt that was sent, the target's reply and tool calls,
and the result of each detection method, each with its time. Sentra
1. masks secrets and personal data in every text of it, with the masking of the LLM layer
   (app.llm.masking; NFR-8.2). The reply and the tool calls were masked already when the attempt
   was stored; masking them again changes nothing;
2. writes it as one JSON document and stores the SHA-256 checksum of the document's bytes;
3. keeps a document of up to 64 KB in the database and a larger one in the object storage
   (app/core/storage.py; NFR-6.2).

Nothing changes stored evidence afterwards: a database trigger refuses every UPDATE and DELETE of
an evidence row, and an object is written once (NFR-2.4). Reading a document computes its
checksum again, so a change made anyway, e.g. directly in the database, shows as "modified".
"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.core import storage
from app.llm.masking import mask
from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import DetectionMethod
from app.modules.m05_campaigns.models import Attempt
from app.modules.m06_findings.models import (
    DetectionResult,
    DetectionVerdict,
    Evidence,
    EvidenceKind,
    Finding,
)

FORMAT = 1  # the version of the document's form
INLINE_MAX_BYTES = 65_536  # a larger document goes to the object storage
UNCHANGED, MODIFIED, MISSING = "unchanged", "modified", "missing"


def _masked(text: str | None) -> str | None:
    return mask(text).text if text else text


def _time(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _tool_calls(stored: str | None):
    """The attempt's tool calls, stored as masked JSON text, as JSON again."""
    if not stored:
        return None
    try:
        return json.loads(_masked(stored))
    except ValueError:
        return _masked(stored)


def _result(result: DetectionResult) -> dict:
    """One detection method's result, masked (UC-6.2 step 3)."""
    found = {
        "method": result.method,
        "role": result.role,
        "outcome": result.outcome,
        "summary": _masked(result.summary),
        "checks": [
            {
                **check,
                "value": _masked(check.get("value")),
                "sentence": _masked(check.get("sentence")),
                "detail": _masked(check.get("detail")),
            }
            for check in result.checks
        ],
        "duration_ms": result.duration_ms,
        "evaluated_at": _time(result.evaluated_at),
    }
    if result.method == DetectionMethod.LLM_JUDGE:
        found |= {
            # Always three decimals, as the database keeps it, so the same answer gives the
            # same document
            "confidence": f"{result.confidence:.3f}" if result.confidence is not None else None,
            "reasoning": _masked(result.reasoning),
            "model": result.judge_model,
            "deployment": result.judge_deployment,
            "instructions_version": result.instructions_version,
            "instructions_sha256": result.instructions_sha256,
            "tries": result.tries,
        }
    return found


def _verdict(decided: DetectionVerdict) -> dict:
    return {
        "outcome": decided.outcome,
        "decided_by": decided.decided_by,
        "requires_confirmation": decided.requires_confirmation,
        "disagreement": decided.disagreement,
        "summary": _masked(decided.summary),
    }


def _test(definition: TestDefinition) -> dict:
    return {"code": definition.code, "version": definition.version, "name": definition.name}


def attempt_document(
    finding: Finding,
    run_code: str,
    attempt: Attempt,
    definition: TestDefinition,
    decided: DetectionVerdict,
    results: list[DetectionResult],
    recorded_at: datetime,
) -> dict:
    """The evidence of one attempt (FR-6.3): what was sent, what came back, how it was judged."""
    reply = attempt.reply or ""
    return {
        "format": FORMAT,
        "kind": EvidenceKind.ATTEMPT,
        "recorded_at": _time(recorded_at),
        "finding": finding.code,
        "campaign_run": run_code,
        "test": _test(definition) | {"success_condition": _masked(definition.success_condition)},
        "attempt": {
            "number": attempt.attempt_no,
            "template": attempt.template,
            "variant": attempt.variant,
            "conversation": attempt.session_id,
            "sent_at": _time(attempt.sent_at),
            "message": _masked(attempt.input),
        },
        "reply": {
            "received_at": _time(attempt.finished_at),
            "status_code": attempt.status_code,
            "duration_ms": attempt.duration_ms,
            "text": _masked(reply),
            "length": attempt.reply_length,
            # The attempt keeps at most 64 KB of a reply (run engine, MAX_REPLY_CHARS)
            "truncated": (attempt.reply_length or 0) > len(reply),
        },
        "tool_calls": _tool_calls(attempt.tool_calls),
        "detection": {
            "verdict": _verdict(decided),
            "results": [_result(result) for result in results],
        },
    }


def judge_document(
    finding: Finding,
    run_code: str,
    attempt: Attempt,
    definition: TestDefinition,
    decided: DetectionVerdict,
    judged: DetectionResult,
    recorded_at: datetime,
) -> dict:
    """The LLM judge's answer to an attempt whose evidence was stored before it came: the judge
    runs as its own job (NFR-1.4), and its answer belongs to the evidence too (FR-6.3)."""
    return {
        "format": FORMAT,
        "kind": EvidenceKind.JUDGE_VERDICT,
        "recorded_at": _time(recorded_at),
        "finding": finding.code,
        "campaign_run": run_code,
        "test": _test(definition),
        "attempt": {"number": attempt.attempt_no},
        "detection": {"verdict": _verdict(decided), "results": [_result(judged)]},
    }


def canonical(document: dict) -> bytes:
    """The document's bytes: the same document always gives the same bytes, and so the same
    checksum."""
    text = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return text.encode()


def store(
    db: Session,
    finding: Finding,
    attempt: Attempt,
    kind: EvidenceKind,
    document: dict,
    recorded_at: datetime,
) -> Evidence:
    """UC-6.2 step 4: the document, once, with its checksum, as the finding's next evidence.
    `finding` is locked, so its evidence is numbered without gaps. The caller commits."""
    data = canonical(document)
    finding.evidence_count += 1
    row = Evidence(
        id=uuid.uuid4(),
        organization_id=finding.organization_id,
        finding_id=finding.id,
        evidence_no=finding.evidence_count,
        kind=kind,
        attempt_id=attempt.id,
        campaign_run_id=attempt.campaign_run_id,
        recorded_at=recorded_at,
        checksum=hashlib.sha256(data).hexdigest(),
        size=len(data),
    )
    if len(data) <= INLINE_MAX_BYTES:
        row.content = data.decode()
    else:
        row.content_ref = f"evidence/{finding.organization_id}/{finding.id}/{row.id}.json"
        storage.put(row.content_ref, data)
    db.add(row)
    return row


@dataclass
class Content:
    document: dict | None  # None when it is missing or can't be read
    integrity: str  # unchanged, modified or missing
    computed: str | None  # the checksum of what is stored now


def read(row: Evidence) -> Content:
    """The stored document, and whether it is still exactly what was recorded (NFR-2.4)."""
    if row.content is not None:
        data = row.content.encode()
    else:
        try:
            data = storage.get(row.content_ref or "")
        except storage.StorageError:
            return Content(None, MISSING, None)
    computed = hashlib.sha256(data).hexdigest()
    try:
        document = json.loads(data)
    except ValueError:
        document = None
    return Content(document, UNCHANGED if computed == row.checksum else MODIFIED, computed)
