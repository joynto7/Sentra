"""Tests for FR-2.1 Target Registration and FR-2.2 Connection Credentials (UC-2.1, UC-2.5)."""

import uuid

import pytest
from sqlalchemy import select

from app.core import crypto
from app.core.config import get_settings
from app.core.models import Organization
from app.modules.m02_targets import service
from app.modules.m02_targets.models import Target, TargetCredential, TargetStatus
from app.modules.m02_targets.schemas import MASK
from tests.m01_users.test_organizations import log_in

SECRET = "sk-test-0123456789abcdef"


def payload(**changes) -> dict:
    body = {
        "name": "Payments Operations Agent",
        "type": "tool_using_agent",
        "endpoint_url": "https://payments-agent.staging.halcyonbank.com/v1/chat",
        "environment": "staging",
        "max_request_rate": 20,
        "credentials": [{"credential_type": "api_key", "name": "X-Api-Key", "value": SECRET}],
    }
    return body | changes


def register(client, **changes):
    return client.post("/api/v1/targets", json=payload(**changes))


def errors(response) -> dict[str, str]:
    assert response.status_code == 422, response.text
    return {d["field"]: d["message"] for d in response.json()["error"]["details"]}


def stored(db, target_id) -> Target:
    """The target as it is in the database now. Change it, then call db.flush() at once."""
    db.expire_all()
    return db.get_one(Target, uuid.UUID(str(target_id)))


# ---------------------------------------------------------------- registration (UC-2.1)


def test_a_developer_registers_a_target_as_unverified(developer):
    response = register(developer)

    assert response.status_code == 201
    body = response.json()
    assert (body["status"], body["endpoint_host"], body["request_format"], body["reply_path"]) == (
        "unverified",
        "payments-agent.staging.halcyonbank.com",
        "openai_chat",
        "$.choices[0].message.content",
    )
    assert body["owner"]["name"] == "Maya"
    assert [(c["name"], c["credential_type"], c["masked_value"]) for c in body["credentials"]] == [
        ("X-Api-Key", "api_key", MASK)
    ]
    assert SECRET not in response.text  # never shown again (FR-2.2)


def test_credentials_are_stored_encrypted_and_bound_to_their_target(developer, db):
    target = stored(db, register(developer).json()["id"])
    credential = target.credentials[0]

    assert credential.encrypted_value.startswith("v1:") and SECRET not in credential.encrypted_value
    assert credential.decrypt() == SECRET
    elsewhere = TargetCredential(target_id=target.id, name="X-Other", credential_type="api_key")
    elsewhere.encrypted_value = credential.encrypted_value  # a value copied to another row
    with pytest.raises(crypto.CryptoError):
        elsewhere.decrypt()


def test_a_target_may_need_no_credentials(developer):
    response = register(developer, credentials=[])
    assert response.status_code == 201
    assert response.json()["credentials"] == []


def test_a_custom_json_format_is_saved_with_its_reply_location(developer):
    response = register(
        developer,
        request_format="custom_json",
        request_template='{"session": "{{session_id}}", "input": "{{message}}"}',
        reply_path="$.output.text",
        tool_calls_path="$.output.tool_calls",
    )

    body = response.json()
    assert (body["request_format"], body["reply_path"], body["tool_calls_path"]) == (
        "custom_json",
        "$.output.text",
        "$.output.tool_calls",
    )


def test_a_custom_format_is_checked(developer):
    response = register(
        developer,
        request_format="custom_json",
        request_template='{"input": "{{prompt}}"}',
        reply_path="output.text",
        tool_calls_path="$..calls",
    )

    assert errors(response) == {
        "request_template": "Unknown placeholder {{prompt}}. Use {{message}} or {{session_id}}.",
        "reply_path": "Use a path such as $.output.text.",
        "tool_calls_path": "Use a path such as $.output.text.",
    }


def test_all_field_errors_are_shown_at_once(developer):
    response = register(developer, name=" ", endpoint_url="payments-agent", max_request_rate=0)

    assert errors(response) == {
        "name": "Enter a name.",
        "endpoint_url": "Enter a URL that starts with https:// or http://.",
        "max_request_rate": "Enter a rate between 1 and 600 requests per minute.",
    }


@pytest.mark.parametrize(
    "url",
    [
        "https://10.0.0.5/chat",
        "http://127.0.0.1:8080/chat",
        "http://[::1]/chat",
        "https://intranet.halcyonbank.com/api/chat",
        "http://metadata.google.internal/computeMetadata/v1/",
        "http://169.254.169.254/latest/meta-data/",
        "https://mixed.halcyonbank.com/chat",
    ],
)
def test_private_and_cloud_metadata_addresses_are_refused(developer, url):
    assert errors(register(developer, endpoint_url=url)) == {
        "endpoint_url": "Private network and cloud metadata addresses can't be used as targets."
    }


