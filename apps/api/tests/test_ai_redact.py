"""Restricted fields never reach a model, whatever the provider."""

from __future__ import annotations

import pytest

from app.ai.llm import ToolCall
from app.ai.redact import RedactionError, check_messages, find_restricted, strip_restricted


def test_restricted_keys_are_removed_at_any_depth() -> None:
    facts = {
        "name": "A",
        "doc_number": "N1234567",
        "people": [{"employee_code": "EMP-0001", "whatsapp_number": "+971501234567"}],
        "nested": {"contract_value_aed": 90000, "ok": 1},
    }
    assert strip_restricted(facts) == {
        "name": "A",
        "people": [{"employee_code": "EMP-0001"}],
        "nested": {"ok": 1},
    }


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ('{"doc_number": "x"}', "the field 'doc_number'"),
        ('{"phone":"x"}', "the field 'phone'"),
        ("Call him on +971 50 123 4567", "a phone number"),
        ("Mobile 050 123 4567", "a UAE mobile number"),
        ("Emirates ID 784-1990-1234567-1", "an Emirates ID number"),
        ("passport N1234567", "a passport number"),
    ],
)
def test_the_kind_of_restricted_field_is_named(text: str, kind: str) -> None:
    assert find_restricted(text) == kind


@pytest.mark.parametrize(
    "text",
    [
        "Sanjeev Rana: residency visa ends in 7 days (12 Nov 2026)",
        "MOB-2026-0107 reports 8 Nov 2026 with 2 tasks open",
        "2026-11-12T00:00:00+04:00",
        "SR-2026-0001 has waited 41 hours for approval",
        '{"employee_code": "EMP-0088", "days_left": 7}',
    ],
)
def test_ordinary_alert_text_is_not_mistaken_for_a_restricted_field(text: str) -> None:
    assert find_restricted(text) is None


def test_a_call_that_would_carry_a_restricted_field_is_refused_without_naming_the_value() -> None:
    messages = [
        {"role": "system", "content": "Word the alert."},
        {"role": "user", "content": "The worker's number is +971 50 123 4567."},
    ]
    with pytest.raises(RedactionError) as refusal:
        check_messages(messages)
    assert "a phone number" in str(refusal.value)
    assert "971" not in str(refusal.value)


def test_tool_call_arguments_are_checked_too() -> None:
    messages = [
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [ToolCall("c1", "search", {"query": "passport N1234567"})],
        }
    ]
    with pytest.raises(RedactionError):
        check_messages(messages)


def test_clean_messages_pass() -> None:
    check_messages([{"role": "user", "content": '<alert_data>{"days_left": 7}</alert_data>'}])
