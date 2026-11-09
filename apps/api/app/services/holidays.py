"""UAE public holidays shown on the calendar.

Fixed-date holidays are certain. The Islamic ones follow the moon and the UAE announces them days
before, so they are marked `expected`: the calendar says so and HR confirms them (add an event) once
announced. This is an assumption to confirm with HR, not law, like the midday-ban dates.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Holiday:
    name: str
    starts: date
    ends: date
    expected: bool  # moon-sighted: the dates are the usual ones, not yet announced


HOLIDAYS: tuple[Holiday, ...] = (
    Holiday("Islamic New Year", date(2026, 6, 16), date(2026, 6, 16), True),
    Holiday("Prophet's Birthday", date(2026, 8, 25), date(2026, 8, 25), True),
    Holiday("Commemoration Day and National Day", date(2026, 12, 1), date(2026, 12, 3), False),
    Holiday("New Year's Day", date(2027, 1, 1), date(2027, 1, 1), False),
    Holiday("Eid al-Fitr", date(2027, 3, 9), date(2027, 3, 11), True),
    Holiday("Arafat Day and Eid al-Adha", date(2027, 5, 15), date(2027, 5, 18), True),
    Holiday("Islamic New Year", date(2027, 6, 6), date(2027, 6, 6), True),
    Holiday("Prophet's Birthday", date(2027, 8, 14), date(2027, 8, 14), True),
    Holiday("Commemoration Day and National Day", date(2027, 12, 1), date(2027, 12, 3), False),
)


def between(start: date, end: date) -> list[Holiday]:
    return [h for h in HOLIDAYS if h.starts <= end and h.ends >= start]
