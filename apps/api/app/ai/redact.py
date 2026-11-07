"""Restricted fields never reach a model, whatever the provider (CLAUDE.md, docs/agents.md).

The first defence is structural: tools and prompts are built from the candidate projection, so the
fields are simply not there. This is the second: every outgoing message is scanned, and a call that
would carry a restricted field is refused before it is sent. The error names what was found (a key,
or the kind of value), never the value itself.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any, cast

from app.ai.llm import ToolCall

# Keys that hold something a model must never see. No salary data exists in this system.
FORBIDDEN_KEYS = frozenset(
    {
        "doc_number",
        "passport_number",
        "emirates_id",
        "contract_value_aed",
        "phone",
        "whatsapp_number",
    }
)

_KEY = re.compile(r'"(' + "|".join(sorted(FORBIDDEN_KEYS)) + r')"\s*:')
_VALUES = (
    ("a phone number", re.compile(r"\+\d[\d \-]{8,}\d")),
    ("a UAE mobile number", re.compile(r"\b0?5\d[ \-]?\d{3}[ \-]?\d{4}\b")),
    ("an Emirates ID number", re.compile(r"\b784-?\d{4}-?\d{7}-?\d\b")),
    ("a passport number", re.compile(r"\b[A-Z]{1,2}\d{7,8}\b")),
)


class RedactionError(ValueError):
    """A model call was about to carry a restricted field. It is refused, not sent."""


def strip_restricted(value: Any) -> Any:
    """A copy of a JSON-like value without the restricted keys, at any depth."""
    if isinstance(value, dict):
        items = cast("dict[str, Any]", value).items()
        return {k: strip_restricted(v) for k, v in items if k not in FORBIDDEN_KEYS}
    if isinstance(value, list):
        return [strip_restricted(v) for v in cast("list[Any]", value)]
    return value


def find_restricted(text: str) -> str | None:
    """What kind of restricted field the text carries, or None. Never returns the value."""
    key = _KEY.search(text)
    if key:
        return f"the field '{key.group(1)}'"
    for kind, pattern in _VALUES:
        if pattern.search(text):
            return kind
    return None


def check_messages(messages: Sequence[dict[str, Any]]) -> None:
    """Refuse the whole call if any message (or tool-call argument) carries a restricted field."""
    for m in messages:
        parts = [str(m.get("content") or "")]
        calls = cast("list[ToolCall]", m.get("tool_calls") or [])
        parts += [json.dumps(c.arguments) for c in calls]
        for part in parts:
            found = find_restricted(part)
            if found:
                raise RedactionError(f"A model call would have carried {found}")
