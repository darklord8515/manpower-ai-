"""The detectors that can be shown with a few people and projects, one condition at a time.

Uses the scenario builder in tests/world.py (a trade of its own, no seeded workers). The simulated
date is Thursday 5 Nov 2026. The detectors that need the seeded demo (approvals, mobilizations, the
midday ban) are tested with the engine in tests/test_alert_engine.py.
"""

from __future__ import annotations

import uuid
from datetime import date, time, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.clock import SimulatedClock
from app.services.alerts.detectors import (
    SYSTEM,
    document_expiry,
    ending_without_next,
    expiry_threshold,
    shift_conflict,
    transfer_dependency_broken,
    upcoming_shortfall,
)
from app.services.alerts.findings import Finding
from app.services.assignments import plan_assignment
from app.services.forecast import forecast_project
from tests.support import add_user, make_settings
from tests.world import World, scenario

TODAY = date(2026, 11, 5)


def found(engine: Engine, detector: Any, day: date = TODAY) -> list[Finding]:
    with Session(engine) as session:
        return detector(session, make_settings(), SimulatedClock(day))


# ------------------------------------------------------------------------------ document expiry


@pytest.mark.parametrize(
    ("days", "threshold"),
    [(-30, 0), (-1, 0), (0, 7), (7, 7), (8, 30), (30, 30), (31, 60), (60, 60), (61, 90), (90, 90)],
)
def test_the_threshold_a_document_has_crossed(days: int, threshold: int) -> None:
    assert expiry_threshold(days) == threshold


def test_documents_raise_at_90_60_30_7_days_and_when_expired(migrated_db: Engine) -> None:
    w = World(migrated_db)
    active = w.project("P-ACT", date(2026, 1, 1), date(2027, 12, 31), status="active")
    cases = {  # code: (days left, on a project, threshold, severity)
        "D01": (-3, False, 0, "action_needed"),  # expired, nobody is relying on it
        "D02": (-3, True, 0, "critical"),  # expired while assigned
        "D03": (0, False, 7, "critical"),  # ends today
        "D04": (7, False, 7, "critical"),
        "D05": (8, False, 30, "action_needed"),
        "D06": (30, False, 30, "action_needed"),
        "D07": (31, False, 60, "info"),
        "D08": (60, False, 60, "info"),
        "D09": (61, False, 90, "info"),
        "D10": (90, False, 90, "info"),
    }
    for code, (days, assigned, _threshold, _severity) in cases.items():
        worker = w.worker(code, residency_until=TODAY + timedelta(days=days))
        if assigned:
            w.assign(worker, active, date(2026, 1, 1), None, status="active")
    w.worker("D11", residency_until=TODAY + timedelta(days=91))  # not yet
    w.worker("D12", residency_until=TODAY + timedelta(days=5), employment="resigned")  # has left

    by_worker = {f.facts["worker"]: f for f in found(migrated_db, document_expiry)}

    assert sorted(by_worker) == sorted(cases)
    for code, (_days, assigned, threshold, severity) in cases.items():
        f = by_worker[code]
        assert (f.facts["threshold"], f.severity) == (threshold, severity), code
        assert f.type == "document_expiry" and f.subject_type == "employee_document"
        assert (f.project_id is not None) is assigned  # company-wide when nobody is assigned
    assert by_worker["D04"].title == "Worker D04: residency visa ends in 7 days (12 Nov 2026)"
    assert by_worker["D01"].title == "Worker D01: residency visa expired 3 days ago (2 Nov 2026)"
    assert by_worker["D03"].title.endswith("ends today (5 Nov 2026)")
    assert by_worker["D04"].dedupe_key.startswith("document_expiry:")


def test_document_facts_never_hold_a_document_number_or_a_phone(migrated_db: Engine) -> None:
    w = World(migrated_db)
    worker = w.worker("N01", residency_until=TODAY + timedelta(days=20))
    with migrated_db.begin() as c:
        c.execute(
            text(
                """UPDATE employee_documents SET doc_number = '784-1980-1234567-1'
                   WHERE employee_id = :e"""
            ),
            {"e": worker},
        )
        c.execute(text("UPDATE employees SET phone = '+971501234567' WHERE id = :e"), {"e": worker})
    (f,) = found(migrated_db, document_expiry)
    everything = f"{f.title} {f.explanation} {f.facts} {f.actions}"
    assert "784" not in everything and "971501234567" not in everything
    assert not {"number", "doc_number", "phone"} & set(f.facts)


