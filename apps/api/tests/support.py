"""Plain helpers shared by the API tests (the fixtures are in conftest.py)."""

from __future__ import annotations

import uuid

from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.config import AppEnv, Settings

PASSWORD = "a-demo-password-for-tests"  # noqa: S105
HR_MANAGER = "noura.demo@constructiq.test"
HR_EXECUTIVE = "priya.demo@constructiq.test"
CEO = "layla.demo@constructiq.test"


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": AppEnv.TEST,
        "demo_mode": True,
        "simulated_clock": True,
        "demo_password": PASSWORD,
        "secret_key": "k" * 40,
        "cors_origins": "http://localhost:3000",
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def sign_in(client: TestClient, email: str, password: str = PASSWORD) -> None:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text


def add_user(
    engine: Engine,
    email: str,
    role: str,
    employee_code: str | None = None,
    projects: tuple[str, ...] = (),
) -> None:
    """A user with one role, optionally linked to a worker and with access to projects."""
    user_id = uuid.uuid4()
    with engine.begin() as c:
        employee = (
            c.execute(
                text("SELECT id FROM employees WHERE employee_code = :c"), {"c": employee_code}
            ).scalar_one()
            if employee_code
            else None
        )
        c.execute(
            text(
                """INSERT INTO users (id, email, full_name, password_hash, employee_id, is_demo)
                   VALUES (:id, :email, :name, :hash, :employee, true)"""
            ),
            {"id": user_id, "email": email, "name": email.split("@")[0],
             "hash": PasswordHasher().hash(PASSWORD), "employee": employee},
        )  # fmt: skip
        c.execute(
            text(
                "INSERT INTO user_roles (user_id, role_id) SELECT :u, id FROM roles WHERE code = :r"
            ),
            {"u": user_id, "r": role},
        )
        for code in projects:
            c.execute(
                text(
                    """INSERT INTO user_project_access (user_id, project_id)
                       SELECT :u, id FROM projects WHERE code = :p"""
                ),
                {"u": user_id, "p": code},
            )
