"""Tests for the request and response formats of a target (FR-2.1, UC-2.1 step 3)."""

import json

import pytest

from app.modules.m02_targets.formats import extract, parse_path, render, template_problem


@pytest.mark.parametrize(
    ("template", "problem"),
    [
        ('{"session": "{{session_id}}", "input": "{{message}}"}', None),
        ('{"input": "{{ message }}"}', None),
        (
            '{"input": "{{prompt}}"}',
            "Unknown placeholder {{prompt}}. Use {{message}} or {{session_id}}.",
        ),
        ('{"session": "{{session_id}}"}', "Add {{message}} where Sentra's message goes."),
        (
            '{"input": {{message}}}',
            'The template must be valid JSON, with placeholders in quotes: "{{message}}".',
        ),
        (
            '["{{message}}"]',
            'The template must be a JSON object, such as {"input": "{{message}}"}.',
        ),
    ],
)
def test_request_templates_are_checked(template, problem):
    assert template_problem(template) == problem


@pytest.mark.parametrize(
    ("path", "steps"),
    [
        ("$.output.text", ["output", "text"]),
        ("$.choices[0].message.content", ["choices", 0, "message", "content"]),
        ("$['reply text'].value", ["reply text", "value"]),
        ("output.text", None),
        ("$", None),
        ("$..text", None),
    ],
)
def test_reply_locations_are_parsed(path, steps):
    assert parse_path(path) == steps


def test_placeholders_are_filled_safely():
    # Quotes and line breaks in a message must not break the JSON or add fields.
    body = render('{"session": "{{session_id}}", "input": "{{message}}"}', 'Say "hi"\nnow', "s-1")
    assert body == {"session": "s-1", "input": 'Say "hi"\nnow'}
    assert json.loads(json.dumps(body)) == body


def test_the_reply_is_found_in_the_response():
    response = {"choices": [{"message": {"content": "Hello", "tool_calls": []}}]}
    assert extract(response, "$.choices[0].message.content") == "Hello"
    assert extract(response, "$.choices[1].message.content") is None
    assert extract(response, "$.choices.message") is None  # a list has no key "message"
    assert extract({"output": "text"}, "$.output[0]") is None  # a string is not a list
