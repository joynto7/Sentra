"""The object storage (architecture: Object Storage; FR-6.3, NFR-6.2): content too large for the
database, such as evidence documents over 64 KB, and later generated reports and exports.

An object is written once and never changed: put() refuses a key that exists, and the file is
made read-only. Its SHA-256 checksum is kept in the database by the caller, so a change made
anyway shows when the object is read again (NFR-2.4).

Sprint 2 keeps the objects in a local directory (object_storage_dir), a Docker volume that the API
and the workers share. An S3-compatible store (architecture 2.5) is one more class with the same
put() and get() when a deployment needs it.
"""

import os
import re
import uuid
from functools import cache
from pathlib import Path

from app.core.config import get_settings

# Sentra makes every key itself, e.g. evidence/<organization>/<finding>/<evidence>.json; the check
# keeps a wrong key from ever reaching outside the directory.
_KEY = re.compile(r"[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*")


class StorageError(Exception):
    pass


class ObjectExists(StorageError):
    """put(): an object with this key is already stored, and objects are never replaced."""


class ObjectMissing(StorageError):
    """get(): no object with this key is stored (any more)."""


class LocalStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        if not _KEY.fullmatch(key) or ".." in key:
            raise StorageError(f"Not a valid object key: {key!r}")
        return self.root.joinpath(*key.split("/"))

    def put(self, key: str, data: bytes) -> None:
        """Writes the object once. It is first written under a temporary name and then linked to
        its key, so a reader never finds half an object, and the link fails if the key exists."""
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with open(temporary, "xb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            os.chmod(temporary, 0o444)  # read-only, also for Sentra itself
            try:
                os.link(temporary, path)
            except FileExistsError as exc:
                raise ObjectExists(f"The object {key} is already stored.") from exc
        finally:
            temporary.unlink(missing_ok=True)

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError as exc:
            raise ObjectMissing(f"The object {key} isn't stored.") from exc


@cache
def backend() -> LocalStorage:
    return LocalStorage(get_settings().object_storage_dir)


def put(key: str, data: bytes) -> None:
    backend().put(key, data)


def get(key: str) -> bytes:
    return backend().get(key)
