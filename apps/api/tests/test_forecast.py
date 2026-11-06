"""The manpower forecast and "add a project", against a real Postgres.

Each scenario builds its own trade ("Test trade") so the 150 seeded workers cannot interfere, and runs
under the simulated date, Thursday 5 Nov 2026. The new project starts on 12 Feb 2027, so:
  handover buffer 7 days  -> must finish by 5 Feb 2027
  late window 21 days     -> could join late if they finish by 5 Mar 2027
  cover window            -> 12 Feb to 13 May 2027 (90 days)
"""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.support import CEO, HR_EXECUTIVE, HR_MANAGER, add_user, sign_in
from tests.world import START, World, scenario


def forecast(client: TestClient, code: str, **params: Any) -> dict[str, Any]:
    response = client.get(f"/projects/{code}/forecast", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def the_trade(body: dict[str, Any]) -> dict[str, Any]:
    return next(t for t in body["trades"] if t["trade_code"] == "test_trade")


def codes(workers: list[dict[str, Any]]) -> list[str]:
    return [w["code"] for w in workers]


def test_every_kind_of_person_lands_in_the_right_group(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    body = forecast(client, "T-NEW")
    assert body["start"] == "2027-02-12" and body["window_end"] == "2027-05-13"
    assert body["buffer_days"] == 7 and body["late_window_days"] == 21
    trade = the_trade(body)

    available = next(s for s in trade["sources"] if s["kind"] == "available_now")
    assert codes(available["workers"]) == ["W01"]
    ending = [s for s in trade["sources"] if s["kind"] == "ending_before_start"]
    assert [(s["project_code"], s["ends_on"], codes(s["workers"])) for s in ending] == [
        ("T-OLD", "2027-01-31", ["W04"]),
        ("T-OLD", "2027-02-05", ["W05"]),
    ]
    assert all(s["must_finish_by"] == "2027-02-05" for s in ending)

    late = [(c["code"], c["days_after_start"]) for c in trade["late_candidates"]]
    assert late == [
        ("W06", -6),
        ("W07", 10),
        ("W08", 21),
    ]  # W09 (one day too late) and W10 are not offered
    why = {e["code"]: e["reason"] for e in trade["excluded"]}
    assert why == {
        "W02": "on_leave",
        "W03": "documents",
        "W11": "unavailable",
        "W12": "already_reserved",
    }
    details = {e["code"]: e["detail"] for e in trade["excluded"]}
    assert details["W03"] == "Residency visa ends 1 Mar 2027"
    assert details["W12"] == "Planned on T-OTH from 1 Feb 2027"


def test_the_numbers_and_the_advice_for_a_short_trade(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)  # needs 6: 1 already there, 3 deployable (W01, W04, W05) -> short by 2
    sign_in(client, HR_MANAGER)
    trade = the_trade(forecast(client, "T-NEW"))
    assert (trade["needed"], trade["already_assigned"], trade["deployable"]) == (6, 1, 3)
    assert (trade["gap"], trade["uncovered_gap"], trade["recruitment_pending"]) == (2, 2, 0)
    advice = trade["advice"]
    assert advice["verdict"] == "recruit" and advice["recruit_count"] == 2
    assert advice["recruit_by"] == "2027-01-13" and advice["recruit_by_passed"] is False
    assert advice["could_start_late"] == 2 and advice["recruit_instead"] == 0
    assert advice["max_delay_days"] == 10  # W06 ends before the start (0 days), W07 10 days after
    assert advice["headline"] == (
        "Recruit 2: locally by 13 Jan 2027, or overseas by 14 Dec 2026, "
        "or wait for 2 who finish within 10 days of the start."
    )


def test_a_mix_of_waiting_and_recruiting(client: TestClient, migrated_db: Engine) -> None:
    scenario(migrated_db, need=8)  # short by 4, three could join late -> wait for 3, recruit 1
    sign_in(client, HR_MANAGER)
    advice = the_trade(forecast(client, "T-NEW"))["advice"]
    assert advice["recruit_count"] == 4 and advice["could_start_late"] == 3
    assert advice["recruit_instead"] == 1 and advice["max_delay_days"] == 21
    assert advice["headline"] == (
        "Recruit 4: locally by 13 Jan 2027, or overseas by 14 Dec 2026, "
        "or have 3 start up to 21 days late and recruit 1."
    )


def test_covered_by_people_who_are_free_now(client: TestClient, migrated_db: Engine) -> None:
    scenario(migrated_db, need=2)  # 1 already there + W01 free now
    sign_in(client, HR_MANAGER)
    trade = the_trade(forecast(client, "T-NEW"))
    assert trade["gap"] == 0 and trade["advice"]["verdict"] == "covered"


def test_covered_but_depends_on_another_project_finishing(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db, need=4)  # 1 there + W01 free + W04 and W05 from T-OLD
    sign_in(client, HR_MANAGER)
    advice = the_trade(forecast(client, "T-NEW"))["advice"]
    assert advice["verdict"] == "covered_with_dependencies"
    assert (
        advice["headline"]
        == "Covered, but 2 still depend on other projects finishing by 5 Feb 2027."
    )


def test_an_open_recruitment_request_counts_as_pending(
    client: TestClient, migrated_db: Engine
) -> None:
    w = scenario(migrated_db)
    with migrated_db.connect() as c:
        pid = c.execute(text("SELECT id FROM projects WHERE code = 'T-NEW'")).scalar_one()
    sign_in(client, HR_MANAGER)
    w.recruitment(pid, 1)
    trade = the_trade(forecast(client, "T-NEW"))
    assert (trade["gap"], trade["recruitment_pending"], trade["uncovered_gap"]) == (2, 1, 1)
    assert trade["advice"]["recruit_count"] == 1
    with migrated_db.begin() as c:
        c.execute(text("UPDATE recruitment_requests SET headcount = 2"))
    advice = the_trade(forecast(client, "T-NEW"))["advice"]
    assert advice["verdict"] == "recruitment_pending"
    assert advice["headline"] == "Short by 2. Already on the way: 2 requested."


def test_a_cancelled_or_filled_request_does_not_count(
    client: TestClient, migrated_db: Engine
) -> None:
    w = scenario(migrated_db)
    with migrated_db.connect() as c:
        pid = c.execute(text("SELECT id FROM projects WHERE code = 'T-NEW'")).scalar_one()
    w.recruitment(pid, 2, status="cancelled")
    sign_in(client, HR_MANAGER)
    assert the_trade(forecast(client, "T-NEW"))["recruitment_pending"] == 0


def test_moving_the_start_date_moves_the_groups(client: TestClient, migrated_db: Engine) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    # Start 1 Mar: W06 (6 Feb) and W07 (22 Feb) are now clear of the buffer; W08 (5 Mar) is 4 days late.
    trade = the_trade(forecast(client, "T-NEW", start="2027-03-01"))
    ending = {
        c
        for s in trade["sources"]
        if s["kind"] == "ending_before_start"
        for c in codes(s["workers"])
    }
    assert ending == {"W04", "W05", "W06", "W07"}
    assert [(c["code"], c["days_after_start"]) for c in trade["late_candidates"]] == [
        ("W08", 4),
        ("W09", 5),
    ]


def test_a_date_that_has_passed_says_so(client: TestClient, migrated_db: Engine) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    advice = the_trade(forecast(client, "T-NEW", start="2026-11-20"))["advice"]
    assert advice["recruit_by"] == "2026-10-21" and advice["recruit_by_passed"] is True
    assert advice["recruit_by_overseas_passed"] is True
    assert "locally by 21 Oct 2026 (date passed)" in advice["headline"]


def test_the_candidate_projection_has_no_phone_or_numbers(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    sign_in(client, HR_MANAGER)
    text_body = client.get("/projects/T-NEW/forecast").text
    assert "phone" not in text_body and "doc_number" not in text_body and "•••" not in text_body


def test_a_project_without_a_start_date_asks_for_one(
    client: TestClient, migrated_db: Engine
) -> None:
    World(migrated_db).project("T-NODATE", date(2027, 1, 1), None, need=1, status="planning")
    with migrated_db.begin() as c:
        c.execute(text("UPDATE projects SET starts_on = NULL WHERE code = 'T-NODATE'"))
    sign_in(client, HR_MANAGER)
    assert client.get("/projects/T-NODATE/forecast").status_code == 422
    assert (
        client.get("/projects/T-NODATE/forecast", params={"start": "2027-03-01"}).status_code == 200
    )


def test_people_who_are_leaving_are_not_counted_and_say_why(
    client: TestClient, migrated_db: Engine
) -> None:
    w = World(migrated_db)
    w.project("T-NEW", START, date(2027, 12, 31), need=4, status="planning")
    w.worker("L01", exit_on=date(2027, 1, 31), exit_reason="resigned")  # gone before the start
    w.worker("L02", exit_on=date(2027, 4, 1), exit_reason="terminated")  # gone inside the window
    w.worker("L03", contract_end=date(2027, 4, 15))  # contract ends inside the window
    w.worker("L04", contract_end=date(2027, 9, 1))  # contract runs past the window: fine
    w.worker("L05", employment="absconded", exit_on=date(2026, 10, 30), exit_reason="absconded")
    sign_in(client, HR_MANAGER)
    trade = the_trade(forecast(client, "T-NEW"))
    assert trade["deployable"] == 1 and codes(trade["sources"][0]["workers"]) == ["L04"]
    details = {e["code"]: (e["reason"], e["detail"]) for e in trade["excluded"]}
    assert details == {
        "L01": ("leaving", "Leaving the company on 31 Jan 2027 (resigned)"),
        "L02": ("leaving", "Leaving the company on 1 Apr 2027 (terminated)"),
        "L03": ("leaving", "Contract ends 15 Apr 2027"),
    }  # L05 left without notice and is simply gone: not offered, not listed


def test_a_leaver_is_not_offered_as_someone_who_could_join_late(
    client: TestClient, migrated_db: Engine
) -> None:
    w = World(migrated_db)
    w.project("T-NEW", START, date(2027, 12, 31), need=2, status="planning")
    old = w.project("T-OLD", date(2026, 3, 1), date(2027, 8, 31))
    both = w.worker("L01", "deployed", exit_on=date(2027, 4, 1), exit_reason="resigned")
    w.assign(both, old, date(2026, 3, 1), date(2027, 2, 20))  # would be a late candidate
    sign_in(client, HR_MANAGER)
    trade = the_trade(forecast(client, "T-NEW"))
    assert trade["late_candidates"] == []
    assert [e["code"] for e in trade["excluded"]] == ["L01"]


def test_recruits_who_arrive_on_time_close_the_gap_and_late_ones_do_not(
    client: TestClient, migrated_db: Engine
) -> None:
    w = World(migrated_db)
    pid = w.project("T-NEW", START, date(2027, 12, 31), need=3, status="planning")
    w.worker("W01")
    sign_in(client, HR_MANAGER)
    assert the_trade(forecast(client, "T-NEW"))["gap"] == 2

    w.recruitment(pid, 1, "visa_processing", arrival=date(2027, 2, 1))  # on time
    w.recruitment(pid, 1, "sourcing", arrival=date(2027, 3, 1))  # 17 days after the start
    trade = the_trade(forecast(client, "T-NEW"))
    assert (trade["gap"], trade["recruitment_pending"], trade["uncovered_gap"]) == (2, 1, 1)
    assert [(a["stage"], a["late"], a["days_after_start"]) for a in trade["arriving"]] == [
        ("visa_processing", False, -11),
        ("sourcing", True, 17),
    ]
    advice = trade["advice"]
    assert advice["verdict"] == "recruit" and advice["recruit_count"] == 1
    assert advice["headline"].endswith(
        "1 being recruited arrives 1 Mar 2027, 17 days after the start."
    )


def test_everything_arriving_on_time_means_recruitment_is_under_way(
    client: TestClient, migrated_db: Engine
) -> None:
    w = World(migrated_db)
    pid = w.project("T-NEW", START, date(2027, 12, 31), need=2, status="planning")
    w.worker("W01")
    w.recruitment(pid, 1, "arrived", arrival=date(2027, 1, 20))
    sign_in(client, HR_MANAGER)
    advice = the_trade(forecast(client, "T-NEW"))["advice"]
    assert advice["verdict"] == "recruitment_pending"
    assert advice["headline"] == (
        "Short by 1. Already on the way: 1 arrived, pending deployment arrives 20 Jan 2027."
    )


def test_overseas_hiring_has_its_own_longer_lead_time(
    make_client: Any, migrated_db: Engine
) -> None:
    World(migrated_db).project("T-NEW", START, date(2027, 12, 31), need=2, status="planning")
    short = make_client(recruit_lead_days_local=20, recruit_lead_days_overseas=45)
    sign_in(short, HR_MANAGER)
    advice = the_trade(forecast(short, "T-NEW"))["advice"]
    assert (advice["recruit_by"], advice["recruit_by_overseas"]) == ("2027-01-23", "2026-12-29")
    assert advice["headline"].startswith(
        "Recruit 2: locally by 23 Jan 2027, or overseas by 29 Dec 2026."
    )


# ------------------------------------------------------------------ who may ask


def test_the_forecast_needs_forecast_read_and_respects_project_scope(
    client: TestClient, migrated_db: Engine
) -> None:
    scenario(migrated_db)
    add_user(migrated_db, "pm@constructiq.test", "project_manager", projects=("T-OLD",))
    sign_in(client, "pm@constructiq.test")
    assert client.get("/projects/T-NEW/forecast").status_code == 403  # a PM has no forecast:read
    other = client.__class__(client.app)
    sign_in(other, HR_EXECUTIVE)
    assert other.get("/projects/T-NEW/forecast").status_code == 200
    assert other.get("/projects/NOPE-99/forecast").status_code == 404


def test_the_ceo_can_read_the_forecast(client: TestClient, migrated_db: Engine) -> None:
    scenario(migrated_db)
    sign_in(client, CEO)
    assert client.get("/projects/T-NEW/forecast").status_code == 200


# ------------------------------------------------------------------ the seeded RAK-07


def test_the_seeded_rak07_tells_the_demo_story(client: TestClient) -> None:
    """RAK-07 starts 12 Feb 2027. From the simulated 5 Nov 2026 the seed gives HR three different answers."""
    sign_in(client, HR_MANAGER)
    body = forecast(client, "RAK-07")
    assert (body["start"], body["window_end"]) == ("2027-02-12", "2027-05-13")
    by_name = {t["trade"]: t for t in body["trades"]}
    assert list(by_name) == ["General labour", "Mason", "Steel fixer"]

    labour = by_name["General labour"]  # one short, and one person finishes 14 days after the start
    assert (labour["needed"], labour["deployable"], labour["gap"]) == (6, 5, 1)
    assert [c["days_after_start"] for c in labour["late_candidates"]] == [14]
    assert labour["advice"]["headline"] == (
        "Recruit 1: locally by 13 Jan 2027, or overseas by 14 Dec 2026, "
        "or wait for 1 who finishes within 14 days of the start. "
        "1 in visa processing arrives 2 Mar 2027, 18 days after the start."
    )

    mason = by_name["Mason"]  # covered, but most of them are still on RAK-05 and RAK-02
    assert (mason["needed"], mason["deployable"], mason["gap"]) == (10, 10, 0)
    assert mason["advice"]["verdict"] == "covered_with_dependencies"
    assert mason["advice"]["headline"].startswith("Covered, but 8 still depend on other projects")
    assert [c["days_after_start"] for c in mason["late_candidates"]] == [-4, 8, 12]
    reasons = {e["reason"] for e in mason["excluded"]}
    assert {"on_leave", "documents", "already_reserved", "unavailable"} <= reasons
    ending = [s for s in mason["sources"] if s["kind"] == "ending_before_start"]
    assert {s["project_code"] for s in ending} == {"RAK-05", "RAK-02"}
    assert all(s["must_finish_by"] == "2027-02-05" for s in ending)

    steel = by_name["Steel fixer"]  # plenty, 15 of them coming off RAK-02 on 31 Jan
    assert (steel["needed"], steel["deployable"], steel["gap"]) == (8, 20, 0)
    leaving = {e["code"]: e["detail"] for e in steel["excluded"] if e["reason"] == "leaving"}
    assert leaving == {  # the contract end is listed first even though the visa also ends early
        "EMP-0125": "Leaving the company on 31 Jan 2027 (resigned)",
        "EMP-0152": "Contract ends 15 Mar 2027",
    }
    assert steel["advice"]["verdict"] == "covered_with_dependencies"

    for trade in body["trades"]:
        assert trade["gap"] == max(trade["needed"] - trade["deployable"], 0)
        assert trade["uncovered_gap"] == max(trade["gap"] - trade["recruitment_pending"], 0)
