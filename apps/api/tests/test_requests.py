"""Staffing requests and the Allocation Board, rule by rule.

Uses the forecast scenario from tests/world.py (a trade of its own, so the 150 seeded workers cannot
interfere). The HR Executive raises and prepares; the HR Manager approves; the MD/CEO can
approve what the HR Manager raised.

  W01 free now · W04 finishes 31 Jan · W05 finishes 5 Feb · W06 finishes 6 Feb · W07 finishes 22 Feb
  W02 on leave · W03 visa ends 1 Mar 2027 · W11 not available · W12 planned elsewhere
  The request below starts 12 Feb 2027 and runs to 31 Dec 2027.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, add_user, sign_in
from tests.world import scenario


def body(**changes: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "project": "T-NEW",
        "needed_from": "2027-02-12",
        "needed_until": "2027-12-31",
        "priority": 2,
        "lines": [{"trade": "test_trade", "headcount": 3}],
    }
    data.update(changes)
    return data


class Board:
    """The two HR users and the helpers a test needs, so each test reads as a story."""

    def __init__(self, make_client: Any, engine: Engine) -> None:
        self.engine = engine
        self.executive: TestClient = make_client()
        self.manager: TestClient = make_client()
        self.ceo: TestClient = make_client()
        sign_in(self.executive, HR_EXECUTIVE)
        sign_in(self.manager, HR_MANAGER)
        sign_in(self.ceo, CEO)

    def raise_request(self, who: TestClient | None = None, **changes: Any) -> dict[str, Any]:
        response = (who or self.executive).post("/requests", json=body(**changes))
        assert response.status_code == 201, response.text
        return response.json()

    def line_url(self, request: dict[str, Any], suffix: str = "", index: int = 0) -> str:
        return f"/requests/{request['request_no']}/lines/{request['lines'][index]['id']}{suffix}"

    def choose(
        self, request: dict[str, Any], codes: list[str], who: TestClient | None = None
    ) -> Any:
        return (who or self.executive).post(
            self.line_url(request, "/picks"), json={"employee_codes": codes}
        )

    def detail(self, request: dict[str, Any]) -> dict[str, Any]:
        return self.manager.get(f"/requests/{request['request_no']}").json()

    def count(self, sql: str) -> int:
        with self.engine.connect() as c:
            return int(c.execute(text(sql)).scalar_one())  # noqa: S608


@pytest.fixture
def board(make_client: Any, migrated_db: Engine) -> Board:
    scenario(migrated_db)
    return Board(make_client, migrated_db)


def codes(rows: list[dict[str, Any]]) -> list[str]:
    return [r["code"] for r in rows]


# ------------------------------------------------------------------ raising a request


def test_the_executive_raises_a_request_and_it_waits_for_approval(board: Board) -> None:
    request = board.raise_request(source_text="  Welders for the slab  ")
    assert request["request_no"] == "SR-2026-0003"  # the seed holds SR-2026-0001 and 0002
    assert request["status"] == "submitted" and request["requested_by"] == "Priya Demo"
    assert request["source_text"] == "Welders for the slab"
    line = request["lines"][0]
    assert (line["trade"], line["headcount"], line["filled"], line["status"]) == (
        "Test trade", 3, 0, "open",
    )  # fmt: skip
    assert request["can_approve"] is False  # the executive cannot approve
    assert board.count("SELECT count(*) FROM approval_steps WHERE decision = 'pending'") == 3
    assert board.count("SELECT count(*) FROM audit_log WHERE action = 'request.created'") == 1


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"needed_from": "2026-11-01"}, "cannot be in the past"),
        ({"needed_until": "2027-01-01"}, "end date must not be before"),
        ({"needed_until": "2028-06-01"}, "project ends on 31 Dec 2027"),
        ({"project": "NOPE-9"}, "Unknown project"),
        ({"lines": [{"trade": "wizard", "headcount": 1}]}, "Unknown trade"),
        ({"lines": [{"trade": "mason", "headcount": 0}]}, "headcount"),
        ({"lines": []}, "lines"),
        (
            {"lines": [{"trade": "mason", "headcount": 1}, {"trade": "mason", "headcount": 2}]},
            "once",
        ),
    ],
)
def test_bad_requests_are_refused_with_a_reason(
    board: Board, changes: dict[str, Any], message: str
) -> None:
    response = board.executive.post("/requests", json=body(**changes))
    assert response.status_code == 422, response.text
    assert message in response.text
    assert len(board.executive.get("/requests").json()) == 2  # only the two seeded ones


def test_a_closed_project_takes_no_requests(board: Board) -> None:
    with board.engine.begin() as c:
        c.execute(text("UPDATE projects SET status = 'completed' WHERE code = 'T-NEW'"))
    response = board.executive.post("/requests", json=body())
    assert response.status_code == 422 and "closed" in response.text


def test_who_may_raise_and_who_may_read(board: Board) -> None:
    assert board.ceo.post("/requests", json=body()).status_code == 403  # no staffing:create
    assert board.ceo.get("/requests").status_code == 200  # may read
    anonymous = board.ceo.__class__(board.ceo.app)
    assert anonymous.post("/requests", json=body()).status_code == 401
    add_user(board.engine, "logistics@constructiq.test", "logistics_coordinator")
    logistics = board.ceo.__class__(board.ceo.app)
    sign_in(logistics, "logistics@constructiq.test")
    assert logistics.get("/requests").status_code == 403


def test_requests_can_be_filtered(board: Board) -> None:
    board.raise_request()
    assert [
        r["request_no"] for r in board.manager.get("/requests", params={"q": "RAK-03"}).json()
    ] == ["SR-2026-0001"]
    assert len(board.manager.get("/requests", params={"project": "T-NEW"}).json()) == 1
    assert len(board.manager.get("/requests", params={"status": "filled"}).json()) == 0
    assert len(board.manager.get("/requests", params={"q": "steel"}).json()) == 1


# ------------------------------------------------------------------ the pool


def test_candidates_are_grouped_and_every_exclusion_names_its_rule(board: Board) -> None:
    request = board.raise_request()
    pool = board.executive.get(board.line_url(request, "/candidates")).json()
    by_code = {c["code"]: c for c in pool["candidates"]}
    assert [(c["code"], c["group"]) for c in pool["candidates"]] == [
        ("W01", "free"), ("W04", "finishing"), ("W05", "finishing"), ("W06", "late"),
        ("W07", "late"), ("W08", "late"),
    ]  # fmt: skip
    assert by_code["W06"]["starts_on"] == "2027-02-07" and by_code["W06"]["from_project"] == "T-OLD"
    assert by_code["W04"]["starts_on"] == "2027-02-12" and by_code["W04"]["ends_on"] == "2027-01-31"
    assert pool["window_end"] == "2028-01-01" and pool["open_slots"] == 3
    blocked = {e["code"]: (e["rule"], e["message"]) for e in pool["excluded"]}
    assert blocked["W02"][0] == "ASSIGN_LEAVE" and blocked["W02"][1].startswith("Approved leave")
    assert blocked["W03"] == ("DOC_VALID_THROUGH", "Residency visa ends 1 Mar 2027")
    assert blocked["W11"][0] == "ASSIGN_AVAILABILITY"
    assert blocked["W12"] == ("ASSIGN_OVERLAP", "Planned on T-OTH from 1 Feb 2027")
    assert "W09" not in blocked and "W10" not in blocked  # simply busy: not a finding


def test_the_pool_has_no_phone_and_no_numbers(board: Board) -> None:
    request = board.raise_request()
    raw = board.executive.get(board.line_url(request, "/candidates")).text
    assert "phone" not in raw and "doc_number" not in raw and "•••" not in raw


def test_the_pool_can_be_searched_and_filtered(board: Board) -> None:
    request = board.raise_request()
    url = board.line_url(request, "/candidates")
    assert codes(board.executive.get(url, params={"q": "W04"}).json()["candidates"]) == ["W04"]
    with board.engine.begin() as c:
        c.execute(text("UPDATE employee_skills SET level = 1 WHERE employee_id = "
                       "(SELECT id FROM employees WHERE employee_code = 'W01')"))  # fmt: skip
    low = board.executive.get(url, params={"min_level": 3}).json()
    assert "W01" not in codes(low["candidates"])
    assert board.executive.get(url).json()["open_slots"] == 3


# ------------------------------------------------------------------ choosing people


def test_choosing_people_runs_every_rule_and_answers_per_person(board: Board) -> None:
    request = board.raise_request()
    response = board.choose(request, ["W01", "W03", "W02", "W11", "W12", "W99"])
    results = {r["code"]: r for r in response.json()["results"]}
    assert response.json()["chosen"] == 1 and results["W01"]["outcome"] == "chosen"
    rules = {code: [v["rule"] for v in r["violations"]] for code, r in results.items()}
    assert rules["W03"] == ["DOC_VALID_THROUGH"] and rules["W02"] == ["ASSIGN_LEAVE"]
    assert rules["W11"] == ["ASSIGN_AVAILABILITY"] and rules["W12"] == ["ASSIGN_OVERLAP"]
    assert rules["W99"] == ["ASSIGN_TRADE"]
    detail = board.detail(request)["lines"][0]["picks"]
    assert [(p["code"], p["source"], p["group"]) for p in detail] == [("W01", "hr", "free")]
    assert detail[0]["reason"].startswith("Free now, level 3, documents valid to 1 Jun 2028")


def test_the_minimum_level_is_a_rule(board: Board) -> None:
    with board.engine.begin() as c:
        c.execute(
            text(
                """UPDATE employee_skills SET level = 2
                   WHERE employee_id = (SELECT id FROM employees WHERE employee_code = 'W01')"""
            )
        )
    request = board.raise_request(lines=[{"trade": "test_trade", "headcount": 2, "min_level": 3}])
    result = board.choose(request, ["W01"]).json()["results"][0]
    assert result["outcome"] == "refused"
    assert result["violations"] == [
        {"rule": "ASSIGN_LEVEL", "message": "Level 2 is below the level 3 this line asks for."}
    ]


def test_a_line_cannot_take_more_people_than_it_asks_for(board: Board) -> None:
    request = board.raise_request(lines=[{"trade": "test_trade", "headcount": 1}])
    assert board.choose(request, ["W01"]).json()["chosen"] == 1
    refused = board.choose(request, ["W04"]).json()["results"][0]
    assert [v["rule"] for v in refused["violations"]] == ["ASSIGN_HEADCOUNT"]
    again = board.choose(request, ["W01"]).json()["results"][0]
    assert again["outcome"] == "refused"


def test_one_person_cannot_be_chosen_on_two_open_lines(board: Board) -> None:
    first = board.raise_request()
    second = board.raise_request(needed_until="2027-06-30")
    assert board.choose(first, ["W01"]).json()["chosen"] == 1
    clash = board.choose(second, ["W01"]).json()["results"][0]
    assert clash["violations"] == [
        {"rule": "ASSIGN_ONE_LINE", "message": "Already chosen on SR-2026-0003 (Test trade)."}
    ]
    pool = board.executive.get(board.line_url(second, "/candidates")).json()
    assert "W01" not in codes(pool["candidates"])
    assert any(e["code"] == "W01" and e["rule"] == "ASSIGN_ONE_LINE" for e in pool["excluded"])


def test_removing_needs_a_reason_and_restoring_checks_everything_again(board: Board) -> None:
    request = board.raise_request()
    board.choose(request, ["W01", "W04"])
    url = board.line_url(request, "/picks/remove")
    assert (
        board.executive.post(url, json={"employee_code": "W01", "reason": "  "}).status_code == 422
    )
    assert (
        board.executive.post(
            url, json={"employee_code": "W01", "reason": "Needed elsewhere"}
        ).status_code
        == 204
    )
    assert (
        board.executive.post(url, json={"employee_code": "W01", "reason": "again"}).status_code
        == 404
    )
    picks = board.detail(request)["lines"][0]["picks"]
    assert [(p["code"], p["removed_reason"]) for p in picks] == [
        ("W04", None), ("W01", "Needed elsewhere"),
    ]  # fmt: skip
    assert board.executive.get(board.line_url(request, "/candidates")).json()["open_slots"] == 2
    # While W01 is off the line, their visa expires: restoring must refuse.
    with board.engine.begin() as c:
        c.execute(text("""UPDATE employee_documents SET expiry_date = '2027-03-01'
                          WHERE doc_type = 'residency_visa' AND employee_id =
                          (SELECT id FROM employees WHERE employee_code = 'W01')"""))  # fmt: skip
    restore = board.executive.post(
        board.line_url(request, "/picks/restore"), json={"employee_code": "W01"}
    ).json()["results"][0]
    assert (
        restore["outcome"] == "refused" and restore["violations"][0]["rule"] == "DOC_VALID_THROUGH"
    )
    with board.engine.begin() as c:
        c.execute(text("""UPDATE employee_documents SET expiry_date = '2028-06-01'
                          WHERE doc_type = 'residency_visa' AND employee_id =
                          (SELECT id FROM employees WHERE employee_code = 'W01')"""))  # fmt: skip
    ok = board.executive.post(
        board.line_url(request, "/picks/restore"), json={"employee_code": "W01"}
    ).json()["results"][0]
    assert ok["outcome"] == "chosen"


def test_suggest_fills_open_places_best_first_and_never_picks_late_joiners(board: Board) -> None:
    request = board.raise_request(lines=[{"trade": "test_trade", "headcount": 5}])
    result = board.executive.post(board.line_url(request, "/suggest")).json()
    assert result["chosen"] == 3  # W01, W04, W05: the only people who are cleared and on time
    picks = board.detail(request)["lines"][0]["picks"]
    assert [(p["code"], p["source"]) for p in picks] == [
        ("W01", "rules"),
        ("W04", "rules"),
        ("W05", "rules"),
    ]
    assert picks[0]["reason"].startswith("Free now") and picks[1]["reason"].startswith(
        "Finishes on T-OLD"
    )
    again = board.executive.post(board.line_url(request, "/suggest")).json()
    assert again["chosen"] == 0  # nobody else is cleared


# ------------------------------------------------------------------ approving


def test_the_preview_shows_what_approving_does_and_writes_nothing(board: Board) -> None:
    request = board.raise_request(lines=[{"trade": "test_trade", "headcount": 2}])
    board.choose(request, ["W01", "W04"])
    before = board.count("SELECT count(*) FROM employee_assignments")
    preview = board.manager.post(board.line_url(request, "/approve"), json={"preview": True}).json()
    assert preview["preview"] is True and preview["ok"] is True
    assert (preview["assignments"], preview["mobilizations"], preview["depend_on_other_jobs"]) == (
        2,
        2,
        1,
    )
    assert (preview["filled_after"], preview["headcount"], preview["request_status_after"]) == (
        2,
        2,
        "filled",
    )
    people = {p["code"]: p for p in preview["people"]}
    assert (
        people["W01"]["becomes_mobilizing"] is True and people["W04"]["becomes_mobilizing"] is False
    )
    assert people["W04"]["moving_from"] == "T-OLD" and people["W04"]["mob_no"] is None
    assert board.count("SELECT count(*) FROM employee_assignments") == before
    assert board.count("SELECT count(*) FROM mobilizations WHERE NOT is_demo") == 0


def test_approving_plans_assignments_starts_mobilizations_and_updates_everything(
    board: Board,
) -> None:
    request = board.raise_request(lines=[{"trade": "test_trade", "headcount": 2}])
    board.choose(request, ["W01", "W04"])
    response = board.manager.post(board.line_url(request, "/approve"), json={})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["ok"] is True and result["request_status_after"] == "filled"
    # The seed already holds MOB-2026-0101 to 0109, so the next ones follow on from 0109.
    assert [p["mob_no"] for p in result["people"]] == ["MOB-2026-0110", "MOB-2026-0111"]

    detail = board.detail(request)
    line = detail["lines"][0]
    assert detail["status"] == "filled" and (line["status"], line["filled"]) == ("approved", 2)
    assert line["decided_by"] == "Mr Imtiyaz" and line["picks"] == []
    assert [(a["code"], a["moving_from"], a["mob_no"]) for a in line["approved"]] == [
        ("W01", None, "MOB-2026-0110"), ("W04", "T-OLD", "MOB-2026-0111"),
    ]  # fmt: skip
    assert (
        board.count(
            """SELECT count(*) FROM employee_assignments a
           WHERE a.status = 'planned' AND a.request_line_id IS NOT NULL
             AND a.depends_on_assignment_id IS NOT NULL"""
        )
        == 1
    )  # only W04 depends on another job
    assert (
        board.count("SELECT count(*) FROM mobilizations WHERE status = 'approved' AND NOT is_demo")
        == 2
    )
    assert (
        board.count(
            """SELECT count(*) FROM mobilization_tasks k
               JOIN mobilizations m ON m.id = k.mobilization_id WHERE NOT m.is_demo"""
        )
        == 10
    )  # five tasks each, made once
    assert (
        board.count(
            "SELECT count(*) FROM employees "
            "WHERE availability = 'mobilizing' AND employee_code = 'W01'"
        )
        == 1
    )
    assert (
        board.count(
            "SELECT count(*) FROM employees "
            "WHERE availability = 'deployed' AND employee_code = 'W04'"
        )
        == 1
    )  # still on their current job until it ends
    assert board.count("SELECT count(*) FROM approval_requests WHERE status = 'approved'") == 1
    assert board.count("SELECT count(*) FROM audit_log WHERE action = 'request.line_approved'") == 1
    assert (
        board.count("SELECT count(*) FROM staffing_request_picks WHERE removed_reason IS NULL") == 0
    )
    assert (
        board.manager.post(board.line_url(request, "/approve"), json={}).status_code == 409
    )  # locked


def test_a_partial_approval_keeps_the_gap_open(board: Board) -> None:
    request = board.raise_request(lines=[{"trade": "test_trade", "headcount": 3}])
    board.choose(request, ["W01", "W04"])
    first = board.manager.post(board.line_url(request, "/approve"), json={}).json()
    assert first["request_status_after"] == "partially_filled" and first["filled_after"] == 2
    detail = board.detail(request)
    assert detail["status"] == "partially_filled" and detail["lines"][0]["status"] == "open"
    board.choose(request, ["W05"])
    last = board.manager.post(board.line_url(request, "/approve"), json={}).json()
    assert last["request_status_after"] == "filled"
    assert board.detail(request)["lines"][0]["filled"] == 3
    assert board.count("SELECT count(*) FROM approval_requests WHERE status = 'approved'") == 1


def test_approving_some_of_the_chosen_leaves_the_rest_chosen(board: Board) -> None:
    request = board.raise_request()
    board.choose(request, ["W01", "W04", "W05"])
    done = board.manager.post(
        board.line_url(request, "/approve"), json={"employee_codes": ["W01"]}
    ).json()
    assert codes(done["people"]) == ["W01"]
    left = board.detail(request)["lines"][0]
    assert [p["code"] for p in left["picks"]] == ["W04", "W05"] and left["filled"] == 1
    too_many = board.manager.post(
        board.line_url(request, "/approve"), json={"employee_codes": ["W99"]}
    )
    assert too_many.status_code == 422 and "Not chosen on this line" in too_many.text


def test_nobody_approves_their_own_request(board: Board) -> None:
    request = board.raise_request(who=board.manager)  # the HR Manager raised it
    board.choose(request, ["W01"], who=board.manager)
    refused = board.manager.post(board.line_url(request, "/approve"), json={})
    assert refused.status_code == 409 and "You raised this request" in refused.text
    detail = board.manager.get(f"/requests/{request['request_no']}").json()
    assert detail["can_approve"] is False and "someone else" in detail["approve_note"]
    approved = board.ceo.post(board.line_url(request, "/approve"), json={})  # the MD can
    assert approved.status_code == 200 and approved.json()["ok"] is True


def test_the_executive_can_prepare_but_not_approve_or_reject(board: Board) -> None:
    request = board.raise_request()
    board.choose(request, ["W01"])
    assert board.executive.post(board.line_url(request, "/approve"), json={}).status_code == 403
    reject = {"reason": "Not needed after all, plans changed"}
    assert board.executive.post(board.line_url(request, "/reject"), json=reject).status_code == 403


def test_approval_checks_every_rule_again_and_writes_nothing_if_one_fails(board: Board) -> None:
    request = board.raise_request(lines=[{"trade": "test_trade", "headcount": 2}])
    board.choose(request, ["W01", "W04"])
    with (
        board.engine.begin() as c
    ):  # between choosing and approving, W04's visa is found to end early
        c.execute(text("""UPDATE employee_documents SET expiry_date = '2027-03-01'
                          WHERE doc_type = 'residency_visa' AND employee_id =
                          (SELECT id FROM employees WHERE employee_code = 'W04')"""))  # fmt: skip
    before = board.count("SELECT count(*) FROM employee_assignments")
    result = board.manager.post(board.line_url(request, "/approve"), json={}).json()
    assert result["ok"] is False
    blocked = {p["code"]: [v["rule"] for v in p["violations"]] for p in result["people"]}
    assert blocked == {"W01": [], "W04": ["DOC_VALID_THROUGH"]}
    assert board.count("SELECT count(*) FROM employee_assignments") == before  # not even W01
    assert board.count("SELECT count(*) FROM mobilizations WHERE NOT is_demo") == 0
    assert board.detail(request)["status"] == "submitted"
    stale = {p["code"]: p["violations"] for p in board.detail(request)["lines"][0]["picks"]}
    assert stale["W04"][0]["rule"] == "DOC_VALID_THROUGH"  # the board shows what changed


def test_a_person_reserved_from_the_forecast_is_adopted_not_duplicated(board: Board) -> None:
    reserved = board.manager.post(
        "/projects/T-NEW/reserve", json={"trade": "test_trade", "employee_codes": ["W01"]}
    )
    assert reserved.json()["reserved"] == 1
    request = board.raise_request(lines=[{"trade": "test_trade", "headcount": 1}])
    pool = board.executive.get(board.line_url(request, "/candidates")).json()
    assert pool["candidates"][0]["code"] == "W01" and pool["candidates"][0]["group"] == "reserved"
    board.choose(request, ["W01"])
    approved = board.manager.post(board.line_url(request, "/approve"), json={})
    assert approved.status_code == 200 and approved.json()["ok"] is True
    assert (
        board.count(
            """SELECT count(*) FROM employee_assignments a JOIN employees e ON e.id = a.employee_id
           WHERE e.employee_code = 'W01' AND a.status = 'planned'"""
        )
        == 1
    )  # one assignment, now tied to the request line
    assert (
        board.count("SELECT count(*) FROM employee_assignments WHERE request_line_id IS NOT NULL")
        == 1
    )


# ------------------------------------------------------------------ rejecting and cancelling


def test_rejecting_a_line_needs_a_reason_and_releases_the_people(board: Board) -> None:
    request = board.raise_request()
    board.choose(request, ["W01"])
    url = board.line_url(request, "/reject")
    assert board.manager.post(url, json={"reason": "no"}).status_code == 422
    done = board.manager.post(url, json={"reason": "The slab was postponed to March"})
    assert done.status_code == 200 and done.json()["status"] == "rejected"
    line = done.json()["lines"][0]
    assert (
        line["status"] == "rejected"
        and line["decision_reason"] == "The slab was postponed to March"
    )
    assert [p["removed_reason"] for p in line["picks"]] == ["The line was rejected"]
    other = board.raise_request(needed_until="2027-06-30")
    assert board.choose(other, ["W01"]).json()["chosen"] == 1  # W01 is free again
    assert board.count("SELECT count(*) FROM approval_requests WHERE status = 'rejected'") == 1


def test_a_request_can_be_cancelled_until_people_are_approved(board: Board) -> None:
    request = board.raise_request()
    board.choose(request, ["W01"])
    assert (
        board.executive.post(
            f"/requests/{request['request_no']}/cancel", json={"reason": "x"}
        ).status_code
        == 422
    )
    done = board.executive.post(
        f"/requests/{request['request_no']}/cancel", json={"reason": "Plans changed"}
    )
    assert done.status_code == 200 and done.json()["status"] == "cancelled"
    assert board.choose(request, ["W04"]).status_code == 409  # closed
    board_two = board.raise_request()
    board.choose(board_two, ["W05"])
    board.manager.post(board.line_url(board_two, "/approve"), json={})
    blocked = board.executive.post(
        f"/requests/{board_two['request_no']}/cancel", json={"reason": "Changed my mind"}
    )
    assert blocked.status_code == 409 and "already approved" in blocked.text


def test_unknown_requests_and_lines_are_not_found(board: Board) -> None:
    assert board.manager.get("/requests/SR-1999-0001").status_code == 404
    request = board.raise_request()
    missing = "00000000-0000-4000-8000-000000000000"
    assert (
        board.executive.get(
            f"/requests/{request['request_no']}/lines/{missing}/candidates"
        ).status_code
        == 404
    )


# ------------------------------------------------------------------ the seeded demo


def test_the_seeded_requests_tell_the_demo_story(client: TestClient) -> None:
    sign_in(client, HR_EXECUTIVE)
    rows = {r["request_no"]: r for r in client.get("/requests").json()}
    assert set(rows) == {"SR-2026-0001", "SR-2026-0002"}
    assert rows["SR-2026-0001"]["project_code"] == "RAK-03"
    one = client.get("/requests/SR-2026-0001").json()["lines"][0]
    pool = client.get(f"/requests/SR-2026-0001/lines/{one['id']}/candidates").json()
    assert [c["group"] for c in pool["candidates"]] == ["free"] * 7
    reasons = {e["code"]: e["rule"] for e in pool["excluded"]}
    assert reasons["EMP-0111"] == reasons["EMP-0120"] == "DOC_VALID_THROUGH"  # two visas end first
    assert reasons["EMP-0125"] == "ASSIGN_STATUS"  # one is resigning
    two = client.get("/requests/SR-2026-0002").json()["lines"][0]
    pool_two = client.get(f"/requests/SR-2026-0002/lines/{two['id']}/candidates").json()
    assert (two["headcount"], len(pool_two["candidates"])) == (3, 2)  # a partial fill
