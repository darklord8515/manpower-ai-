"""A worker's photo: HR adds, replaces or removes it; anyone who may read the worker sees it.

The picture is the raw request body (JPEG, PNG or WebP, up to 2 MB). The type is checked from the
file's own first bytes, not from what the browser says. It is kept in the storage backend and served
back only by this route, after the same permission and scope check as the worker's profile.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, require
from app.auth.scope import employee_scope
from app.config import Settings, get_settings
from app.db import get_session
from app.storage import StorageBackend, StorageError, storage_for

router = APIRouter(prefix="/workers", tags=["workers"])

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
Writer = Annotated[AuthUser, Depends(require("employee:write"))]
Reader = Annotated[AuthUser, Depends(require("employee:read"))]
MAX_BYTES = 2 * 1024 * 1024


def get_storage(settings: SettingsDep) -> StorageBackend:
    """The storage backend. Tests replace it with a temporary folder."""
    try:
        return storage_for(settings)
    except StorageError as error:
        raise HTTPException(503, str(error)) from error


Storage = Annotated[StorageBackend, Depends(get_storage)]


def image_type(data: bytes) -> tuple[str, str] | None:
    """(content type, extension) from the file's first bytes, or None if it is not a picture."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return None


def _worker(session: Session, user: AuthUser, permission: str, code: str) -> dict[str, object]:
    scope_sql, params = employee_scope(user, permission)
    row = (
        session.execute(
            text(
                f"""SELECT e.id, e.photo_key, e.photo_type FROM employees e
                    WHERE e.employee_code = :code AND ({scope_sql})"""  # noqa: S608
            ),
            {**params, "code": code},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Worker not found")
    return dict(row)


@router.get("/{code}/photo")
def get_photo(code: str, session: SessionDep, storage: Storage, user: Reader) -> Response:
    worker = _worker(session, user, "employee:read", code)
    data = storage.get(str(worker["photo_key"])) if worker["photo_key"] else None
    if data is None:
        raise HTTPException(404, "No photo")
    return Response(
        content=data,
        media_type=str(worker["photo_type"]),
        headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"},
    )


@router.put("/{code}/photo", status_code=204)
async def put_photo(
    code: str, request: Request, session: SessionDep, storage: Storage, user: Writer
) -> None:
    worker = _worker(session, user, "employee:write", code)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, "The photo is too big. Use one under 2 MB.")
    data = await request.body()
    if not data:
        raise HTTPException(422, "Choose a photo to upload.")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "The photo is too big. Use one under 2 MB.")
    kind = image_type(data)
    if kind is None:
        raise HTTPException(422, "Use a JPEG, PNG or WebP picture.")
    content_type, extension = kind
    key = f"photos/{worker['id']}.{extension}"
    try:
        storage.put(key, data)
        if worker["photo_key"] and worker["photo_key"] != key:
            storage.delete(str(worker["photo_key"]))
    except StorageError as error:
        raise HTTPException(503, str(error)) from error
    session.execute(
        text("UPDATE employees SET photo_key = :k, photo_type = :t WHERE id = :id"),
        {"k": key, "t": content_type, "id": worker["id"]},
    )
    write_audit(
        session, request, "worker.photo_set", "employee", user,
        entity_id=uuid.UUID(str(worker["id"])), after={"type": content_type, "bytes": len(data)},
    )  # fmt: skip


@router.delete("/{code}/photo", status_code=204)
def delete_photo(
    code: str, request: Request, session: SessionDep, storage: Storage, user: Writer
) -> None:
    worker = _worker(session, user, "employee:write", code)
    if not worker["photo_key"]:
        return
    try:
        storage.delete(str(worker["photo_key"]))
    except StorageError as error:
        raise HTTPException(503, str(error)) from error
    session.execute(
        text("UPDATE employees SET photo_key = NULL, photo_type = NULL WHERE id = :id"),
        {"id": worker["id"]},
    )
    write_audit(
        session, request, "worker.photo_removed", "employee", user,
        entity_id=uuid.UUID(str(worker["id"])),
    )  # fmt: skip
