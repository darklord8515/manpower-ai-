"""Command line: `python -m app.seed seed` or `python -m app.seed reset`.

These are what `make seed` and `make reset-demo` run.
"""

from __future__ import annotations

import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.ai.llm import client_for
from app.config import ConfigError, get_settings
from app.seed.load import reset_demo, seed_demo
from app.seed.trackers import load_trackers
from app.services.alerts.narrator import narrate_pending


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    if command not in {"seed", "reset", "load-trackers"}:
        print("usage: python -m app.seed [seed|reset|load-trackers]")  # noqa: T201
        return 2
    settings = get_settings()
    if command == "load-trackers":
        try:
            print("Loaded the trackers:", load_trackers(settings))  # noqa: T201
        except ConfigError as error:
            print(f"Refused: {error}")  # noqa: T201
            return 1
        return 0
    try:
        engine = create_engine(settings.migration_url)
        with engine.begin() as connection:
            reset_demo(connection, settings)
            if command == "seed":
                counts = seed_demo(connection, settings)
                print("Demo data loaded:", ", ".join(f"{n} {k}" for k, n in counts.items()))  # noqa: T201
            else:
                print("Demo data removed.")  # noqa: T201
        client = client_for(settings, "light") if command == "seed" else None
        if client is not None:  # the demo starts with its alerts already worded
            print("Wording the demo alerts with the light model ...")  # noqa: T201
            with Session(engine) as session:
                r = narrate_pending(session, client)
            print(  # noqa: T201
                f"Narrator: {r.narrated} worded, {r.rejected} kept their template "
                f"(failed the facts check), {r.failed + r.refused} failed."
            )
    except ConfigError as error:
        print(f"Refused: {error}")  # noqa: T201
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
