"""`make load-trackers`: put the client's two real trackers into the LOCAL database.

The demo data is removed first (the real and the fictional people would not mix), then the sign-in
accounts are made again and both workbooks are loaded. The files live in `private-data/` and never
leave the machine. It refuses to run with APP_ENV=production.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from argon2 import PasswordHasher
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import ConfigError, Settings
from app.seed.load import DEMO_USERS, DEPARTMENTS, demo_id, require_not_production, reset_demo
from app.services import tracker_import

REPO = Path(__file__).resolve().parents[4]


def find(pattern: str) -> Path:
    found = sorted((REPO / "private-data").glob(pattern))
    if not found:
        raise ConfigError(f"No file like {pattern} in private-data/.")
    return found[-1]


def load_trackers(settings: Settings) -> dict[str, Any]:
    require_not_production(settings)
    if not settings.demo_password:
        raise ConfigError("DEMO_PASSWORD is not set. Run `make env`, or add it to .env.")
    parsed = {
        "labour": tracker_import.parse_workbook(find("*Labour*.xlsx").read_bytes(), "labour"),
        "staff": tracker_import.parse_workbook(find("*Staff*.xlsx").read_bytes(), "staff"),
    }
    engine = create_engine(settings.migration_url)
    with engine.begin() as connection:
        reset_demo(connection, settings)
        departments = {code: demo_id("department", code) for code, _ in DEPARTMENTS}
        for code, name in DEPARTMENTS:
            connection.execute(
                text("INSERT INTO departments (id, code, name) VALUES (:id, :code, :name)"),
                {"id": departments[code], "code": code, "name": name},
            )
        password_hash = PasswordHasher().hash(settings.demo_password)
        for code, name, email in DEMO_USERS:
            user_id = demo_id("user", code)
            connection.execute(
                text(
                    """INSERT INTO users (id, email, full_name, password_hash, is_demo)
                       VALUES (:id, :email, :name, :hash, true)"""
                ),
                {"id": user_id, "email": email, "name": name, "hash": password_hash},
            )
            connection.execute(
                text(
                    """INSERT INTO user_roles (user_id, role_id)
                       SELECT :user_id, id FROM roles WHERE code = :role"""
                ),
                {"user_id": user_id, "role": code},
            )
        done: dict[str, Any] = {}
        with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
            for kind in ("staff", "labour"):  # staff first: the Projects sheet there has the codes
                done[kind] = tracker_import.apply(session, parsed[kind])
                done[f"{kind}_issues"] = parsed[kind].issue_count
            session.commit()
    return done
