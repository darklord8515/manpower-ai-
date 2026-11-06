"""The Clock adapter: the only place the app asks what day it is.

Rule checks, expiry windows and alerts use `today()`, never `date.today()`. The demo can run on a
fixed, simulated date so the seeded data lines up with the screens (the simulated date is a setting,
never a request parameter, and it is refused in production).
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from app.config import Settings
from app.seed.data import SEED_TODAY


class Clock(Protocol):
    def today(self) -> date: ...


class SystemClock:
    def today(self) -> date:
        return date.today()


class SimulatedClock:
    def __init__(self, fixed: date) -> None:
        self._fixed = fixed

    def today(self) -> date:
        return self._fixed


def clock_for(settings: Settings) -> Clock:
    return SimulatedClock(SEED_TODAY) if settings.simulated_clock else SystemClock()
