"""The Clock adapter: the only place the app asks what day (or what time) it is.

Rule checks, expiry windows and alerts use `today()` and `now()`, never `date.today()` or
`datetime.now()`. The demo can run on a fixed, simulated date so the seeded data lines up with the
screens (the simulated date is a setting, never a request parameter, and it is refused in
production). On the simulated date `now()` is 09:00 Gulf time, so rules that count hours (an
approval waiting 24 hours, an alert escalating after 4) behave the same every time the demo runs.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta, timezone
from typing import Protocol

from app.config import Settings
from app.seed.data import SEED_TODAY

GULF = timezone(timedelta(hours=4))  # UAE has no daylight saving


class Clock(Protocol):
    def today(self) -> date: ...

    def now(self) -> datetime: ...


class SystemClock:
    def today(self) -> date:
        return date.today()

    def now(self) -> datetime:
        return datetime.now(UTC)


class SimulatedClock:
    def __init__(self, fixed: date) -> None:
        self._fixed = fixed

    def today(self) -> date:
        return self._fixed

    def now(self) -> datetime:
        return datetime.combine(self._fixed, time(9, 0), tzinfo=GULF)


def clock_for(settings: Settings) -> Clock:
    return SimulatedClock(SEED_TODAY) if settings.simulated_clock else SystemClock()
