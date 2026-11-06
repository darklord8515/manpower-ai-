"""Command line: `python -m app.seed seed` or `python -m app.seed reset`.

These are what `make seed` and `make reset-demo` run.
"""

from __future__ import annotations

import sys

from sqlalchemy import create_engine

from app.config import ConfigError, get_settings
from app.seed.load import reset_demo, seed_demo


def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else ""
    if command not in {"seed", "reset"}:
        print("usage: python -m app.seed [seed|reset]  (seed = reset, then load)")  # noqa: T201
        return 2
    settings = get_settings()
    try:
        engine = create_engine(settings.migration_url)
        with engine.begin() as connection:
            reset_demo(connection, settings)
            if command == "seed":
                counts = seed_demo(connection, settings)
                print("Demo data loaded:", ", ".join(f"{n} {k}" for k, n in counts.items()))  # noqa: T201
            else:
                print("Demo data removed.")  # noqa: T201
    except ConfigError as error:
        print(f"Refused: {error}")  # noqa: T201
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
