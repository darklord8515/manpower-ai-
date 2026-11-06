"""A person's own screen preferences: how they arranged their Home.

Only the layout is stored here: which widgets, in which order, which are hidden. It is a convenience
for that one person; it never changes what anyone is allowed to see, and the widget ids are checked
against a fixed list so the column cannot be used to store anything else.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser, authenticated
from app.db import get_session
from app.schemas import HomeLayout, Preferences

router = APIRouter(prefix="/auth/me/preferences", tags=["preferences"])

SessionDep = Annotated[Session, Depends(get_session)]
CurrentUser = Annotated[AuthUser, Depends(authenticated())]


def _read(session: Session, user: AuthUser) -> Preferences:
    stored: Any = session.execute(
        text("SELECT ui_preferences FROM users WHERE id = :id"), {"id": user.id}
    ).scalar_one()
    home: Any = None
    if isinstance(stored, dict) and "home" in stored:
        home = stored["home"]  # type: ignore[reportUnknownVariableType]
    try:
        return Preferences(home=HomeLayout.model_validate(home) if home else None)
    except ValueError:
        return Preferences(home=None)  # an old layout that no longer fits: use the default


@router.get("")
def get_preferences(session: SessionDep, user: CurrentUser) -> Preferences:
    return _read(session, user)


@router.put("")
def put_preferences(body: Preferences, session: SessionDep, user: CurrentUser) -> Preferences:
    """Save the layout (or clear it with `home: null` to go back to the default)."""
    value = {"home": body.home.model_dump()} if body.home else {}
    session.execute(
        text("UPDATE users SET ui_preferences = CAST(:value AS jsonb) WHERE id = :id"),
        {"value": json.dumps(value), "id": user.id},
    )
    session.commit()
    return body
