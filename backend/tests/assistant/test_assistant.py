"""The assistant: what it answers, what it does, and what it must never do."""

import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update

from app.core.audit import AuditLogEntry
from app.modules.assistant import knowledge, schedules, store, tools
from app.modules.assistant.models import Action, Conversation
from app.modules.assistant.service import Limiter
from app.modules.m01_users.models import Membership
from app.modules.m02_targets.models import Target
from tests.assistant.conftest import as_user, call, decide, events, of_kind, say
from tests.m05_campaigns.test_campaigns import add_target

URL = "/api/v1/assistant"
NEW_TARGET = {
    "name": "Support Bot",
    "type": "chatbot",
    "endpoint_url": "https://support.staging.halcyonbank.com/v1/chat",
    "environment": "staging",
}


def targets_in(db) -> int:
    return db.scalar(select(func.count()).select_from(Target))


# ---------------------------------------------------------------- status and guide mode


def test_status_says_whether_a_model_is_there(team, no_model):
    as_user(team, "maya@example.com")
    body = team.get(f"{URL}/status").json()
    assert (body["available"], body["mode"], body["model"]) == (False, "guide", None)
    assert body["starters"] and "Register and update targets" in body["can_do"]


def test_status_names_the_model_and_where_it_runs(team, model):
    as_user(team, "priya@example.com")
    body = team.get(f"{URL}/status").json()
    assert (body["available"], body["mode"], body["deployment"]) == (True, "ai", "local")
    # A role is only offered what it may do.
    assert "Register and update targets" not in body["can_do"]
    assert "Create campaigns and launch runs" in body["can_do"]


def test_without_a_model_it_answers_from_the_guide(team, no_model):
    as_user(team, "maya@example.com")
    got = say(team, "How do I register a target?")
    message = of_kind(got, "message")[0]["message"]
    assert message["mode"] == "guide"
    assert "address Sentra sends requests to" in message["content"]
    assert "isn't available right now" in message["content"]
    links = [e["card"] for e in of_kind(got, "card") if e["card"]["type"] == "link"]
    assert any(c["href"] == "/targets/new" for c in links)


def test_without_a_model_it_still_shows_lists(team, no_model, db):
    as_user(team, "maya@example.com")
    add_target(
        db, db.scalar(select(Membership.organization_id).limit(1)), name="Payments Operations Agent"
    )

    got = say(team, "show my targets")
    tables = [e["card"] for e in of_kind(got, "card") if e["card"]["type"] == "table"]
    assert tables and tables[0]["rows"][0]["cells"][0]["text"] == "Payments Operations Agent"
    assert tables[0]["rows"][0]["href"].startswith("/targets/")


def test_a_question_nothing_matches_gets_an_honest_answer(team, no_model):
    as_user(team, "maya@example.com")
    message = of_kind(say(team, "zzzz qqqq"), "message")[0]["message"]
    assert "I can answer questions about Sentra" in message["content"]


# ---------------------------------------------------------------- reading


def test_a_read_tool_runs_at_once_and_its_result_is_data_to_the_model(team, model, db):
    as_user(team, "maya@example.com")
    org = db.scalar(select(Membership.organization_id).limit(1))
    add_target(db, org, name="Payments Operations Agent")
    model.then(
        [call("list_targets")],
        "You have one target. [[suggest: Test its connection | Show findings]]",
    )

    got = say(team, "which targets do I have?", page="/targets")

    steps = [e["step"] for e in of_kind(got, "step")]
    assert [s["status"] for s in steps] == ["running", "done"]
    assert steps[1]["summary"] == "1 found"
    assert (
        of_kind(got, "card")[0]["card"]["rows"][0]["cells"][0]["text"]
        == "Payments Operations Agent"
    )
    message = of_kind(got, "message")[0]["message"]
    assert message["content"] == "You have one target."
    assert message["suggestions"] == ["Test its connection", "Show findings"]
    # The second request carries the tool's result inside a data block, never as an instruction.
    result = [m for m in model.sent[1]["messages"] if m["role"] == "tool"][0]["content"]
    assert result.startswith("<data-") and "Payments Operations Agent" in result
    assert "the page /targets" in model.sent[0]["messages"][0]["content"].replace(
        "is on the page", "the page"
    )


def test_what_the_person_writes_is_masked_before_it_reaches_the_model(team, model):
    as_user(team, "maya@example.com")
    model.then("Understood.")
    say(team, "my key is sk-ant-abcdefghijklmnopqrstuvwxyz and mail is ann@example.com")
    sent = [m["content"] for m in model.sent[0]["messages"] if m["role"] == "user"][0]
    assert "sk-ant-" not in sent and "ann@example.com" not in sent


