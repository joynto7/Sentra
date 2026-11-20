"""UC-3.2 Review and Approve Threat Model and UC-3.4 Compare Threat Model Versions (FR-3.2,
FR-3.3, NFR-9.3): changes become new versions, a person approves, versions can be compared and
restored."""

from sqlalchemy import select

from app.core.audit import AuditLogEntry
from app.modules.m02_targets.models import TargetStatus
from app.modules.m03_threat_models import versions
from tests.m01_users.test_organizations import log_in
from tests.m03_threat_models.conftest import add_target

API = "/api/v1/threat-models"
REVEALED = "System prompt revealed on request"
PAYROLL = "Confidential data from Payroll FAQ disclosed in answers"
SUMMARY = {
    "title": "E-mail summaries include personal data from the conversation",
    "component_kind": "output",
    "component_name": "E-mail summary",
    "owasp": ["LLM02"],
    "atlas": "AML.T0057",
    "likelihood": 2,
    "impact": 4,
    "reason": "E-mail summaries were added in September",
}


def first_version(client, db, halcyon):
    target = add_target(db, halcyon)
    client.post(f"{API}/{target.id}/generate")
    return target


def threats(client, target, version=None) -> dict[str, dict]:
    query = f"?version={version}" if version else ""
    page = client.get(f"{API}/{target.id}{query}").json()
    return {t["title"]: t for t in page["current"]["threats"]}


def edit(threat: dict, **changes) -> dict:
    fields = {
        "number": threat["number"],
        "title": threat["title"],
        "owasp": [o["code"] for o in threat["owasp"]],
        "atlas": threat["atlas"]["code"] if threat["atlas"] else None,
        "likelihood": threat["likelihood"],
        "impact": threat["impact"],
    }
    return {**fields, **changes}


def errors(response) -> dict[str, str]:
    return {d["field"]: d["message"] for d in response.json()["error"]["details"] or []}


def review(client, target) -> dict:
    """Arif's review of version 1: one rating changed, one threat removed, one added."""
    before = threats(client, target)
    return client.post(
        f"{API}/{target.id}/versions",
        json={
            "base_version": 1,
            "edit": [edit(before[REVEALED], likelihood=4, reason="Seen in R-229-2")],
            "remove": [
                {"number": before[PAYROLL]["number"], "reason": "The Payroll FAQ is public"}
            ],
            "add": [SUMMARY],
        },
    )


def test_saving_changes_makes_the_next_version_and_keeps_the_earlier_one(client, db, halcyon):
    target = first_version(client, db, halcyon)
    v1 = threats(client, target)

    response = review(client, target)

    assert response.status_code == 201
    current = response.json()["current"]
    assert (current["version"], current["origin"], current["based_on_version"]) == (
        2,
        "edited",
        1,
    )
    assert (current["created_by"], current["status"]) == ("Arif", "draft")
    v2 = {t["title"]: t for t in current["threats"]}
    revealed = v2[REVEALED]
    assert (revealed["likelihood"], revealed["rated_by"], revealed["edited_by"]) == (
        4,
        "Arif",
        "Arif",
    )
    assert revealed["change_reason"] == "Seen in R-229-2"
    assert (v2[PAYROLL]["removed"], v2[PAYROLL]["removal_reason"]) == (
        True,
        "The Payroll FAQ is public",
    )
    added = v2[SUMMARY["title"]]
    assert (added["source"], added["component_name"]) == ("analyst", "E-mail summary")
    assert added["number"] == max(t["number"] for t in v1.values()) + 1
    # Removed threats come last; the others by risk.
    assert current["threats"][-1]["title"] == PAYROLL
    assert current["threat_count"] == len(v1)  # 13 - 1 removed + 1 added
    # Version 1 is unchanged (FR-3.3).
    assert threats(client, target, 1)[REVEALED]["likelihood"] == v1[REVEALED]["likelihood"]
    assert not threats(client, target, 1)[PAYROLL]["removed"]
    entry = db.scalar(select(AuditLogEntry).where(AuditLogEntry.action == "threat_model.saved"))
    assert entry.summary.endswith("1 changed, 1 added, 1 removed")