@pytest.mark.parametrize(
    ("url", "message"),
    [
        (
            "ftp://payments-agent.staging.halcyonbank.com",
            "Enter a URL that starts with https:// or http://.",
        ),
        (
            "https://unknown.halcyonbank.com/chat",
            "This host can't be found. Check the endpoint URL.",
        ),
        (
            "https://maya:secret@payments-agent.staging.halcyonbank.com/v1/chat",
            "Don't put a user name or password in the URL. Add them as credentials.",
        ),
    ],
)
def test_unusable_urls_are_explained(developer, url, message):
    assert errors(register(developer, endpoint_url=url)) == {"endpoint_url": message}


def test_private_addresses_are_allowed_when_the_deployment_allows_them(developer, monkeypatch):
    monkeypatch.setattr(get_settings(), "allow_private_targets", True)
    assert register(developer, endpoint_url="http://10.0.0.5:8000/chat").status_code == 201


def test_step_one_of_the_wizard_checks_the_endpoint(developer):
    ok = developer.post(
        "/api/v1/targets/check-endpoint",
        json={"endpoint_url": " https://payments-agent.staging.halcyonbank.com/v1/chat "},
    )
    assert ok.json() == {"endpoint_url": "https://payments-agent.staging.halcyonbank.com/v1/chat"}
    refused = developer.post(
        "/api/v1/targets/check-endpoint", json={"endpoint_url": "https://10.0.0.5"}
    )
    assert errors(refused) == {
        "endpoint_url": "Private network and cloud metadata addresses can't be used as targets."
    }


def test_a_bearer_token_is_sent_as_authorization(developer, db):
    response = register(
        developer,
        credentials=[{"credential_type": "bearer_token", "value": "Bearer abc.def.ghi"}],
    )
    credential = stored(db, response.json()["id"]).credentials[0]
    assert (credential.name, credential.decrypt()) == ("Authorization", "abc.def.ghi")


@pytest.mark.parametrize(
    ("credentials", "expected"),
    [
        (
            [{"credential_type": "custom_header", "name": "X Api Key", "value": "v"}],
            {"credentials.0.name": service.HEADER_NAME},
        ),
        (
            [{"credential_type": "custom_header", "name": "Host", "value": "v"}],
            {"credentials.0.name": "Sentra sets this header itself. Use another one."},
        ),
        (
            [
                {"credential_type": "custom_header", "name": "X-Team", "value": "a"},
                {"credential_type": "custom_header", "name": "x-team", "value": "b"},
            ],
            {"credentials.1.name": "Each header can be used only once."},
        ),
        (
            [{"credential_type": "custom_header", "name": "X-Team", "value": "a\r\nX-Evil: 1"}],
            {"credentials.0.value": "The value can't contain line breaks."},
        ),
        (
            [{"credential_type": "api_key", "name": "X-Api-Key", "value": " "}],
            {"credentials.0.value": "Enter the secret."},
        ),
        (
            [
                {"credential_type": "api_key", "name": "X-Api-Key", "value": "a"},
                {"credential_type": "custom_header", "name": "X-Team", "value": "b"},
            ],
            {"credentials": service.ONE_WAY},
        ),
    ],
)
def test_credentials_are_checked(developer, credentials, expected):
    assert errors(register(developer, credentials=credentials)) == expected


def test_names_are_unique_within_the_organization(developer):
    register(developer)
    assert errors(register(developer, name="payments operations agent")) == {
        "name": "A target with this name already exists. Choose another name."
    }


# ---------------------------------------------------------------- who may do what (FR-1.6)


def test_only_ai_application_developers_register_and_change_targets(developer, client):
    target_id = register(developer).json()["id"]

    for email in ("tom@example.com", "priya@example.com"):  # administrator, security analyst
        log_in(client, email)
        assert register(client, name="Another").status_code == 403
        assert client.patch(f"/api/v1/targets/{target_id}", json={"name": "X"}).status_code == 403
        assert client.get(f"/api/v1/targets/{target_id}").status_code == 200  # reading is allowed


