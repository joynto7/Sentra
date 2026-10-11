import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core import models  # noqa: F401
from app.core.config import get_settings
from app.core.database import Base, get_db
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


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
