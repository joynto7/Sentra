"""Tests for FR-9.3 (M9) Notifications: UC-9.3 and the preferences of UC-1.11."""

import uuid

import pytest
from sqlalchemy import select

from app.core.email import outbox
from app.modules.m01_users.models import Role, User
from app.modules.m09_reporting.notifications import notify
from app.workers.reporting.emails import send_notification_email
from tests.m01_users.test_organizations import PASSWORD, log_in
from tests.m01_users.test_permissions import membership_of, organization_with

URL = "/api/v1/notifications"


@pytest.fixture
def maya(client, db):
    """Maya, an AI Application Developer of Halcyon Bank, is logged in."""
    org = organization_with(db, client, {"maya@example.com": Role.TARGET_OWNER})
    log_in(client, "maya@example.com")
    return {"client": client, "db": db, "org": org, "id": user_id(db, "maya@example.com")}


def user_id(db, email: str) -> uuid.UUID:
    return db.scalar(select(User.id).where(User.email == email))


def send(maya, event="campaign_run_completed", **changes):
    data = {
        "event": event,
        "user_ids": [maya["id"]],
        "organization_id": maya["org"],
        "text": "Campaign run R-231-4 completed — 3 new findings, 1 Critical",
        "subject": "R-231-4",
        "link": "/campaigns/C-231",
    }
    notify(maya["db"], **(data | changes))


def test_an_event_reaches_the_app_and_the_inbox(maya):
    send(maya)

    body = maya["client"].get(URL).json()
    item = body["items"][0]
    assert (body["unread_count"], item["subject"], item["link"]) == (
        1,
        "R-231-4",
        "/campaigns/C-231",
    )
    assert outbox[-1]["To"] == "maya@example.com"
    content = outbox[-1].get_content()
    assert "Campaign run R-231-4 completed" in content
    assert "/campaigns/C-231" in content  # a short summary and a link, nothing more


def test_turning_off_e_mails_keeps_the_in_app_notification(maya):
    maya["client"].put(
        f"{URL}/preferences",
        json=[{"event": "campaign_run_completed", "in_app": True, "email": False}],
    )
    sent_before = len(outbox)

    send(maya)

    assert len(outbox) == sent_before  # UC-9.3, 2a
    assert maya["client"].get(URL).json()["total"] == 1


def test_turning_off_in_app_keeps_the_e_mail(maya):
    maya["client"].put(
        f"{URL}/preferences",
        json=[{"event": "campaign_run_completed", "in_app": False, "email": True}],
    )

    send(maya)

    assert maya["client"].get(URL).json()["total"] == 0
    assert outbox[-1]["To"] == "maya@example.com"


def test_account_security_alerts_cannot_be_turned_off(maya):
    response = maya["client"].put(
        f"{URL}/preferences", json=[{"event": "account_security", "in_app": True, "email": False}]
    )

    assert response.status_code == 422
    assert response.json()["error"]["message"] == (
        "Account security alerts are always on, for your protection."
    )
    locked = next(p for p in maya["client"].get(f"{URL}/preferences").json() if p["locked"])
    assert (locked["in_app"], locked["email"]) == (True, True)


def test_preferences_list_every_event_switched_on_by_default(maya):
    preferences = maya["client"].get(f"{URL}/preferences").json()

    # with the events of UC-2.4 step 4, UC-3.1 step 6, UC-8.2 step 6, UC-8.3 step 6,
    # UC-8.4 steps 5-6, UC-9.6 3a1, UC-11.4 step 7, FR-5.3 and
    # "Finding reopened as a regression" (FR-6.6)
    assert len(preferences) == 17
    assert all(p["in_app"] and p["email"] for p in preferences)
    assert preferences[0]["label"] == "Campaign run completed"


def test_many_events_of_one_group_become_one_notification(maya):
    sent_before = len(outbox)

    for _ in range(3):
        send(
            maya,
            event="finding_critical_high",
            text="A new Critical finding in campaign run R-229-2",
            subject="R-229-2",
            group_key="findings:R-229-2",
            combined_text="{count} new findings in campaign run R-229-2",
        )

    items = maya["client"].get(URL).json()["items"]
    assert len(items) == 1  # UC-9.3, 1a
    assert (items[0]["count"], items[0]["text"]) == (3, "3 new findings in campaign run R-229-2")
    assert len(outbox) == sent_before + 1  # one e-mail for the group


def test_tabs_and_only_unread(maya):
    send(maya)
    send(
        maya,
        event="finding_assigned",
        text="F-1168 was assigned to you by Arif Hossain",
        subject="F-1168",
    )
    send(maya, event="approval_requested", text="RM-309 waits for your approval", subject="RM-309")
    client = maya["client"]
    first = client.get(URL).json()["items"][0]["id"]
    client.post(f"{URL}/{first}/read")

    assigned = client.get(URL, params={"tab": "assigned"}).json()
    approvals = client.get(URL, params={"tab": "approvals"}).json()
    unread = client.get(URL, params={"unread": True}).json()

    assert [i["subject"] for i in assigned["items"]] == ["F-1168"]
    assert [i["subject"] for i in approvals["items"]] == ["RM-309"]
    assert unread["total"] == 2 and unread["unread_count"] == 2


def test_mark_all_as_read(maya):
    send(maya)
    send(maya, event="report_ready", text="The report of R-231-4 is ready", subject="report")

    marked = maya["client"].post(f"{URL}/read-all").json()

    assert marked == {"marked": 2}
    assert maya["client"].get(f"{URL}/unread-count").json() == {"unread_count": 0}


def test_another_persons_notification_cannot_be_opened(maya, client):
    send(maya)
    hers = client.get(URL).json()["items"][0]["id"]

    log_in(client, "tom@example.com")

    assert client.post(f"{URL}/{hers}/read").status_code == 404


def test_notifications_show_in_their_organization_and_account_alerts_everywhere(maya, db):
    send(maya)  # Halcyon Bank
    send(maya, organization_id=create_other_organization(db))  # another organization of Maya
    notify(
        db,
        event="account_security",
        user_ids=[maya["id"]],
        organization_id=None,  # about the account itself
        text="Your password was changed",
        subject="password",
        email=False,
    )

    items = maya["client"].get(URL).json()["items"]

    assert sorted(i["event"] for i in items) == ["account_security", "campaign_run_completed"]


def create_other_organization(db) -> uuid.UUID:
    from app.core.models import Organization

    other = Organization(name="Northwind Labs", slug="northwind-labs")
    db.add(other)
    db.flush()
    return other.id


def test_a_password_change_alerts_in_the_app_without_a_second_e_mail(maya):
    sent_before = len(outbox)

    maya["client"].post(
        "/api/v1/account/password",
        json={"current_password": PASSWORD, "new_password": "Silver-Harbor-Evening-77"},
    )

    item = maya["client"].get(URL).json()["items"][0]
    assert (item["event"], item["subject"]) == ("account_security", "password")
    assert len(outbox) == sent_before + 1  # only M1's own e-mail


def test_a_role_change_tells_the_member_in_the_app(maya, client, db):
    log_in(client, "tom@example.com")
    member = membership_of(db, "maya@example.com")
    client.patch(
        f"/api/v1/organizations/current/members/{member.id}",
        json={"role": "security_analyst", "password": PASSWORD},
    )
    log_in(client, "maya@example.com")

    item = client.get(URL).json()["items"][0]

    assert item["text"] == "Tom changed your role to Security Analyst"


def test_e_mails_are_retried_with_growing_delays():
    task = send_notification_email

    assert OSError in task.autoretry_for  # SMTP servers down or refusing
    assert task.retry_backoff is True and task.max_retries == 6
