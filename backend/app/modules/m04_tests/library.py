"""Loads the built-in library (library/*.yaml) and keeps the database in step with it."""

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.m04_tests.models import TestDefinition
from app.modules.m04_tests.schema import LibraryFile, TestDefinitionSpec

LIBRARY_DIR = Path(__file__).parent / "library"
BUILT_IN = "built_in"


class LibraryError(Exception):
    """A library file is not valid. The message names the file and the problem."""


def load_library(directory: Path = LIBRARY_DIR) -> list[TestDefinitionSpec]:
    specs: list[TestDefinitionSpec] = []
    for path in sorted(directory.glob("*.yaml")):
        try:
            specs.extend(LibraryFile.model_validate(yaml.safe_load(path.read_text())).tests)
        except ValidationError as exc:
            raise LibraryError(f"{path.name}: {exc}") from exc
    codes = [spec.code for spec in specs]
    duplicates = sorted({code for code in codes if codes.count(code) > 1})
    if duplicates:
        raise LibraryError(f"duplicate test codes: {', '.join(duplicates)}")
    return specs


def content_hash(spec: TestDefinitionSpec) -> str:
    canonical = json.dumps(spec.model_dump(mode="json"), sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass
class SyncResult:
    added: int = 0
    updated: int = 0
    unchanged: int = 0


def sync_built_in_library(db: Session, specs: list[TestDefinitionSpec] | None = None) -> SyncResult:
    """New tests become version 1; a changed test gets a new current version (FR-4.5)."""
    result = SyncResult()
    for spec in specs if specs is not None else load_library():
        digest = content_hash(spec)
        current = db.scalar(
            select(TestDefinition).where(
                TestDefinition.code == spec.code,
                TestDefinition.origin == BUILT_IN,
                TestDefinition.is_current.is_(True),
            )
        )
        if current is not None and current.content_hash == digest:
            result.unchanged += 1
            continue
        if current is not None:
            current.is_current = False
            result.updated += 1
        else:
            result.added += 1
        db.add(
            TestDefinition(
                code=spec.code,
                version=current.version + 1 if current else 1,
                is_current=True,
                origin=BUILT_IN,
                organization_id=None,
                content_hash=digest,
                change_note="Updated built-in definition" if current else "Initial version",
                **spec.model_dump(mode="json", exclude={"code"}),
            )
        )
        db.flush()
    db.commit()
    return result