def test_a_new_threat_needs_an_owasp_category_and_a_removal_a_reason(client, db, halcyon):
    target = first_version(client, db, halcyon)  # 3a and UC-3.2 step 3
    before = threats(client, target)

    response = client.post(
        f"{API}/{target.id}/versions",
        json={
            "base_version": 1,
            "add": [{**SUMMARY, "owasp": []}, {**SUMMARY, "atlas": "T0057"}],
            "remove": [{"number": before[PAYROLL]["number"], "reason": ""}],
            "edit": [edit(before[REVEALED], owasp=["LLM99"])],
        },
    )

    assert response.status_code == 422
    assert errors(response) == {
        "add.0.owasp": "Choose at least one OWASP category.",
        "add.1.atlas": "Use a MITRE ATLAS ID such as AML.T0051.",
        f"threats.{before[PAYROLL]['number']}.reason": "Give a reason for removing it.",
        f"threats.{before[REVEALED]['number']}.owasp": "Choose at least one OWASP category.",
    }
    assert versions.latest(db, target.id).version == 1


def test_a_new_threat_must_name_a_component_of_the_target_unless_it_is_an_output(
    client, db, halcyon
):
    target = first_version(client, db, halcyon)

    unknown = {**SUMMARY, "component_kind": "tool", "component_name": "issue_refund"}
    response = client.post(
        f"{API}/{target.id}/versions", json={"base_version": 1, "add": [unknown]}
    )

    assert errors(response) == {"add.0.component": "Choose one of the components."}
    known = {**SUMMARY, "component_kind": "knowledge_source", "component_name": "payroll faq"}
    saved = client.post(f"{API}/{target.id}/versions", json={"base_version": 1, "add": [known]})
    added = {t["title"]: t for t in saved.json()["current"]["threats"]}[SUMMARY["title"]]
    assert added["component_name"] == "Payroll FAQ"


def test_nothing_to_save_and_unknown_threats_are_refused(client, db, halcyon):
    target = first_version(client, db, halcyon)
    before = threats(client, target)

    unchanged = client.post(
        f"{API}/{target.id}/versions",
        json={"base_version": 1, "edit": [edit(before[REVEALED])]},
    )
    unknown = client.post(
        f"{API}/{target.id}/versions",
        json={"base_version": 1, "remove": [{"number": 999, "reason": "Doesn't apply"}]},
    )

    assert (unchanged.status_code, unchanged.json()["error"]["code"]) == (422, "no_changes")
    assert errors(unknown) == {"threats.999": "There is no threat 999."}


def test_a_newer_version_saved_meanwhile_is_shown_before_saving_or_approving(client, db, halcyon):
    target = first_version(client, db, halcyon)  # 5b
    before = threats(client, target)
    review(client, target)  # Priya, say, saves version 2 meanwhile

    stale = client.post(
        f"{API}/{target.id}/versions",
        json={"base_version": 1, "edit": [edit(before[REVEALED], likelihood=5)]},
    )
    approve_old = client.post(f"{API}/{target.id}/versions/1/approve")

    for response in (stale, approve_old):
        assert (response.status_code, response.json()["error"]["code"]) == (409, "newer_version")
        assert errors(response) == {"base_version": "2"}
    changes = client.get(f"{API}/{target.id}/compare?base=1&compare=2").json()
    assert [c["title"] for c in changes["changed"]] == [REVEALED]