# --------------------------------------------------------------------------- ending without next


def test_people_finishing_soon_with_nothing_after_are_grouped_by_project_and_day(
    migrated_db: Engine,
) -> None:
    w = World(migrated_db)
    p = w.project("P-A", date(2026, 1, 1), date(2027, 12, 31))
    other = w.project("P-B", date(2026, 1, 1), date(2027, 12, 31))

    def ends(code: str, days: int, **kwargs: Any) -> uuid.UUID:
        worker = w.worker(code, **kwargs)
        w.assign(worker, p, date(2026, 1, 1), TODAY + timedelta(days=days), status="active")
        return worker

    ends("E1", 10)
    ends("E2", 10)  # same project and day as E1: one alert for two people
    ends("E3", 20)
    ends("E4", 40)  # more than 30 days away
    ends("E7", 14)
    ends("E8", 15)
    w5 = ends("E5", 10)
    w.assign(w5, other, TODAY + timedelta(days=11), None, status="planned")  # has a next job
    ends("E6", 10, exit_on=TODAY + timedelta(days=10), exit_reason="resigned")  # is leaving anyway

    result = {f.facts["end_date"]: f for f in found(migrated_db, ending_without_next)}

    assert sorted(result) == [TODAY + timedelta(days=d) for d in (10, 14, 15, 20)]
    ten = result[TODAY + timedelta(days=10)]
    assert (ten.facts["count"], ten.severity) == (2, "action_needed")
    assert ten.title == "2 people finish on P-A on 15 Nov 2026 with no next assignment"
    assert [x["code"] for x in ten.facts["workers"]] == ["E1", "E2"]
    assert ten.dedupe_key == "ending_without_next:P-A:2026-11-15"
    assert result[TODAY + timedelta(days=14)].severity == "action_needed"  # the last day of 14
    assert result[TODAY + timedelta(days=15)].severity == "info"
    assert result[TODAY + timedelta(days=20)].severity == "info"
    one = result[TODAY + timedelta(days=14)]
    assert one.title == "1 person finishes on P-A on 19 Nov 2026 with no next assignment"


# ------------------------------------------------------------------------------ upcoming shortfall


def test_a_project_starting_short_raises_with_the_forecasts_own_gap(migrated_db: Engine) -> None:
    scenario(migrated_db, need=6)
    with Session(migrated_db) as session:
        forecast = forecast_project(session, SYSTEM, make_settings(), "T-NEW", TODAY)
    assert forecast is not None
    gap = forecast.trades[0].uncovered_gap
    assert gap > 0

    (f,) = found(migrated_db, upcoming_shortfall)

    assert f.facts["gap"] == gap and f.facts["days_to_start"] == 99
    assert f.severity == "action_needed"  # more than 30 days to go
    assert f.title == f"T-NEW starts 12 Feb 2027: {gap} test trade short"
    assert f.dedupe_key == "upcoming_shortfall:T-NEW:test_trade:2027-02-12"
    assert f.actions[0]["action"] == "open_forecast"
    assert f.actions[0]["params"] == {"project": "T-NEW", "trade": "test_trade"}


def test_a_shortfall_turns_critical_inside_30_days_and_is_ignored_outside_the_window(
    migrated_db: Engine,
) -> None:
    scenario(migrated_db, need=40)
    near = found(migrated_db, upcoming_shortfall, date(2027, 1, 20))  # 23 days before the start
    assert [(f.severity, f.facts["days_to_start"]) for f in near] == [("critical", 23)]
    assert found(migrated_db, upcoming_shortfall, date(2026, 8, 1)) == []  # 195 days: too far


def test_a_covered_project_raises_nothing(migrated_db: Engine) -> None:
    scenario(migrated_db, need=1)
    assert found(migrated_db, upcoming_shortfall) == []


# ----------------------------------------------------------------------------------- the transfer


def _reserve(engine: Engine, code: str, target: str, source: str, last_day: date) -> None:
    """Hold a worker on `target` from the day the handover allows, as Reserve does."""
    add_user(engine, f"approver-{code}@constructiq.test", "hr_manager")
    with Session(engine) as session:
        approver = session.execute(
            text("SELECT id FROM users WHERE email = :e"),
            {"e": f"approver-{code}@constructiq.test"},
        ).scalar_one()
        project = session.execute(
            text("SELECT id FROM projects WHERE code = :c"), {"c": target}
        ).scalar_one()
        plan_assignment(
            session, employee_code=code, project_id=project, first_day=date(2027, 2, 12),
            last_exclusive=None, approver_id=approver, from_project=source,
            after_last=last_day + timedelta(days=1),
        )  # fmt: skip
        session.commit()


