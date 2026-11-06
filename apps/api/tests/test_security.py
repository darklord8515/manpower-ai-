from __future__ import annotations

from app.auth.throttle import MAX_FAILURES, WINDOW_SECONDS, LoginThrottle
from app.config import AppEnv, Settings, production_problems
from app.security import (
    SESSION_SECONDS,
    create_session_token,
    read_session_token,
    verify_password,
)

SECRET = "s" * 40  # noqa: S105


def test_a_session_token_returns_its_user_while_valid() -> None:
    token = create_session_token("user-1", SECRET, now=1000)
    assert read_session_token(token, SECRET, now=1001) == "user-1"


def test_a_tampered_token_is_rejected() -> None:
    token = create_session_token("user-1", SECRET, now=1000)
    body, signature = token.split(".")
    forged_body = create_session_token("user-2", SECRET, now=1000).split(".")[0]
    assert read_session_token(f"{forged_body}.{signature}", SECRET, now=1001) is None
    assert read_session_token(f"{body}.{signature[:-2]}xx", SECRET, now=1001) is None
    assert read_session_token("not-a-token", SECRET, now=1001) is None
    assert read_session_token("", SECRET, now=1001) is None


def test_a_token_signed_with_another_secret_is_rejected() -> None:
    token = create_session_token("user-1", "a" * 40, now=1000)
    assert read_session_token(token, "b" * 40, now=1001) is None


def test_a_token_expires() -> None:
    token = create_session_token("user-1", SECRET, now=1000)
    assert read_session_token(token, SECRET, now=1000 + SESSION_SECONDS - 1) == "user-1"
    assert read_session_token(token, SECRET, now=1000 + SESSION_SECONDS + 1) is None


def test_an_unknown_email_and_a_wrong_password_both_fail() -> None:
    from argon2 import PasswordHasher

    real = PasswordHasher().hash("right-password")
    assert verify_password(real, "right-password") is True
    assert verify_password(real, "wrong-password") is False
    assert verify_password(None, "anything") is False
    assert verify_password("not-a-hash", "anything") is False


def test_throttle_locks_an_email_after_five_failures_and_forgets_after_the_window() -> None:
    throttle = LoginThrottle()
    for i in range(MAX_FAILURES):
        assert not throttle.blocked("a@x.test", now=100 + i)
        throttle.fail("A@x.test", now=100 + i)
    assert throttle.blocked("a@x.test", now=110)
    assert not throttle.blocked("other@x.test", now=110)
    assert not throttle.blocked("a@x.test", now=100 + WINDOW_SECONDS + 10)
    throttle.fail("b@x.test", now=1)
    throttle.succeed("b@x.test")
    assert not throttle.blocked("b@x.test", now=2)


def test_production_refuses_the_demo_password() -> None:
    settings = Settings(app_env=AppEnv.PRODUCTION, demo_password="x")  # noqa: S106
    assert any("DEMO_PASSWORD" in problem for problem in production_problems(settings))
