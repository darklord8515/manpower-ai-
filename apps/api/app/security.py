"""Passwords and session tokens.

Passwords are argon2 hashes. A session is a signed, expiring token in an httpOnly cookie: the
server keeps no session table, so there is nothing to leak and nothing to expire by hand. The
token carries only the user id; roles and permissions are read from the database on every request,
so removing a role takes effect immediately.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import ConfigError

SESSION_COOKIE = "cq_session"
SESSION_SECONDS = 8 * 3600

_hasher = PasswordHasher()
# A real hash to compare against when the email is unknown, so the response takes as long as a
# wrong password and the two cannot be told apart by timing.
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _signature(secret: str, body: str) -> str:
    return _b64(hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest())


def create_session_token(user_id: str, secret: str, now: float | None = None) -> str:
    if not secret:
        raise ConfigError("SECRET_KEY is not set. Run `make env`.")
    issued = time.time() if now is None else now
    body = _b64(json.dumps({"sub": user_id, "exp": int(issued) + SESSION_SECONDS}).encode())
    return f"{body}.{_signature(secret, body)}"


def read_session_token(token: str, secret: str, now: float | None = None) -> str | None:
    """The user id inside a valid, unexpired token, otherwise None."""
    if not secret or token.count(".") != 1:
        return None
    body, signature = token.split(".")
    if not hmac.compare_digest(signature, _signature(secret, body)):
        return None
    try:
        payload = json.loads(_unb64(body))
        expires = int(payload["exp"])
        user_id = str(payload["sub"])
    except (ValueError, KeyError, TypeError):
        return None
    return user_id if expires > (time.time() if now is None else now) else None
