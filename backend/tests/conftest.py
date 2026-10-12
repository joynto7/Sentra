import os
from collections.abc import Iterator

# Test settings, set before the app reads its configuration.
os.environ.setdefault("EMAIL_BACKEND", "memory")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("RUN_STARTUP_HOOKS", "false")

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
