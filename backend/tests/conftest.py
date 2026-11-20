import os
import tempfile
from collections.abc import Iterator

# Test settings, set before the app reads its configuration.
os.environ.setdefault("EMAIL_BACKEND", "memory")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("RUN_STARTUP_HOOKS", "false")
# A fixed AES-256 key for the tests only (FR-2.2). Real deployments set their own.
os.environ.setdefault("CREDENTIALS_KEY", "c2VudHJhLXRlc3RzLW9ubHktbm90LWEtcmVhbC1rZXk=")
# Background jobs run at once, inside the request, instead of on a worker.
os.environ.setdefault("RUN_JOBS_INLINE", "true")
# The live events of campaign runs stay in this process: the tests have no Redis.
os.environ.setdefault("LIVE_EVENTS_BACKEND", "memory")
# The object storage of the tests is a new empty directory, never the volume of compose.yaml.
os.environ.setdefault("OBJECT_STORAGE_DIR", tempfile.mkdtemp(prefix="sentra-objects-"))

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core import models  # noqa: F401
from app.core.config import get_settings
from app.core.database import Base, get_db
from app.core.email import outbox
from app.main import app
from app.modules import load_models

# Tests use a separate database, so they never touch development data.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", get_settings().database_url.rsplit("/", 1)[0] + "/sentra_test"
)


@pytest.fixture(scope="session")
def engine():
    load_models()
    engine = create_engine(TEST_DATABASE_URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def db(engine) -> Iterator[Session]:
    """A session whose changes are rolled back after each test."""
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


def greeting(request: httpx.Request) -> httpx.Response:
    """How every target answers in the tests, unless a test says otherwise."""
    if request.method == "GET":
        return httpx.Response(404)
    return httpx.Response(
        200, json={"choices": [{"message": {"content": "Hello! How can I help you today?"}}]}
    )


@pytest.fixture(autouse=True)
def _no_network(monkeypatch) -> None:
    """No request to a target ever leaves the tests: the Target Connector's network is replaced."""
    from app.workers.connector import connector

    monkeypatch.setattr(connector, "TRANSPORT", httpx.MockTransport(greeting))


@pytest.fixture(autouse=True)
def _clear_outbox() -> Iterator[None]:
    outbox.clear()
    yield
    outbox.clear()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def logged_in_client(client: TestClient, db: Session) -> TestClient:
    """A client with an active user that is logged in (for endpoints that need a session)."""
    from datetime import UTC, datetime

    from app.modules.m01_users.models import User, UserStatus
    from app.modules.m01_users.security import hash_password

    db.add(
        User(
            email="test.user@example.com",
            name="Test User",
            password_hash=hash_password("Copper-Kettle-Morning-42"),
            status=UserStatus.ACTIVE,
            terms_accepted_at=datetime.now(UTC),
        )
    )
    db.flush()
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "test.user@example.com", "password": "Copper-Kettle-Morning-42"},
    )
    assert response.status_code == 200
    return client
