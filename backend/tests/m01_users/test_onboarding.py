"""The first-run setup of a member: progress, choices, skipping, and who sees it."""

from fastapi.testclient import TestClient

from app.modules.m01_users.models import Role
from tests.m01_users.test_organizations import log_in
from tests.m01_users.test_permissions import membership_of, organization_with

URL = "/api/v1/organizations/current/onboarding"


def test_a_new_member_has_not_done_the_setup_and_the_session_says_so(db, client: TestClient):
    organization_with(db, client, {"priya@example.com": Role.SECURITY_ANALYST})
    me = client.get("/api/v1/auth/me").json()
    assert me["organization"]["onboarding_done"] is False
    assert client.get(URL).json() == {
        "done": False,
        "skipped": False,
        "step": 0,
        "answers": {},
        "ask": None,
    }


def test_the_step_and_the_choices_are_kept_and_a_later_save_keeps_the_earlier_choices(
    db, client: TestClient
):
    organization_with(db, client, {})
    assert client.put(URL, json={"step": 1, "answers": {"goal": "own_app"}}).status_code == 200
    saved = client.put(URL, json={"step": 2, "answers": {"first_task": "lab"}}).json()
    assert saved["step"] == 2
    assert saved["answers"] == {"goal": "own_app", "first_task": "lab"}


def test_only_the_listed_questions_and_choices_are_accepted_and_no_free_text(
    db, client: TestClient
):
    organization_with(db, client, {})
    for body in (
        {"answers": {"goal": "something I typed"}},
        {"answers": {"favourite_colour": "blue"}},
        {"step": 99},
    ):
        assert client.put(URL, json=body).status_code == 422
    assert client.put(URL, json={"unknown": 1}).status_code == 422
    assert client.get(URL).json()["answers"] == {}


def test_completing_marks_it_done_and_then_asks_one_question_at_a_time(db, client: TestClient):
    organization_with(db, client, {})
    assert client.get("/api/v1/auth/me").json()["organization"]["onboarding_done"] is False
    done = client.post(f"{URL}/complete").json()
    assert done["done"] is True and done["skipped"] is False
    assert done["ask"] == "team_size"
    assert client.get("/api/v1/auth/me").json()["organization"]["onboarding_done"] is True
    after = client.put(URL, json={"answers": {"team_size": "2-10"}}).json()
    assert after["ask"] == "experience"
    final = client.put(URL, json={"answers": {"experience": "new"}}).json()
    assert final["ask"] is None


def test_skipping_is_not_asked_again_and_is_recorded_as_skipped(db, client: TestClient):
    organization_with(db, client, {})
    skipped = client.post(f"{URL}/skip").json()
    assert skipped["done"] is True and skipped["skipped"] is True
    assert client.get("/api/v1/auth/me").json()["organization"]["onboarding_done"] is True


def test_the_setup_of_one_person_does_not_touch_another(db, client: TestClient):
    organization_with(db, client, {"priya@example.com": Role.SECURITY_ANALYST})
    client.post(f"{URL}/complete")
    log_in(client, "priya@example.com")
    assert client.get("/api/v1/auth/me").json()["organization"]["onboarding_done"] is False
    assert membership_of(db, "priya@example.com").onboarding in (None, {})


def test_it_needs_a_login(client: TestClient):
    assert client.get(URL).status_code == 401


def test_the_setup_can_be_opened_again_and_keeps_the_earlier_choices(db, client: TestClient):
    organization_with(db, client, {})
    client.put(URL, json={"step": 2, "answers": {"goal": "learn"}})
    client.post(f"{URL}/skip")
    assert client.get("/api/v1/auth/me").json()["organization"]["onboarding_done"] is True
    again = client.post(f"{URL}/restart").json()
    assert again["done"] is False and again["skipped"] is False and again["step"] == 0
    assert again["answers"] == {"goal": "learn"}
    assert client.get("/api/v1/auth/me").json()["organization"]["onboarding_done"] is False
