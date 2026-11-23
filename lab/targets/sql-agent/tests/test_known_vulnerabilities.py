"""The form of the hand-written parts of this lab target (FR-11.1).

The weaknesses themselves and the data that carries them are written by the person who owns the
lab targets (`docs/build-work/SAFETY-STOPS-PLAN.md`). These tests never say what a weakness should
be; they check that the documented list, the rules and the behaviour cannot drift apart, and that
the synthetic data keeps to reserved example addresses, so nothing in the lab points at a real
place.
"""

import re
from pathlib import Path

from app import weakness
from app.main import KNOWN_VULNERABILITIES, SLOTS, state

PREFIX = "SQL"
ROOT = Path(__file__).resolve().parent.parent
ID = re.compile(rf"\b{PREFIX}-\d{{2}}\b")
OWASP = {f"LLM{number:02d}" for number in range(1, 11)}
IN_URL = re.compile(r"https?://([^/\s)\"'<>]+)")
IN_EMAIL = re.compile(r"[\w.+-]+@([\w-]+\.[\w.-]+)")
RESERVED = re.compile(r"(^|\.)(example\.(com|org|net)|[a-z0-9-]+\.example)$", re.I)
DOCUMENTS = [ROOT / "KNOWN_VULNERABILITIES.md", ROOT / "README.md"]
DATA = [
    path
    for path in sorted((ROOT / "app").rglob("*"))
    if path.is_file() and path.suffix in {".json", ".md", ".sql", ".txt"}
]


def test_every_documented_weakness_has_the_fields_the_lab_needs():
    for entry in KNOWN_VULNERABILITIES:
        for field in ("id", "title", "category", "description"):
            assert isinstance(entry.get(field), str) and entry[field].strip(), (entry, field)
        assert ID.fullmatch(entry["id"]), entry["id"]
        assert entry["category"] in OWASP, entry["category"]


def test_the_identifiers_are_unique():
    identifiers = [entry["id"] for entry in KNOWN_VULNERABILITIES]

    assert len(identifiers) == len(set(identifiers))


def test_a_named_canary_token_is_one_this_target_plants():
    planted = set(state["canaries"])

    for entry in KNOWN_VULNERABILITIES:
        if entry.get("canary"):
            assert entry["canary"] in planted, entry["canary"]


def test_every_canary_token_is_planted_in_a_slot_sentra_knows():
    # The seven slots of app/modules/m02_targets/canaries.py; sync_lab() drops any other name.
    known = {
        "system_instructions",
        "test_document",
        "restricted_document",
        "other_account",
        "personal_data",
        "secret_value",
        "forbidden_phrase",
    }

    assert {slot for _, slot, _ in SLOTS} <= known
    assert {name for name, _, _ in SLOTS} == set(state["canaries"])


def test_a_written_rule_and_a_documented_weakness_are_the_same_set():
    assert set(weakness.declared()) == {entry["id"] for entry in KNOWN_VULNERABILITIES}


def test_the_table_and_the_list_name_the_same_weaknesses():
    table = (ROOT / "KNOWN_VULNERABILITIES.md").read_text()

    assert set(ID.findall(table)) == {entry["id"] for entry in KNOWN_VULNERABILITIES}


def test_nothing_in_the_lab_target_points_at_a_real_address():
    for path in DOCUMENTS + DATA:
        text = path.read_text()
        for host in IN_URL.findall(text):
            assert RESERVED.search(host.split(":")[0]), f"{path.name}: {host}"
        for domain in IN_EMAIL.findall(text):
            assert RESERVED.search(domain), f"{path.name}: {domain}"