def test_only_a_person_approves_and_the_approval_is_recorded(client, db, halcyon):
    target = first_version(client, db, halcyon)
    assert threats(client, target)  # generated as a draft, never approved by Sentra (NFR-9.3)
    log_in(client, "maya@example.com")  # an AI Application Developer
    assert client.post(f"{API}/{target.id}/versions/1/approve").status_code == 403
    log_in(client, "arif@example.com")

    response = client.post(f"{API}/{target.id}/versions/1/approve")

    current = response.json()["current"]
    assert (current["status"], current["approved_by"]) == ("approved", "Arif")
    assert current["approved_at"] is not None
    entry = db.scalar(select(AuditLogEntry).where(AuditLogEntry.action == "threat_model.approved"))
    assert (entry.actor_name, entry.summary) == (
        "Arif",
        "Approved version 1 of the threat model of Internal HR Helpdesk",
    )
    again = client.post(f"{API}/{target.id}/versions/1/approve")
    assert (again.status_code, again.json()["error"]["code"]) == (409, "already_approved")


def test_a_removed_threat_stays_removed_in_later_versions_until_it_is_restored(client, db, halcyon):
    target = first_version(client, db, halcyon)
    review(client, target)
    payroll = threats(client, target)[PAYROLL]
    client.post(
        f"{API}/{target.id}/versions",
        json={"base_version": 2, "add": [{**SUMMARY, "title": "Summaries go to the wrong person"}]},
    )
    assert threats(client, target, 3)[PAYROLL]["removed"] is True

    response = client.post(
        f"{API}/{target.id}/versions", json={"base_version": 3, "restore": [payroll["number"]]}
    )

    restored = {t["title"]: t for t in response.json()["current"]["threats"]}[PAYROLL]
    assert (restored["removed"], restored["removal_reason"], restored["edited_by"]) == (
        False,
        None,
        "Arif",
    )


def test_two_versions_are_compared_with_the_reasons_for_each_change(client, db, halcyon):
    target = first_version(client, db, halcyon)
    review(client, target)

    body = client.get(f"{API}/{target.id}/compare?base=1&compare=2").json()

    assert [(t["title"], t["reason"]) for t in body["added"]] == [
        (SUMMARY["title"], "E-mail summaries were added in September")
    ]
    assert [(t["title"], t["reason"]) for t in body["removed"]] == [
        (PAYROLL, "The Payroll FAQ is public")
    ]
    (changed,) = body["changed"]
    assert (changed["title"], changed["reason"]) == (REVEALED, "Seen in R-229-2")
    assert changed["changes"] == [{"field": "likelihood", "before": "3", "after": "4"}]
    assert (body["base"]["version"], body["compare"]["version"], body["identical"]) == (
        1,
        2,
        False,
    )
    assert (body["base_runs"], body["compare"]["runs"]) == ([], 0)  # runs come with FR-5.4
    same = client.get(f"{API}/{target.id}/compare?base=2&compare=2").json()
    assert same["identical"] is True  # 4a
    assert client.get(f"{API}/{target.id}/compare?base=1&compare=7").status_code == 404


def test_an_earlier_version_is_restored_as_a_new_draft(client, db, halcyon):
    target = first_version(client, db, halcyon)  # UC-3.4, 3a
    client.post(f"{API}/{target.id}/versions/1/approve")
    review(client, target)

    response = client.post(f"{API}/{target.id}/versions/1/restore")

    current = response.json()["current"]
    assert (current["version"], current["origin"], current["based_on_version"]) == (
        3,
        "restored",
        1,
    )
    assert current["status"] == "draft"  # approved again before campaigns use it
    restored = {
        (t["number"], t["title"], t["likelihood"], t["removed"]) for t in current["threats"]
    }
    original = {
        (t["number"], t["title"], t["likelihood"], t["removed"])
        for t in threats(client, target, 1).values()
    }
    assert restored == original
    newest = client.post(f"{API}/{target.id}/versions/3/restore")
    assert (newest.status_code, newest.json()["error"]["code"]) == (409, "newest_version")


def test_an_archived_targets_threat_model_can_be_read_but_not_changed(client, db, halcyon):
    target = first_version(client, db, halcyon)
    target.status = TargetStatus.ARCHIVED
    db.commit()

    response = client.post(f"{API}/{target.id}/versions/1/approve")

    assert (response.status_code, response.json()["error"]["code"]) == (409, "target_archived")
    assert client.get(f"{API}/{target.id}").status_code == 200
