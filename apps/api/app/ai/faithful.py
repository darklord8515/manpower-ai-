"""Is what a model wrote made only of facts Python gave it? (ALERT_NARRATION_FAITHFUL)

Every number, date, time and code (project, employee, request, mobilization) in the model's text
must appear in the sources it was given. The check does not judge style or meaning; it stops a model
from stating a figure, a date or a code that Python never produced. Names and ordinary words are
not checked.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import date
from typing import Any, cast

_MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec"
_ISO = re.compile(
    r"\b(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?"
)
_DATE = re.compile(rf"\b(\d{{1,2}}) ({_MONTHS})(?: (\d{{4}}))?\b")
_CODE = re.compile(r"\b[A-Z]{2,5}-(?:[A-Za-z0-9]+-)*\d[A-Za-z0-9]*\b")
_TIME = re.compile(r"\b\d{1,2}:\d{2}\b")
_NUMBER = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")


def _iso_to_words(text: str) -> str:
    """2026-11-12 (or a full timestamp) becomes '12 Nov 2026', the way alerts write dates."""

    def swap(m: re.Match[str]) -> str:
        try:
            d = date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return m[0]
        return f"{d.day} {d:%b %Y}"

    return _ISO.sub(swap, text)


def _number(raw: str) -> str:
    value = raw.replace(",", "")
    if "." in value:
        value = value.rstrip("0").rstrip(".")
    return str(int(value)) if value.isdigit() else value


def _date_token(m: re.Match[str]) -> str:
    return f"date:{int(m[1])} {m[2]}" + (f" {m[3]}" if m[3] else "")


def _code_token(m: re.Match[str]) -> str:
    return f"code:{m[0]}"


def _time_token(m: re.Match[str]) -> str:
    return f"time:{m[0].zfill(5)}"


def _number_token(m: re.Match[str]) -> str:
    return f"number:{_number(m[0])}"


_KINDS = (
    (_DATE, _date_token),
    (_CODE, _code_token),
    (_TIME, _time_token),
    (_NUMBER, _number_token),
)


def tokens(text: str) -> set[str]:
    """The checkable pieces of a text: dates, codes, times and numbers, as normalised tokens."""
    found: set[str] = set()
    text = _iso_to_words(text)
    for pattern, make in _KINDS:
        for m in pattern.finditer(text):
            found.add(make(m))
        text = pattern.sub(" ", text)  # what was taken is not read again as smaller pieces
    return found


def _flatten(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(_flatten(v) for v in cast("dict[str, Any]", value).values())
    if isinstance(value, (list, tuple, set, frozenset)):
        return " ".join(_flatten(v) for v in cast("Iterable[Any]", value))
    if value is None or isinstance(value, bool):
        return ""
    return str(value)


def allowed_tokens(*sources: Any) -> set[str]:
    """Everything a model may repeat: the tokens of the facts (and wording) it was given."""
    allowed: set[str] = set()
    for source in sources:
        allowed |= tokens(_flatten(source))
    # "12 Nov" is the same day as "12 Nov 2026": a year left off is not a new date.
    allowed |= {t.rsplit(" ", 1)[0] for t in allowed if t.startswith("date:") and t.count(" ") == 2}
    return allowed


def unfaithful(text: str, allowed: set[str]) -> list[str]:
    """What the text states that its sources do not: empty means it is faithful."""
    return sorted(t.split(":", 1)[1] for t in tokens(text) - allowed)


def all_faithful(texts: Iterable[str], allowed: set[str]) -> list[str]:
    bad: set[str] = set()
    for text in texts:
        bad |= set(unfaithful(text, allowed))
    return sorted(bad)