def test_other_organizations_never_see_a_target(developer, db):
    other = Organization(name="Northwind Labs", slug="northwind-labs")
    db.add(other)
    db.flush()
    foreign = Target(
        organization_id=other.id,
        name="Northwind Helpdesk",
        type="chatbot",
        endpoint_url="https://support-assistant.halcyonbank.com/api/chat",
        environment="production",
        max_request_rate=10,
        status=TargetStatus.UNVERIFIED,
        verification_token="0" * 32,
    )
    db.add(foreign)
    db.flush()

    assert developer.get(f"/api/v1/targets/{foreign.id}").status_code == 404
    assert developer.patch(f"/api/v1/targets/{foreign.id}", json={"name": "X"}).status_code == 404
    assert developer.get("/api/v1/targets").json()["total"] == 0


# ---------------------------------------------------------------- the targets page (Screen 16)


def test_the_list_has_tabs_search_and_filters(developer, db):
    ids = {
        name: register(developer, name=name, type=kind, environment=env, endpoint_url=url).json()[
            "id"
        ]
        for name, kind, env, url in [
            (
                "Customer Support Assistant",
                "chatbot",
                "production",
                "https://support-assistant.halcyonbank.com/api/chat",
            ),
            (
                "Loan Policy Q&A",
                "rag_application",
                "staging",
                "https://loan-policy.staging.halcyonbank.com/api/chat",
            ),
            (
                "Payments Operations Agent",
                "tool_using_agent",
                "staging",
                "https://payments-agent.staging.halcyonbank.com/v1/chat",
            ),
        ]
    }
    stored(db, ids["Customer Support Assistant"]).status = TargetStatus.VERIFIED
    db.flush()
    stored(db, ids["Loan Policy Q&A"]).status = TargetStatus.ARCHIVED
    db.flush()

    def names(**params):
        body = developer.get("/api/v1/targets", params=params).json()
        return [t["name"] for t in body["items"]], body["counts"]

    assert names() == (
        ["Customer Support Assistant", "Payments Operations Agent"],
        {"active": 2, "archived": 1},
    )
    assert names(tab="archived")[0] == ["Loan Policy Q&A"]
    assert names(search="payments-agent")[0] == ["Payments Operations Agent"]
    assert names(type="chatbot")[0] == ["Customer Support Assistant"]
    assert names(environment="staging")[0] == ["Payments Operations Agent"]
    assert names(ownership="unverified")[0] == ["Payments Operations Agent"]


# ---------------------------------------------------------------- changes (UC-2.5)


def test_a_new_endpoint_makes_a_verified_target_unverified(developer, db):
    target_id = register(developer).json()["id"]
    target = stored(db, target_id)
    target.status = TargetStatus.VERIFIED
    old_token = target.verification_token
    db.flush()

    renamed = developer.patch(f"/api/v1/targets/{target_id}", json={"name": "Payments Agent"})
    assert (renamed.json()["name"], renamed.json()["status"]) == ("Payments Agent", "verified")

    moved = developer.patch(
        f"/api/v1/targets/{target_id}",
        json={"endpoint_url": "https://loan-policy.staging.halcyonbank.com/api/chat"},
    )
    assert moved.json()["status"] == "unverified"
    assert stored(db, target_id).verification_token != old_token


def test_the_format_can_be_changed(developer):
    target_id = register(developer).json()["id"]

    response = developer.patch(
        f"/api/v1/targets/{target_id}",
        json={
            "request_format": "custom_json",
            "request_template": '{"input": "{{message}}"}',
            "reply_path": "$.output.text",
        },
    )
    assert (response.json()["request_format"], response.json()["reply_path"]) == (
        "custom_json",
        "$.output.text",
    )
    back = developer.patch(f"/api/v1/targets/{target_id}", json={"request_format": "openai_chat"})
    assert back.json()["request_template"] is None


def test_replacing_credentials_deletes_the_old_ones(developer, db):
    target_id = register(developer).json()["id"]

    response = developer.put(
        f"/api/v1/targets/{target_id}/credentials",
        json={"credentials": [{"credential_type": "bearer_token", "value": "new-token"}]},
    )

    assert [c["name"] for c in response.json()["credentials"]] == ["Authorization"]
    rows = db.scalars(
        select(TargetCredential).where(TargetCredential.target_id == uuid.UUID(target_id))
    ).all()
    assert [(r.name, r.decrypt()) for r in rows] == [("Authorization", "new-token")]


def test_an_archived_target_cannot_be_changed(developer, db):
    target_id = register(developer).json()["id"]
    stored(db, target_id).status = TargetStatus.ARCHIVED
    db.flush()

    response = developer.patch(f"/api/v1/targets/{target_id}", json={"name": "X"})
    assert response.status_code == 409
    assert response.json()["error"]["message"] == (
        "This target is archived. Restore it before changing it."
    )
