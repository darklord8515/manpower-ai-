"""Who is calling, and may they do this?

`require("resource:action")` is on every route that is not public. The permission and its scope
come from the database (roles -> role_permissions), never from the token.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.clock import Clock, clock_for
from app.config import Settings, get_settings
from app.db import get_session
from app.security import SESSION_COOKIE, read_session_token

# Widest wins when a user holds several roles.
_SCOPE_RANK = {"own": 0, "site": 1, "project": 2, "department": 3, "all": 4}

AUTHENTICATED = "authenticated"  # marker for routes that need a login but no specific permission


@dataclass(frozen=True)
class AuthUser:
    id: uuid.UUID
    email: str
    full_name: str
    employee_id: uuid.UUID | None
    roles: tuple[str, ...]
    permissions: dict[str, str]  # permission code -> widest scope
    whole_projects: frozenset[uuid.UUID] = frozenset()
    sites: frozenset[uuid.UUID] = frozenset()

    def can(self, permission: str) -> bool:
        return permission in self.permissions

    def scope(self, permission: str) -> str | None:
        return self.permissions.get(permission)


def load_user(session: Session, user_id: uuid.UUID) -> AuthUser | None:
    row = (
        session.execute(
            text(
                """SELECT id, email::text AS email, full_name, employee_id
                   FROM users WHERE id = :id AND is_active"""
            ),
            {"id": user_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    roles = tuple(
        r[0]
        for r in session.execute(
            text(
                """SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                   WHERE ur.user_id = :id ORDER BY r.code"""
            ),
            {"id": user_id},
        )
    )
    permissions: dict[str, str] = {}
    for code, scope in session.execute(
        text(
            """SELECT p.code, rp.scope::text FROM user_roles ur
               JOIN role_permissions rp ON rp.role_id = ur.role_id
               JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = :id"""
        ),
        {"id": user_id},
    ):
        if code not in permissions or _SCOPE_RANK[scope] > _SCOPE_RANK[permissions[code]]:
            permissions[code] = scope
    access = session.execute(
        text("SELECT project_id, site_id FROM user_project_access WHERE user_id = :id"),
        {"id": user_id},
    ).all()
    return AuthUser(
        id=row["id"],
        email=row["email"],
        full_name=row["full_name"],
        employee_id=row["employee_id"],
        roles=roles,
        permissions=permissions,
        whole_projects=frozenset(p for p, s in access if s is None),
        sites=frozenset(s for _, s in access if s is not None),
    )


def get_clock(settings: Annotated[Settings, Depends(get_settings)]) -> Clock:
    return clock_for(settings)


def current_user(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthUser:
    token = request.cookies.get(SESSION_COOKIE)
    user_id = read_session_token(token, settings.secret_key) if token else None
    user = None
    if user_id:
        try:
            user = load_user(session, uuid.UUID(user_id))
        except ValueError:
            user = None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue")
    return user


def authenticated() -> Callable[..., AuthUser]:
    """A login is enough (for example, /auth/me)."""

    def dependency(user: Annotated[AuthUser, Depends(current_user)]) -> AuthUser:
        return user

    dependency.permission = AUTHENTICATED  # type: ignore[attr-defined]
    return dependency


def require(permission: str) -> Callable[..., AuthUser]:
    """Use as `user: AuthUser = Depends(require("employee:read"))`."""

    def dependency(user: Annotated[AuthUser, Depends(current_user)]) -> AuthUser:
        if not user.can(permission):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this")
        return user

    dependency.permission = permission  # type: ignore[attr-defined]
    return dependency
