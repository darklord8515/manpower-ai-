"""Sign in, sign out, and who am I."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.auth.deps import AuthUser, authenticated, load_user
from app.auth.throttle import LoginThrottle
from app.config import AppEnv, Settings, get_settings
from app.db import get_session
from app.schemas import DemoLoginRequest, LoginRequest, Me, PublicConfig
from app.security import SESSION_COOKIE, SESSION_SECONDS, create_session_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
throttle = LoginThrottle()

# The role switcher signs in as one of these seeded users through the normal session. It never
# skips the permission checks: the session it creates is an ordinary one for that user.
# Only two people sign in: HR and the MD. (The HR Executive role stays in the database.)
DEMO_ROLES = ("hr_manager", "ceo")

SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
CurrentUser = Annotated[AuthUser, Depends(authenticated())]


def _start_session(response: Response, user_id: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_session_token(user_id, settings.secret_key),
        max_age=SESSION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=settings.app_env in (AppEnv.DEMO, AppEnv.PRODUCTION),
        path="/",
    )


def _me(session: Session, user: AuthUser, settings: Settings) -> Me:
    landing = session.execute(
        text("SELECT dashboard FROM roles WHERE code = :code"), {"code": user.roles[0]}
    ).scalar_one_or_none()
    return Me(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        roles=list(user.roles),
        permissions=sorted(user.permissions),
        demo_mode=settings.demo_mode,
        landing=landing or "hr",
    )


@router.get("/config")
def public_config(settings: SettingsDep) -> PublicConfig:
    """What the sign-in page may know before anyone signs in."""
    return PublicConfig(demo_mode=settings.demo_mode)


@router.post("/login")
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
) -> Me:
    email = body.email.strip().lower()
    if throttle.blocked(email):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many attempts. Try again later.",
            headers={"Retry-After": str(throttle.retry_after(email))},
        )
    row = session.execute(
        text("SELECT id, password_hash FROM users WHERE email = :email AND is_active"),
        {"email": email},
    ).first()
    if row is None or not verify_password(row.password_hash, body.password):
        throttle.fail(email)
        write_audit(session, request, "auth.login_failed", "user")
        # The same message for an unknown email and a wrong password.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is not right")
    throttle.succeed(email)
    user = load_user(session, row.id)
    if user is None or not user.roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has no access yet")
    session.execute(text("UPDATE users SET last_login_at = now() WHERE id = :id"), {"id": user.id})
    write_audit(session, request, "auth.login", "user", user, user.id)
    _start_session(response, str(user.id), settings)
    return _me(session, user, settings)


@router.post("/demo-login")
def demo_login(
    body: DemoLoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
    settings: SettingsDep,
) -> Me:
    """Demo only: sign in as the seeded user for a role. Not found unless DEMO_MODE is on."""
    if not settings.demo_mode or body.role not in DEMO_ROLES:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    row = session.execute(
        text(
            """SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
               JOIN roles r ON r.id = ur.role_id
               WHERE u.is_demo AND u.is_active AND r.code = :role LIMIT 1"""
        ),
        {"role": body.role},
    ).first()
    user = load_user(session, row.id) if row else None
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    write_audit(session, request, "auth.demo_login", "user", user, user.id)
    _start_session(response, str(user.id), settings)
    return _me(session, user, settings)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, session: SessionDep, user: CurrentUser) -> None:
    write_audit(session, request, "auth.logout", "user", user, user.id)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me")
def me(session: SessionDep, settings: SettingsDep, user: CurrentUser) -> Me:
    return _me(session, user, settings)
