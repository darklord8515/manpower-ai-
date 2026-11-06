"""The Home layout a person saves, and the by-trade numbers behind one of its widgets."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, add_user, sign_in

LAYOUT = {"order": ["by_trade", "expiry", "workforce"], "hidden": ["due"]}


def test_a_person_with_no_saved_layout_gets_none_so_the_default_is_used(
    client: TestClient,
) -> None:
    sign_in(client, HR_MANAGER)
    assert client.get("/auth/me/preferences").json() == {"home": None}


def test_a_saved_layout_is_returned_next_time_and_survives_a_new_session(
    make_client: Any,
) -> None:
    first, second = make_client(), make_client()
    sign_in(first, HR_MANAGER)
    saved = first.put("/auth/me/preferences", json={"home": LAYOUT})
    assert saved.status_code == 200 and saved.json() == {"home": LAYOUT}
    sign_in(second, HR_MANAGER)  # another browser, same person
    assert second.get("/auth/me/preferences").json() == {"home": LAYOUT}


def test_layouts_belong_to_one_person_only(make_client: Any) -> None:
    manager, executive = make_client(), make_client()
    sign_in(manager, HR_MANAGER)
    sign_in(executive, HR_EXECUTIVE)
    manager.put("/auth/me/preferences", json={"home": LAYOUT})
    assert executive.get("/auth/me/preferences").json() == {"home": None}


def test_going_back_to_the_default_clears_the_layout(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    client.put("/auth/me/preferences", json={"home": LAYOUT})
    assert client.put("/auth/me/preferences", json={"home": None}).status_code == 200
    assert client.get("/auth/me/preferences").json() == {"home": None}


@pytest.mark.parametrize(
    "layout",
    [
        {"order": ["expiry", "expiry"], "hidden": []},  # twice
        {"order": ["nonsense"], "hidden": []},  # not a widget
        {"order": [], "hidden": ["<script>"]},
        {"order": ["expiry"] * 21, "hidden": []},  # too many
        {"order": "expiry", "hidden": []},  # not a list
    ],
)
def test_only_known_widgets_can_be_stored(client: TestClient, layout: dict[str, Any]) -> None:
    sign_in(client, HR_MANAGER)
    response = client.put("/auth/me/preferences", json={"home": layout})
    assert response.status_code == 422, response.text
    assert client.get("/auth/me/preferences").json() == {"home": None}  # nothing was saved


def test_an_old_layout_with_a_widget_that_no_longer_exists_falls_back_to_the_default(
    client: TestClient, migrated_db: Engine
) -> None:
    sign_in(client, HR_MANAGER)
    with migrated_db.begin() as c:
        c.execute(
            text(
                """UPDATE users SET ui_preferences =
                       '{"home": {"order": ["retired_widget"], "hidden": []}}'
                   WHERE email = :email"""
            ),
            {"email": HR_MANAGER},
        )
    assert client.get("/auth/me/preferences").json() == {"home": None}


def test_preferences_need_a_sign_in(client: TestClient) -> None:
    assert client.get("/auth/me/preferences").status_code == 401
    assert client.put("/auth/me/preferences", json={"home": None}).status_code == 401


def test_by_trade_numbers_add_up_to_the_workforce(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    rows = client.get("/summary/trades").json()
    summary = client.get("/summary").json()
    assert sum(r["total"] for r in rows) == summary["workforce"]["total"] == 150
    for key in ("deployed", "mobilizing", "available", "unavailable"):
        assert sum(r[key] for r in rows) == summary["workforce"][key]
    by_name = {r["trade"]: r for r in rows}
    assert by_name["Steel fixer"]["group"] == "Structure"
    assert all(
        r["total"] == sum(r[k] for k in ("deployed", "mobilizing", "available", "unavailable"))
        for r in rows
    )


def test_by_trade_follows_the_callers_scope(client: TestClient, migrated_db: Engine) -> None:
    add_user(migrated_db, "pm@constructiq.test", "project_manager", projects=("RAK-03",))
    sign_in(client, "pm@constructiq.test")
    rows = client.get("/summary/trades").json()
    assert 0 < sum(r["total"] for r in rows) < 150  # only people on their project


def test_the_ceo_can_read_by_trade_and_a_stranger_cannot(
    make_client: Any, migrated_db: Engine
) -> None:
    ceo, nobody = make_client(), make_client()
    sign_in(ceo, CEO)
    assert ceo.get("/summary/trades").status_code == 200
    add_user(migrated_db, "nobody@constructiq.test", "service_n8n")
    sign_in(nobody, "nobody@constructiq.test")
    assert nobody.get("/summary/trades").status_code == 403
