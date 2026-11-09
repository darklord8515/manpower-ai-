"""Where uploaded files live. One interface; the implementation is picked by STORAGE_BACKEND.

Local disk is for development and the demo. An S3-compatible bucket (Cloudflare R2) is the hosted
choice and arrives with hosting; until then asking for it fails with a clear message instead of
quietly writing to disk. Files are only ever returned through a route that checks the caller's
permission and scope, never by a public address.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.config import Settings


class StorageError(RuntimeError):
    """The file could not be stored or read. Worded for whoever pressed the button."""


class StorageBackend(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes | None: ...
    def delete(self, key: str) -> None: ...


class LocalStorage:
    def __init__(self, root: str) -> None:
        self._root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        path = (self._root / key).resolve()
        if self._root not in path.parents:  # a key can never climb out of the folder
            raise StorageError("That file name is not allowed.")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


def storage_for(settings: Settings) -> StorageBackend:
    if settings.storage_backend == "local":
        return LocalStorage(settings.storage_local_dir)
    raise StorageError("File storage for the hosted setup is not connected yet.")
