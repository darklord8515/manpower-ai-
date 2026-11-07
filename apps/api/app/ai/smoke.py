"""`make ai-smoke`: one real call to the light model on the most urgent alert, saving nothing.

Run it after putting a model and key in `.env` to see that the provider answers, what the narrator
writes, and whether the wording passes the facts check.
"""

from __future__ import annotations

from app.ai.faithful import all_faithful, allowed_tokens
from app.ai.llm import LLMError, client_for
from app.ai.runtime import InvalidOutput, structured_call
from app.config import get_settings
from app.db import get_session_factory
from app.services.alerts import narrator


def main() -> int:
    settings = get_settings()
    client = client_for(settings, "light")
    if client is None:
        print(  # noqa: T201
            "The light tier is off. Set LLM_TIER_LIGHT_MODEL and LLM_TIER_LIGHT_BASE_URL "
            "(and LLM_TIER_LIGHT_API_KEY) in .env."
        )
        return 1
    with get_session_factory()() as session:
        rows = narrator.pending(session, 1)
    if not rows:
        print("No alert needs wording (run `make seed` first).")  # noqa: T201
        return 1
    row = rows[0]
    print(f"Model {client.model}, alert: {row['title']}")  # noqa: T201
    try:
        done = structured_call(client, narrator.prompt_for(row), narrator.Narration, max_tokens=700)
    except (LLMError, InvalidOutput) as error:
        print(f"FAILED: {error}")  # noqa: T201
        return 1
    said = done.value
    invented = all_faithful(
        [said.title, said.explanation, *(a.label for a in said.actions)],
        allowed_tokens(row["facts_json"], row["title"], row["explanation"]),
    )
    print(f"Title:       {said.title}")  # noqa: T201
    print(f"Explanation: {said.explanation}")  # noqa: T201
    print(f"Actions:     {', '.join(f'{a.action} = {a.label}' for a in said.actions)}")  # noqa: T201
    print(f"Tokens:      {done.input_tokens} in, {done.output_tokens} out")  # noqa: T201
    print("Facts check: " + ("passed" if not invented else f"FAILED, states {', '.join(invented)}"))  # noqa: T201
    return 0 if not invented else 1


if __name__ == "__main__":
    raise SystemExit(main())
