"""Slows down password guessing: 5 wrong passwords for one email in 15 minutes locks that email
out for the rest of the window. In-memory, so it covers one server process; behind several
instances the limit belongs at the proxy as well."""

from __future__ import annotations

import time
from collections import defaultdict, deque

WINDOW_SECONDS = 15 * 60
MAX_FAILURES = 5


class LoginThrottle:
    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _recent(self, key: str, now: float) -> deque[float]:
        failures = self._failures[key]
        while failures and now - failures[0] > WINDOW_SECONDS:
            failures.popleft()
        return failures

    def blocked(self, email: str, now: float | None = None) -> bool:
        return len(self._recent(email.lower(), time.time() if now is None else now)) >= MAX_FAILURES

    def fail(self, email: str, now: float | None = None) -> None:
        moment = time.time() if now is None else now
        self._recent(email.lower(), moment).append(moment)

    def succeed(self, email: str) -> None:
        self._failures.pop(email.lower(), None)
