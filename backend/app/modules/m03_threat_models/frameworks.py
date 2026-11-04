"""The frameworks threats are mapped to (FR-3.2): the OWASP Top 10 for LLM Applications (2025)
and MITRE ATLAS."""

import re

from app.modules.m04_tests.schema import CATEGORY_NAMES, OUT_OF_SCOPE

# Every OWASP category may be named in a threat model. LLM03 and LLM09 are outside application
# testing, so no test of the library covers them (Screen 43).
OWASP_NAMES: dict[str, str] = dict(CATEGORY_NAMES)
OWASP_OUT_OF_SCOPE: set[str] = set(OUT_OF_SCOPE)

ATLAS_PATTERN = re.compile(r"AML\.T\d{4}(\.\d{3})?")

# The techniques that the baseline rules and the test library use, with their names in the
# ATLAS data (atlas.mitre.org, checked on 2026-11-04, ATLAS 2026.10). Any other well-formed
# technique ID may be entered too; it is shown without a name.
ATLAS_NAMES: dict[str, str] = {
    "AML.T0029": "Denial of AI Service",
    "AML.T0034": "Cost Harvesting",
    "AML.T0051": "LLM Prompt Injection",
    "AML.T0051.000": "LLM Prompt Injection: Direct",
    "AML.T0051.001": "LLM Prompt Injection: Indirect",
    "AML.T0053": "AI Agent Tool Invocation",
    "AML.T0054": "LLM Jailbreak",
    "AML.T0056": "Extract LLM System Prompt",
    "AML.T0057": "LLM Data Leakage",
    "AML.T0070": "RAG Poisoning",
    "AML.T0085.000": "Data from AI Services: RAG Databases",
    "AML.T0085.002": "Data from AI Services: Conversation Context and Memory",
    "AML.T0085.003": "Data from AI Services: System Instructions",
}

# ATLAS 2026.10 (28 October 2026) retired these. Stored threat models, findings and old versions of
# tests keep the ID they were made with, so the names above stay; nothing new uses them.
ATLAS_RETIRED: dict[str, str] = {
    "AML.T0056": "AML.T0085.003",
    "AML.T0057": "AML.T0085.002",
}


def clean_owasp(codes: list[str]) -> list[str]:
    """The valid category codes, upper case, each once, in order."""
    result: list[str] = []
    for code in codes:
        code = str(code).strip().upper()
        if code in OWASP_NAMES and code not in result:
            result.append(code)
    return result


def valid_atlas(technique: str | None) -> bool:
    return technique is not None and ATLAS_PATTERN.fullmatch(technique) is not None
