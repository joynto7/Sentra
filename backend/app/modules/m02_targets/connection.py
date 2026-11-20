"""The connection test (FR-2.4, UC-2.2): one harmless request through the Target Connector, to
confirm that the endpoint, the request format and the credentials are right, with a clear message
when something is wrong. It runs on a worker; the page follows its result.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.crypto import CryptoError
from app.core.errors import ConflictError, NotFoundError
from app.llm.masking import mask
from app.modules.m02_targets.models import CheckStatus, ConnectionTest, Target, TargetStatus
from app.workers import jobs

EXCERPT = 500  # characters of a reply that are kept, as plain text
# A test that is still running is reused instead of sending a second request (FR-5.7)
STILL_RUNNING = timedelta(seconds=60)


def _now() -> datetime:
    return datetime.now(UTC)


def start(db: Session, target: Target, requested_by: uuid.UUID | None) -> ConnectionTest:
    """UC-2.2 step 1, or Sentra after a registration (UC-2.1 step 7)."""
    if target.status == TargetStatus.ARCHIVED:
        raise ConflictError("This target is archived. Restore it before testing it.")
    running = latest(db, target.id)
    if (
        running is not None
        and running.status == CheckStatus.RUNNING
        and running.created_at > _now() - STILL_RUNNING
    ):
        return running
    test = ConnectionTest(target_id=target.id, requested_by_id=requested_by)
    db.add(test)
    db.commit()
    if not jobs.start(db, "targets.connection_test", test.id):
        _fail(test, "queue", jobs.QUEUE_DOWN)
        test.finished_at = _now()
        db.commit()
    db.refresh(test)
    return test


def get(db: Session, target: Target, test_id: uuid.UUID) -> ConnectionTest:
    test = db.scalar(
        select(ConnectionTest).where(
            ConnectionTest.id == test_id, ConnectionTest.target_id == target.id
        )
    )
    if test is None:
        raise NotFoundError("Connection test not found.")
    return test


def latest(db: Session, target_id: uuid.UUID) -> ConnectionTest | None:
    return db.scalar(
        select(ConnectionTest)
        .where(ConnectionTest.target_id == target_id)
        .order_by(ConnectionTest.created_at.desc(), ConnectionTest.id)
        .limit(1)
    )


def recent(db: Session, target_id: uuid.UUID, limit: int = 5) -> list[ConnectionTest]:
    """The latest tests, newest first: the result and the response time recorded with the
    target (UC-2.2 step 5)."""
    return list(
        db.scalars(
            select(ConnectionTest)
            .where(ConnectionTest.target_id == target_id)
            .order_by(ConnectionTest.created_at.desc(), ConnectionTest.id)
            .limit(limit)
        )
    )


def latest_of(db: Session, target_ids: list[uuid.UUID]) -> dict[uuid.UUID, ConnectionTest]:
    """The newest test of each target, for the target lists."""
    if not target_ids:
        return {}
    newest = (
        select(ConnectionTest.target_id, func.max(ConnectionTest.created_at).label("at"))
        .where(ConnectionTest.target_id.in_(target_ids))
        .group_by(ConnectionTest.target_id)
        .subquery()
    )
    rows = db.scalars(
        select(ConnectionTest).join(
            newest,
            (ConnectionTest.target_id == newest.c.target_id)
            & (ConnectionTest.created_at == newest.c.at),
        )
    )
    return {test.target_id: test for test in rows}


def run(db: Session, test_id: uuid.UUID) -> None:
    """In the worker: steps 2-5 and the alternatives 3a, 3b and 4a."""
    from app.workers.connector import connector
    from app.workers.connector.errors import (
        AddressRefused,
        BadResponse,
        ConnectorError,
        TargetHTTPError,
        TargetOverloaded,
        TargetRedirect,
        TargetTimeout,
        TargetUnreachable,
    )

    test = db.get(ConnectionTest, test_id)
    if test is None or test.status != CheckStatus.RUNNING:
        return
    target = db.get_one(Target, test.target_id)
    try:
        reply = connector.check_connection(db, target)
    except TargetHTTPError as exc:
        if exc.status_code in (401, 403):  # 3b
            _fail(
                test,
                "authentication",
                f"Authentication failed (HTTP {exc.status_code}). Check the credentials, or "
                "replace them.",
            )
        else:
            _fail(test, "http", f"{exc} Check the endpoint URL and the request format.")
    except (TargetTimeout, TargetUnreachable) as exc:  # 3a
        _fail(test, "network", f"{exc} Check the endpoint URL.")
    except BadResponse as exc:  # 4a
        _fail(test, "format", f"{exc} Adjust the response format to match the answer.")
        test.unreadable_excerpt = mask(exc.excerpt).text[:EXCERPT] if exc.excerpt else None
    except AddressRefused as exc:
        _fail(test, "address", str(exc))
    except TargetOverloaded as exc:
        _fail(test, "overloaded", f"{exc} Try again later.")
    except TargetRedirect as exc:
        _fail(test, "redirect", str(exc))
    except ConnectorError as exc:
        _fail(test, "error", str(exc))
    except CryptoError:
        _fail(test, "credentials", "The stored credentials can't be read. Enter them again.")
    else:  # step 5
        test.status = CheckStatus.PASSED
        test.status_code, test.duration_ms = reply.status_code, reply.duration_ms
        test.reply_path = reply.reply_path
        # Content from the target is only data, shown as plain text (NFR-3.6), and masked.
        test.reply_excerpt = mask(reply.text).text[:EXCERPT]
    test.finished_at = _now()
    db.commit()


def _fail(test: ConnectionTest, kind: str, message: str) -> None:
    test.status, test.error_kind, test.error_message = CheckStatus.FAILED, kind, message
