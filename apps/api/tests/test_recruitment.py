"""Recruitment requests: raising one, the pipeline, splitting, and who still needs a replacement."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, sign_in


def raise_request(client: TestClient, **changes: Any) -> Any:
    body: dict[str, Any] = {
        "project": "RAK-07",
        "trade": "mason",
        "headcount": 4,
        "needed_by": "2027-01-13",
        "source": "overseas",
        "reason": "Four masons short for the new logistics hub",
    }
    body.update(changes)
    return client.post("/recruitment-requests", json=body)


def listing(client: TestClient) -> dict[str, Any]:
    response = client.get("/recruitment-requests")
    assert response.status_code == 200, response.text
    return response.json()


def test_the_seeded_requests_show_their_stage_and_late_arrivals(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    body = listing(client)
    by_no = {r["request_no"]: r for r in body["requests"]}
    assert set(by_no) == {"RR-2026-0001", "RR-2026-0002", "RR-2026-0003"}
    labour = by_no["RR-2026-0001"]
    assert (labour["trade"], labour["stage"], labour["stage_label"]) == (
        "General labour", "visa_processing", "Visa processing",
    )  # fmt: skip
    assert labour["arrives_late"] is True and labour["project_code"] == "RAK-07"
    replacement = by_no["RR-2026-0003"]
    assert replacement["replaces_code"] == "EMP-0125" and replacement["source"] == "local"
    assert replacement["arrives_late"] is False  # RAK-01 started long ago


def test_leavers_with_nobody_to_replace_them_are_listed(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    leaving = {w["code"]: w for w in listing(client)["leaving"]}
    assert "EMP-0125" not in leaving  # a replacement is already being recruited
    assert "EMP-0152" in leaving
    assert leaving["EMP-0152"]["kind"] == "contract_end"
    assert leaving["EMP-0152"]["detail"] == "Contract ends 15 Mar 2027"
    kinds = {w["kind"] for w in leaving.values()}
    assert {"exit", "contract_end"} <= kinds


def test_raising_a_request_numbers_it_and_the_forecast_counts_it(
    client: TestClient,
) -> None:
    sign_in(client, HR_MANAGER)
    created = raise_request(client)
    assert created.status_code == 201, created.text
    row = created.json()
    assert row["request_no"] == "RR-2026-0004" and row["stage"] == "open"
    assert (row["trade"], row["headcount"], row["source"]) == ("Mason", 4, "overseas")
    forecast = client.get("/projects/RAK-07/forecast").json()
    mason = next(t for t in forecast["trades"] if t["trade_code"] == "mason")
    assert mason["arriving"][-1]["headcount"] == 4  # no date yet, so it counts as on the way
    assert mason["arriving"][-1]["expected_arrival"] is None


def test_a_replacement_request_takes_the_person_off_the_leaving_list(
    client: TestClient,
) -> None:
    sign_in(client, HR_MANAGER)
    created = raise_request(
        client, project="RAK-01", trade="equipment_operator", headcount=1, replaces="EMP-0152",
        reason="Replacing a steel fixer whose contract ends",
    )  # fmt: skip
    assert created.status_code == 201, created.text
    assert created.json()["replaces_code"] == "EMP-0152"
    assert "EMP-0152" not in {w["code"] for w in listing(client)["leaving"]}


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"reason": "too short"}, "at least 10"),
        ({"headcount": 0}, "headcount"),
        ({"headcount": 501}, "headcount"),
        ({"needed_by": "2026-11-04"}, "past"),
        ({"expected_arrival": "2026-11-01"}, "past"),
        ({"trade": "wizard"}, "Unknown trade"),
        ({"project": "NOPE-9"}, "Unknown project"),
        ({"source": "carrier-pigeon"}, "source"),
    ],
)
def test_bad_requests_are_refused_with_a_reason(
    client: TestClient, changes: dict[str, Any], message: str
) -> None:
    sign_in(client, HR_MANAGER)
    response = raise_request(client, **changes)
    assert response.status_code == 422, response.text
    assert message in response.text
    assert len(listing(client)["requests"]) == 3  # nothing saved


def test_a_replacement_for_someone_who_is_not_there_is_not_found(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    assert raise_request(client, replaces="EMP-9999").status_code == 404


def test_each_request_moves_one_step_at_a_time(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    request_id = raise_request(client).json()["id"]
    skip = client.post(
        f"/recruitment-requests/{request_id}/advance", json={"to": "visa_processing"}
    )
    assert skip.status_code == 422
    assert "next step is under recruitment" in skip.text
    for stage in ("sourcing", "offer_issued", "visa_processing", "arrived", "filled"):
        step = client.post(f"/recruitment-requests/{request_id}/advance", json={"to": stage})
        assert step.status_code == 200, step.text
        assert step.json()["advanced"]["stage"] == stage and step.json()["remaining"] is None
    done = client.post(f"/recruitment-requests/{request_id}/advance", json={"to": "sourcing"})
    assert done.status_code == 409  # already active: it cannot go back


def test_moving_only_some_people_splits_the_request(
    client: TestClient, migrated_db: Engine
) -> None:
    sign_in(client, HR_MANAGER)
    request_id = raise_request(client).json()["id"]
    result = client.post(
        f"/recruitment-requests/{request_id}/advance",
        json={"to": "sourcing", "count": 1, "expected_arrival": "2027-02-01"},
    ).json()
    assert result["advanced"]["headcount"] == 1 and result["advanced"]["stage"] == "sourcing"
    assert result["advanced"]["request_no"] == "RR-2026-0004-1"
    assert result["advanced"]["expected_arrival"] == "2027-02-01"
    assert result["remaining"]["headcount"] == 3 and result["remaining"]["stage"] == "open"
    assert result["remaining"]["request_no"] == "RR-2026-0004"
    too_many = client.post(
        f"/recruitment-requests/{request_id}/advance", json={"to": "sourcing", "count": 4}
    )
    assert too_many.status_code == 422 and "Only 3 people" in too_many.text
    with migrated_db.connect() as c:
        total = c.execute(
            text(
                "SELECT sum(headcount) FROM recruitment_requests "
                "WHERE request_no LIKE 'RR-2026-0004%'"
            )
        ).scalar_one()
        audited = c.execute(
            text("SELECT count(*) FROM audit_log WHERE action = 'recruitment.advanced'")
        ).scalar_one()
    assert total == 4 and audited == 1  # nobody was lost or invented


def test_cancelling_takes_the_whole_request_and_it_stops_counting(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    request_id = raise_request(client).json()["id"]
    cancelled = client.post(
        f"/recruitment-requests/{request_id}/advance", json={"to": "cancelled", "count": 1}
    ).json()
    assert cancelled["advanced"]["stage"] == "cancelled" and cancelled["advanced"]["headcount"] == 4
    forecast = client.get("/projects/RAK-07/forecast").json()
    mason = next(t for t in forecast["trades"] if t["trade_code"] == "mason")
    assert all(a["headcount"] != 4 for a in mason["arriving"])
    assert client.get("/recruitment-requests").json()["requests"][-1]["stage"] == "cancelled"


def test_an_unknown_request_is_not_found(client: TestClient) -> None:
    sign_in(client, HR_MANAGER)
    missing = "00000000-0000-4000-8000-000000000000"
    assert (
        client.post(f"/recruitment-requests/{missing}/advance", json={"to": "sourcing"}).status_code
        == 404
    )


def test_who_may_read_and_who_may_raise(make_client: Any, migrated_db: Engine) -> None:
    executive, ceo = make_client(), make_client()
    sign_in(executive, HR_EXECUTIVE)
    sign_in(ceo, CEO)
    assert executive.get("/recruitment-requests").status_code == 200  # may read
    assert ceo.get("/recruitment-requests").status_code == 200
    assert raise_request(executive).status_code == 403  # may not raise
    assert raise_request(ceo).status_code == 403
    first = listing(executive)["requests"][0]["id"]
    assert (
        executive.post(
            f"/recruitment-requests/{first}/advance", json={"to": "sourcing"}
        ).status_code
        == 403
    )
    anonymous = make_client()
    assert anonymous.get("/recruitment-requests").status_code == 401


def test_the_audit_log_records_who_raised_what(client: TestClient, migrated_db: Engine) -> None:
    sign_in(client, HR_MANAGER)
    raise_request(client)
    with migrated_db.connect() as c:
        row = c.execute(
            text(
                "SELECT role_codes, after_json FROM audit_log WHERE action = 'recruitment.created'"
            )
        ).one()
    assert row[0] == ["hr_manager"]
    assert row[1]["request_no"] == "RR-2026-0004" and row[1]["trade"] == "mason"
    assert date.today().year >= 2026  # the number uses the simulated year (2026), not today's
