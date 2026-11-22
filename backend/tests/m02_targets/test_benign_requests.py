"""The Benign Request Set of a target (FR-8.4, Screen 22).

The owner of a target writes examples of normal use of their application; every retest of one of
its findings sends them beside the attempts that found the weakness, so that a fix which blocks
legitimate requests is noticed (UC-8.6 step 1, quality requirement 1). They are the target's own
data, like its canary tokens, and they are replaced as a whole.
"""

from sqlalchemy import select

from app.modules.m02_targets.models import TargetBenignRequest, TargetStatus
from tests.m01_users.test_organizations import log_in
from tests.m02_targets.test_targets import register

URL = "/api/v1/targets"

EXAMPLES = [
    "What is the status of my last order?",
    "Can you explain your refund rules in two sentences?",
    "Who should I contact about a payment that failed?",
]


def saved(db, target_id) -> list[str]:
    return [
        one.text
        for one in db.scalars(
            select(TargetBenignRequest)
            .where(TargetBenignRequest.target_id == target_id)
            .order_by(TargetBenignRequest.position)
        )
    ]


def test_the_owner_saves_examples_of_normal_use(developer, db):
    target_id = register(developer).json()["id"]

    answered = developer.put(
        f"{URL}/{target_id}/profile/benign-requests", json={"requests": EXAMPLES}
    )

    assert answered.status_code == 200, answered.text
    body = answered.json()
    assert [one["text"] for one in body] == EXAMPLES
    assert [one["position"] for one in body] == [1, 2, 3]
    assert saved(db, target_id) == EXAMPLES


def test_the_profile_shows_the_set_and_says_what_it_is_for(developer, db):
    target_id = register(developer).json()["id"]
    developer.put(f"{URL}/{target_id}/profile/benign-requests", json={"requests": EXAMPLES})

    page = developer.get(f"{URL}/{target_id}/profile")

    assert page.status_code == 200, page.text
    body = page.json()
    assert [one["text"] for one in body["benign_requests"]] == EXAMPLES
    assert "retest" in body["benign_requests_help"]


def test_the_set_is_replaced_as_a_whole_without_empty_or_repeated_examples(developer, db):
    target_id = register(developer).json()["id"]
    developer.put(f"{URL}/{target_id}/profile/benign-requests", json={"requests": EXAMPLES})

    answered = developer.put(
        f"{URL}/{target_id}/profile/benign-requests",
        json={"requests": ["  Where is my order?  ", "", EXAMPLES[0], EXAMPLES[0]]},
    )

    assert answered.status_code == 200, answered.text
    assert saved(db, target_id) == ["Where is my order?", EXAMPLES[0]]


def test_only_the_people_who_may_change_a_target_may_change_its_set(developer, db):
    target_id = register(developer).json()["id"]

    log_in(developer, "priya@example.com")  # a Security Analyst
    refused = developer.put(
        f"{URL}/{target_id}/profile/benign-requests", json={"requests": EXAMPLES}
    )

    assert refused.status_code == 403
    assert saved(db, target_id) == []


def test_an_archived_target_keeps_the_set_it_had(developer, db):
    from app.modules.m02_targets.models import Target

    target_id = register(developer).json()["id"]
    developer.put(f"{URL}/{target_id}/profile/benign-requests", json={"requests": EXAMPLES})
    target = db.get(Target, target_id)
    target.status = TargetStatus.ARCHIVED
    db.commit()

    refused = developer.put(
        f"{URL}/{target_id}/profile/benign-requests", json={"requests": ["Anything else?"]}
    )

    assert refused.status_code == 409
    assert saved(db, target_id) == EXAMPLES