def test_an_unknown_tool_or_missing_argument_is_told_to_the_model_not_run(team, model, db):
    as_user(team, "maya@example.com")
    model.then([call("drop_database")], [call("get_target")], "Which target?")
    got = say(team, "do something")
    assert of_kind(got, "action") == []
    tool_messages = [m["content"] for m in model.sent[2]["messages"] if m["role"] == "tool"]
    assert "no tool called drop_database" in tool_messages[0]
    assert "Missing: target_id" in tool_messages[1]


# ---------------------------------------------------------------- changing: always confirmed


def test_a_change_is_proposed_and_only_runs_when_the_person_confirms(team, model, db):
    as_user(team, "maya@example.com")
    model.then([call("register_target", **NEW_TARGET)], "I've prepared it; please confirm.")

    got = say(team, "register the support bot at its staging address")

    action = of_kind(got, "action")[0]["action"]
    assert action["status"] == "pending" and action["risk"] == "normal"
    assert "Support Bot" in action["summary"]
    assert targets_in(db) == 0  # nothing happened yet
    assert of_kind(got, "message")[0]["message"]["actions"][0]["id"] == action["id"]

    model.then("Registered. Next, verify ownership. [[suggest: Verify ownership]]")
    done = events(decide(team, action["id"], "confirm"))

    result = of_kind(done, "action_result")[0]
    assert result["action"]["status"] == "done", result
    assert result["message"]["role"] == "event" and result["message"]["content"] == "Done."
    assert targets_in(db) == 1
    target = db.scalar(select(Target))
    assert (target.name, target.status) == ("Support Bot", "unverified")
    # The assistant went on, knowing the outcome.
    assert of_kind(done, "message")[0]["message"]["suggestions"] == ["Verify ownership"]
    note = [m["content"] for m in model.sent[-1]["messages"] if m["role"] == "user"][-1]
    assert note.startswith("[Sentra, not the person] The person confirmed")
    # The API recorded the change as the person's, and the assistant added where it came from.
    actions = db.scalars(select(AuditLogEntry.action)).all()
    assert "target.registered" in actions and "assistant.action_confirmed" in actions


def test_a_change_can_be_confirmed_only_once(team, model, db):
    as_user(team, "maya@example.com")
    model.then([call("register_target", **NEW_TARGET)], "Please confirm.")
    action = of_kind(say(team, "register it"), "action")[0]["action"]

    model.then("Done.")
    assert of_kind(events(decide(team, action["id"], "confirm")), "action_result")
    again = events(decide(team, action["id"], "confirm"))
    assert of_kind(again, "error") and not of_kind(again, "action_result")
    assert targets_in(db) == 1


def test_a_cancelled_change_changes_nothing(team, model, db):
    as_user(team, "maya@example.com")
    model.then([call("register_target", **NEW_TARGET)], "Please confirm.")
    action = of_kind(say(team, "register it"), "action")[0]["action"]

    got = events(decide(team, action["id"], "cancel"))

    assert of_kind(got, "action_result")[0]["action"]["status"] == "cancelled"
    assert targets_in(db) == 0
    assert not of_kind(
        events(decide(team, action["id"], "confirm")), "action_result"
    )  # it is closed


def test_an_old_proposal_cannot_be_confirmed(team, model, db):
    as_user(team, "maya@example.com")
    model.then([call("register_target", **NEW_TARGET)], "Please confirm.")
    action = of_kind(say(team, "register it"), "action")[0]["action"]
    db.execute(
        update(Action).values(
            created_at=datetime.now(UTC) - timedelta(minutes=store.PROPOSAL_MINUTES + 1)
        )
    )
    db.flush()
    got = events(decide(team, action["id"], "confirm"))
    assert of_kind(got, "error") and targets_in(db) == 0


def test_the_api_refuses_what_the_role_forbids_even_if_the_assistant_proposes_it(team, model, db):
    # Priya is an analyst: register_target is not even offered to the model ...
    as_user(team, "priya@example.com")
    model.then([call("register_target", **NEW_TARGET)], "I can't register targets for you.")
    got = say(team, "register the support bot")
    assert "register_target" not in {t["function"]["name"] for t in model.sent[0]["tools"]}
    assert of_kind(got, "action") == [] and targets_in(db) == 0

    # ... and a proposal is its owner's: nobody else can confirm it.
    as_user(team, "maya@example.com")
    model.then([call("register_target", **NEW_TARGET)], "Please confirm.")
    action = of_kind(say(team, "register it"), "action")[0]["action"]
    as_user(team, "priya@example.com")
    assert decide(team, action["id"], "confirm").status_code == 404  # not Priya's proposal


