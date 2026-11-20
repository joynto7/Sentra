import socket

import pytest
from fastapi.testclient import TestClient

from app.core import addresses
from app.modules.m01_users.models import Role
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import organization_with

# The tests have no internet, so host names are looked up in this table instead of DNS.
FAKE_DNS = {
    "support-assistant.halcyonbank.com": ["93.184.215.14"],
    "payments-agent.staging.halcyonbank.com": ["93.184.215.15"],
    "loan-policy.staging.halcyonbank.com": ["93.184.215.16"],
    "intranet.halcyonbank.com": ["10.20.0.5"],
    "metadata.google.internal": ["169.254.169.254"],
    "mixed.halcyonbank.com": ["93.184.215.17", "192.168.1.10"],
}


def fake_resolve(host: str, port: int) -> list[str]:
    if host in FAKE_DNS:
        return FAKE_DNS[host]
    raise socket.gaierror(f"{host} not found")


@pytest.fixture(autouse=True)
def _fake_dns(monkeypatch):
    monkeypatch.setattr(addresses, "resolve", fake_resolve)


@pytest.fixture(autouse=True)
def _no_waiting(monkeypatch):
    """The waits between requests to a target (its rate, FR-5.7) are skipped in these tests."""
    from app.workers.connector import connector

    monkeypatch.setattr(connector.time, "sleep", lambda seconds: None)


@pytest.fixture
def developer(client: TestClient, db) -> TestClient:
    """Maya Chen, an AI Application Developer of Halcyon Bank (whose administrator is Tom),
    and Priya, a Security Analyst. Maya is logged in."""
    organization_with(
        db,
        client,
        {"maya@example.com": Role.TARGET_OWNER, "priya@example.com": Role.SECURITY_ANALYST},
    )
    log_in(client, "maya@example.com")
    return client
