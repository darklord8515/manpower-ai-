"""One structured model call: redacted first, validated, and retried once with the problem named."""

from __future__ import annotations

import pytest
from pydantic import BaseModel, Field

from app.ai.redact import RedactionError
from app.ai.runtime import InvalidOutput, structured_call
from tests.support import ScriptedLLM

MESSAGES = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]


class Answer(BaseModel):
    title: str = Field(max_length=20)
    count: int


def test_a_valid_reply_is_returned_with_its_token_use() -> None:
    model = ScriptedLLM(['{"title": "Fine", "count": 3}'])
    done = structured_call(model, MESSAGES, Answer)
    assert done.value == Answer(title="Fine", count=3)
    assert (done.input_tokens, done.output_tokens) == (10, 20)
    assert len(model.calls) == 1


def test_an_invalid_reply_gets_one_retry_that_names_the_problem() -> None:
    model = ScriptedLLM(
        [
            '{"title": "A title that is far too long to fit", "count": 3}',
            '{"title": "Ok", "count": 3}',
        ]
    )
    done = structured_call(model, MESSAGES, Answer)
    assert done.value.title == "Ok"
    assert len(model.calls) == 2
    retry = model.calls[1]
    assert retry[-2]["role"] == "assistant"  # the model sees its own bad reply
    assert "not valid" in retry[-1]["content"] and "title" in retry[-1]["content"]
    assert (done.input_tokens, done.output_tokens) == (20, 40)  # both calls are counted


def test_prose_instead_of_json_is_also_retried_once() -> None:
    model = ScriptedLLM(["Sure! The alert is urgent.", '```json\n{"title": "Ok", "count": 1}\n```'])
    assert structured_call(model, MESSAGES, Answer).value.count == 1


def test_two_bad_replies_end_the_run_with_no_third_try() -> None:
    model = ScriptedLLM(["nonsense", '{"title": "Ok"}'])
    with pytest.raises(InvalidOutput) as failure:
        structured_call(model, MESSAGES, Answer)
    assert len(model.calls) == 2
    assert "count" in str(failure.value)
    assert (failure.value.input_tokens, failure.value.output_tokens) == (20, 40)


def test_a_restricted_field_stops_the_call_before_anything_is_sent() -> None:
    model = ScriptedLLM([])
    dirty = [*MESSAGES, {"role": "user", "content": '{"doc_number": "N1234567"}'}]
    with pytest.raises(RedactionError):
        structured_call(model, dirty, Answer)
    assert model.calls == []