def test_an_api_refusal_is_reported_and_the_model_can_explain_it(team, model, db):
    as_user(team, "maya@example.com")
    model.then(
        [call("register_target", **{**NEW_TARGET, "endpoint_url": "not a url"})], "Please confirm."
    )
    action = of_kind(say(team, "register it"), "action")[0]["action"]

    model.then("The address isn't valid. Send me the full https address.")
    got = events(decide(team, action["id"], "confirm"))

    result = of_kind(got, "action_result")[0]
    assert result["action"]["status"] == "failed" and result["message"]["content"]
    assert targets_in(db) == 0
    assert "address" in of_kind(got, "message")[0]["message"]["content"]


def test_a_target_the_model_made_up_is_not_proposed(team, model, db):
    as_user(team, "maya@example.com")
    model.then([call("test_target_connection", target_id=str(uuid.uuid4()))], "I couldn't find it.")
    got = say(team, "test the connection")
    assert of_kind(got, "action") == []
    answer = [m["content"] for m in model.sent[1]["messages"] if m["role"] == "tool"][0]
    assert "doesn't exist" in answer


def test_launching_a_run_is_a_high_risk_proposal(team, model, db):
    as_user(team, "priya@example.com")
    org = db.scalar(select(Membership.organization_id).limit(1))
    add_target(db, org)
    model.then([call("launch_campaign_run", code="C-1")], "Please confirm the launch.")
    action = of_kind(say(team, "launch C-1"), "action")[0]["action"]
    assert action["risk"] == "high" and "sends test traffic" in action["summary"]


# ---------------------------------------------------------------- privacy and limits


def test_a_conversation_is_private_to_its_owner(team, model):
    as_user(team, "maya@example.com")
    model.then("Hello.")
    conversation = of_kind(say(team, "hi"), "conversation")[0]["conversation"]["id"]
    assert team.get(f"{URL}/conversations/{conversation}").status_code == 200

    for email in ("priya@example.com", "tom@example.com"):  # an analyst, and the administrator
        as_user(team, email)
        assert team.get(f"{URL}/conversations/{conversation}").status_code == 404
        assert team.delete(f"{URL}/conversations/{conversation}").status_code == 404
        assert say_status(team, conversation) == 404
        assert conversation not in [c["id"] for c in team.get(f"{URL}/conversations").json()]


def say_status(client, conversation) -> int:
    return client.post(
        f"{URL}/chat", json={"message": "hi", "conversation_id": conversation}
    ).status_code


def test_a_conversation_comes_back_with_its_cards_steps_and_actions(team, model, db):
    as_user(team, "maya@example.com")
    org = db.scalar(select(Membership.organization_id).limit(1))
    add_target(db, org)
    model.then([call("list_targets")], [call("register_target", **NEW_TARGET)], "Prepared.")
    conversation = of_kind(say(team, "show targets, then add one"), "conversation")[0][
        "conversation"
    ]["id"]

    body = team.get(f"{URL}/conversations/{conversation}").json()
    assert [m["role"] for m in body["messages"]] == ["user", "assistant"]
    answer = body["messages"][1]
    assert answer["cards"][0]["type"] == "table" and answer["steps"][0]["tool"] == "list_targets"
    assert answer["actions"][0]["status"] == "pending"
    assert team.delete(f"{URL}/conversations/{conversation}").status_code == 204
    assert team.get(f"{URL}/conversations/{conversation}").status_code == 404


def test_too_many_messages_are_refused(team, model, monkeypatch):
    from app.modules.assistant import router

    monkeypatch.setattr(router, "limiter", Limiter(window=60, limit=2))
    as_user(team, "maya@example.com")
    for _ in range(2):
        say(team, "hi")
    refused = team.post(f"{URL}/chat", json={"message": "hi"})
    assert refused.status_code == 429 and refused.json()["error"]["code"] == "too_many_messages"


def test_the_model_failing_halfway_does_not_lose_the_answer(team, model, monkeypatch):
    from app.llm import layer

    as_user(team, "maya@example.com")
    model.then([call("list_targets")])
    real = layer._send

    # The first request works, the second fails.
    first = {"done": False}

    def flaky(*args, **kwargs):
        if first["done"]:
            raise RuntimeError("provider down")
        first["done"] = True
        return real(*args, **kwargs)

    monkeypatch.setattr(layer, "_send", flaky)
    got = say(team, "list my targets")
    message = of_kind(got, "message")[0]["message"]
    assert "can't be reached" in message["content"] and message["mode"] == "ai"