def _move_end(engine: Engine, project: str, ends: date) -> None:
    with engine.begin() as c:
        c.execute(
            text("UPDATE projects SET ends_on = :d WHERE code = :c"), {"d": ends, "c": project}
        )


def test_a_transfer_is_at_risk_only_when_the_source_project_is_extended_past_the_handover(
    migrated_db: Engine,
) -> None:
    w = World(migrated_db)
    w.project("T-NEW", date(2027, 2, 12), date(2027, 12, 31), status="planning")
    w.project("T-SRC", date(2026, 3, 1), date(2027, 1, 31))  # ends 31 Jan; handover day is 5 Feb
    w.assign(w.worker("R01", "deployed"), _id(migrated_db, "T-SRC"), date(2026, 3, 1),
             date(2027, 1, 31), status="active")  # fmt: skip
    _reserve(migrated_db, "R01", "T-NEW", "T-SRC", date(2027, 1, 31))

    assert found(migrated_db, transfer_dependency_broken) == []  # nothing has moved

    _move_end(migrated_db, "T-SRC", date(2027, 2, 5))  # later, but the handover day still holds
    assert found(migrated_db, transfer_dependency_broken) == []

    _move_end(migrated_db, "T-SRC", date(2027, 2, 6))  # one day past it
    (f,) = found(migrated_db, transfer_dependency_broken)
    assert f.severity == "critical" and f.project_id is not None
    assert f.title == (
        "Transfer from T-SRC to T-NEW is at risk: T-SRC now ends 6 Feb 2027, after 5 Feb 2027"
    )
    assert (f.facts["count"], f.facts["workers"][0]["code"]) == (1, "R01")
    assert f.dedupe_key == "transfer_dependency:T-SRC:T-NEW:2027-02-12"

    _move_end(migrated_db, "T-SRC", date(2027, 1, 31))  # back: the alert's cause is gone
    assert found(migrated_db, transfer_dependency_broken) == []


def test_someone_released_early_on_purpose_is_not_flagged(migrated_db: Engine) -> None:
    w = World(migrated_db)
    w.project("T-NEW", date(2027, 2, 12), date(2027, 12, 31), status="planning")
    w.project("T-SRC", date(2026, 3, 1), date(2027, 8, 31))  # the project runs on to August
    w.assign(w.worker("R02", "deployed"), _id(migrated_db, "T-SRC"), date(2026, 3, 1),
             date(2027, 1, 31), status="active")  # fmt: skip
    _reserve(migrated_db, "R02", "T-NEW", "T-SRC", date(2027, 1, 31))
    assert found(migrated_db, transfer_dependency_broken) == []  # it ends in August, as it did


def _id(engine: Engine, code: str) -> uuid.UUID:
    with engine.connect() as c:
        return c.execute(text("SELECT id FROM projects WHERE code = :c"), {"c": code}).scalar_one()


# ------------------------------------------------------------------------------------ the shifts


@pytest.mark.parametrize(
    ("start", "end", "result"),
    [
        (time(6, 0), time(12, 30), None),  # ends exactly when the ban starts
        (time(6, 0), time(12, 31), "overlaps"),
        (time(6, 0), time(15, 30), "overlaps"),
        (time(15, 0), time(20, 0), None),  # starts exactly when the ban ends
        (time(14, 59), time(20, 0), "overlaps"),
        (time(22, 0), time(6, 0), None),  # crosses midnight, 8 hours, clear of the ban
        (time(21, 0), time(6, 0), "too_long"),  # crosses midnight, 9 hours
        (time(4, 0), time(12, 30), "too_long"),  # 8.5 hours
        (time(6, 0), time(12, 0), None),
    ],
)
def test_a_shift_against_the_midday_ban(start: time, end: time, result: str | None) -> None:
    assert shift_conflict(start, end, time(12, 30), time(15, 0), 8.0) == result


def test_without_a_daily_cap_only_the_window_counts() -> None:
    assert shift_conflict(time(4, 0), time(12, 30), time(12, 30), time(15, 0), None) is None