def test_old_conversations_are_deleted_by_the_daily_clean_up(team, model, db):
    as_user(team, "maya@example.com")
    model.then("Hello.")
    conversation = of_kind(say(team, "hi"), "conversation")[0]["conversation"]["id"]
    assert not schedules.daily(db)
    assert schedules.daily(db, datetime.now(UTC) + timedelta(days=91))
    assert db.get(Conversation, uuid.UUID(conversation)) is None


# ---------------------------------------------------------------- the tools themselves


def test_every_tool_is_well_formed_and_points_at_a_real_endpoint():
    from app.main import app

    routes = {
        (method.upper(), _shape(path))
        for path, methods in app.openapi()["paths"].items()
        for method in methods
    }
    for tool in tools.TOOLS:
        assert tool.method in {"GET", "POST", "PATCH", "PUT", "DELETE"}, tool.name
        assert set(tool.path_names()) <= set(tool.properties), tool.name
        assert set(tool.path_names()) <= set(tool.required), tool.name
        assert set(tool.required) <= set(tool.properties), tool.name
        assert set(tool.query) <= set(tool.properties), tool.name
        endpoint = (tool.method, _shape("/api/v1" + tool.path))
        assert endpoint in routes, f"{tool.name}: {tool.method} {tool.path} is no endpoint"
        if tool.kind == tools.WRITE:
            assert tool.action is not None and tool.summary is not None, tool.name
        else:
            assert tool.method == "GET", tool.name
        # Nothing that takes a secret, and nothing that deletes.
        assert not set(tool.properties) & tools.HIDDEN_KEYS, tool.name
        assert tool.method != "DELETE", tool.name


def _shape(path: str) -> str:
    """A path without its parameter names: /targets/{target_id} and /targets/{id} are one."""
    return re.sub(r"\{[^}]+\}", "{}", path)


def test_a_tool_never_reaches_the_model_or_page_with_a_secret():
    cleaned = tools.trim(
        {
            "name": "x",
            "credentials": [{"masked_value": "••••"}],
            "nested": {"api_key": "k", "ok": 1},
        }
    )
    assert cleaned == {"name": "x", "nested": {"ok": 1}}


def test_long_results_are_cut_for_the_model():
    cut = tools.trim({"items": [{"n": i, "text": "x" * 900} for i in range(40)]})
    assert len(cut["items"]) == tools.MAX_ITEMS + 1 and cut["items"][-1].startswith("… and 28 more")
    assert len(cut["items"][0]["text"]) <= tools.MAX_TEXT + 1


def test_each_role_is_offered_only_the_tools_it_may_use():
    names = lambda role: {t.name for t in tools.available(role)}  # noqa: E731
    assert "register_target" in names("target_owner") and "register_target" not in names(
        "security_analyst"
    )
    assert "decide_campaign_scope" in names(
        "security_manager"
    ) and "decide_campaign_scope" not in names("security_analyst")
    assert "launch_campaign_run" in names(
        "security_analyst"
    ) and "launch_campaign_run" not in names("org_admin")
    assert "start_autopilot" in names("security_analyst")
    assert "start_autopilot" not in names("org_admin") | names("target_owner")
    assert {"list_targets", "list_findings", "get_risk_overview"} <= names("org_admin")


def test_the_autopilot_tool_is_high_risk_and_waits_for_the_person():
    tool = next(t for t in tools.TOOLS if t.name == "start_autopilot")
    assert tool.kind == tools.WRITE and tool.risk == tools.HIGH
    assert "approve" in tool.summary({"target_id": "x"})


def test_the_guide_finds_the_topic_for_a_question():
    assert knowledge.relevant("how do I prove I own my target")[0].id == "verify-ownership"
    assert knowledge.relevant("pause a campaign run")[0].id == "launch-run"
    assert knowledge.relevant("zzzz") == []
    assert all(t.href.startswith("/") for t in knowledge.topics())


def test_admin_pages_list_the_assistant_as_a_model_task(db):
    from app.llm import LLMTask
    from app.modules.m10_admin import data_sharing, llm_providers

    assert (
        LLMTask.ASSISTANT in data_sharing.FUNCTIONS and LLMTask.ASSISTANT in llm_providers.FUNCTIONS
    )
