"""The detector run on the seeded demo: what it raises, and how alerts are kept up to date.

The simulated date is Thursday 5 Nov 2026, 09:00 Gulf time. The seed ends with one detector run, so
the demo starts with these alerts (see tests/test_mobilizations.py for the nine mobilizations):

  document_expiry      1 expired (not on a project), 2 at 7 days (critical), 6 at 30, 11 at 60,
                       17 at 90. Home counts one more expired document: its owner has left.
  mobilization_stuck   7 (every unfinished checklist reports on 8 Nov, three days away)
  approval_waiting     SR-2026-0001, sent 3 Nov 16:00, 41 hours ago
  upcoming_shortfall   RAK-07, 1 general labour short, 99 days before the start
  midday_ban_conflict  RAK-01 Site 2, a 06:00 to 15:30 shift against the provisional 2027 ban
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.clock import GULF, SimulatedClock
from app.seed.load import seed_demo
from app.services.alerts import engine as alert_engine
from app.services.alerts.detectors import (
    approval_waiting,
    midday_ban_conflict,
    mobilization_stuck,
)
from app.services.alerts.engine import RunSummary, last_run, run_after_change, run_detectors
from tests.support import FixedClock, make_settings

SEED_NOW = datetime(2026, 11, 5, 9, 0, tzinfo=GULF)


def at(hours: float = 0, days: float = 0) -> FixedClock:
    return FixedClock(SEED_NOW + timedelta(hours=hours, days=days))


@pytest.fixture
def db(migrated_db: Engine) -> Engine:
    with migrated_db.begin() as connection:
        seed_demo(connection, make_settings())
    return migrated_db


def run(db: Engine, clock: Any = None, reason: str = "event") -> RunSummary:
    with Session(db) as session:
        summary = run_detectors(session, make_settings(), clock or at(), reason=reason)
        session.commit()
    return summary


def rows(db: Engine, sql: str, **params: Any) -> list[Any]:
    with db.connect() as c:
        return list(c.execute(text(sql), params).all())


def one(db: Engine, sql: str, **params: Any) -> Any:
    with db.connect() as c:
        return c.execute(text(sql), params).scalar_one()


def alert(db: Engine, title_like: str) -> Any:
    return rows(
        db,
        """SELECT id, severity::text, status::text, escalation_level, title, resolution_note
           FROM alerts WHERE title LIKE :t AND status IN ('open', 'in_progress', 'snoozed')""",
        t=title_like,
    )[0]


# ------------------------------------------------------------------------------- the seeded demo


def test_the_demo_starts_with_the_alerts_the_detectors_find(db: Engine) -> None:
    by_type = {
        (r[0], r[1]): r[2]
        for r in rows(
            db,
            """SELECT type::text, severity::text, count(*) FROM alerts
               WHERE status = 'open' GROUP BY 1, 2""",
        )
    }
    assert by_type == {
        ("approval_waiting", "action_needed"): 1,
        ("document_expiry", "critical"): 2,
        ("document_expiry", "action_needed"): 7,
        ("document_expiry", "info"): 28,
        ("midday_ban_conflict", "info"): 1,
        ("mobilization_stuck", "action_needed"): 7,
        ("upcoming_shortfall", "action_needed"): 1,
    }
    thresholds = dict(
        rows(
            db,
            """SELECT facts_json->>'threshold', count(*) FROM alerts
               WHERE type = 'document_expiry' GROUP BY 1""",
        )
    )
    assert thresholds == {"0": 1, "7": 2, "30": 6, "60": 11, "90": 17}
    assert one(db, "SELECT count(*) FROM alerts WHERE NOT is_demo") == 0
    assert alert(db, "Sanjeev Rana: residency visa ends in 7 days (12 Nov 2026)")[1] == "critical"
    assert alert(db, "SR-2026-0001 has waited 41 hours for approval")[2] == "open"
    assert alert(db, "RAK-07 starts 12 Feb 2027: 1 general labour short")[1] == "action_needed"


def test_nothing_sensitive_is_kept_in_an_alert(db: Engine) -> None:
    assert (
        one(
            db,
            """SELECT count(*) FROM alerts
               WHERE facts_json::text ~* '(doc_number|"number"|phone|whatsapp)'
                  OR explanation ~ '[0-9]{3}-[0-9]{4}-[0-9]{7}'""",
        )
        == 0
    )


def test_every_alert_that_was_raised_is_in_the_audit_log(db: Engine) -> None:
    alerts = one(db, "SELECT count(*) FROM alerts")
    assert one(db, "SELECT count(*) FROM audit_log WHERE action = 'alert.raised'") == alerts


def test_running_again_with_nothing_changed_changes_nothing(db: Engine) -> None:
    before = one(db, "SELECT count(*) FROM alerts")
    summary = run(db)
    assert not summary.changed(), summary
    assert one(db, "SELECT count(*) FROM alerts") == before


def test_there_is_one_live_alert_for_each_condition(db: Engine) -> None:
    run(db)
    assert one(
        db,
        """SELECT count(*) = count(DISTINCT dedupe_key) FROM alerts
           WHERE status IN ('open', 'in_progress', 'snoozed')""",
    )
    with pytest.raises(Exception, match="alerts_dedupe_live"), db.begin() as c:
        c.execute(
            text(
                """INSERT INTO alerts (type, severity, subject_type, title, facts_json, dedupe_key)
                   SELECT type, severity, subject_type, title, facts_json, dedupe_key
                   FROM alerts LIMIT 1"""
            )
        )


# ----------------------------------------------------------------------- keeping them up to date


def test_an_alert_resolves_itself_when_the_cause_is_gone(db: Engine) -> None:
    mob = "MOB-2026-0107"
    stuck = alert(db, f"{mob}:%")
    with db.begin() as c:
        c.execute(
            text(
                """UPDATE mobilization_tasks SET status = 'done'
                   WHERE mobilization_id = (SELECT id FROM mobilizations WHERE mob_no = :m)"""
            ),
            {"m": mob},
        )
    summary = run(db)
    assert summary.resolved == 1 and summary.raised == 0
    (_, status, note, by) = rows(
        db,
        "SELECT id, status::text, resolution_note, resolved_by FROM alerts WHERE id = :i",
        i=stuck[0],
    )[0]
    assert status == "resolved" and by is None
    assert note == "Condition cleared: the checklist is done and nothing is overdue"
    assert one(db, "SELECT count(*) FROM audit_log WHERE action = 'alert.resolved'") == 1
    # The other six are still waiting.
    assert (
        one(db, "SELECT count(*) FROM alerts WHERE type = 'mobilization_stuck' AND status = 'open'")
        == 6
    )


def test_an_alert_is_updated_in_place_when_the_facts_change(db: Engine) -> None:
    before = alert(db, "SR-2026-0001 has waited 41 hours for approval")
    summary = run(db, at(hours=10))  # 51 hours: past double the wait
    after = rows(db, "SELECT id, severity::text, title FROM alerts WHERE id = :i", i=before[0])[0]
    assert after[0] == before[0]  # the same alert, not a new one
    assert (after[1], after[2]) == ("critical", "SR-2026-0001 has waited 51 hours for approval")
    assert summary.updated >= 1
    assert one(db, "SELECT count(*) FROM audit_log WHERE action = 'alert.severity_changed'") >= 1


def test_the_stuck_mobilization_turns_critical_two_days_before_the_report(db: Engine) -> None:
    assert {f.severity for f in _stuck(db, at())} == {"action_needed"}  # 3 days
    two_days = _stuck(db, at(days=1))
    assert {f.severity for f in two_days} == {"critical"} and len(two_days) == 7
    # Far from the report day and nothing overdue: nothing to say (0103's tasks are due by 5 Nov).
    with db.begin() as c:
        c.execute(
            text("UPDATE mobilizations SET report_on = '2026-11-20' WHERE mob_no = 'MOB-2026-0103'")
        )
    mobs = {f.facts["mob_no"] for f in _stuck(db, at())}
    assert "MOB-2026-0103" not in mobs and "MOB-2026-0107" in mobs


def _stuck(db: Engine, clock: Any) -> list[Any]:
    with Session(db) as session:
        return mobilization_stuck(session, make_settings(), clock)


@pytest.mark.parametrize(
    ("hours_after_sending", "severity"),
    [(24, None), (24.5, "action_needed"), (48, "action_needed"), (48.5, "critical")],
)
def test_an_approval_waits_24_hours_before_it_is_raised_and_48_before_it_is_critical(
    db: Engine, hours_after_sending: float, severity: str | None
) -> None:
    sent = datetime(2026, 11, 3, 16, 0, tzinfo=GULF)  # SR-2026-0001
    with Session(db) as session:
        result = approval_waiting(
            session, make_settings(), FixedClock(sent + timedelta(hours=hours_after_sending))
        )
    first = [f for f in result if f.facts["request"] == "SR-2026-0001"]
    assert [f.severity for f in first] == ([severity] if severity else [])


def test_the_midday_ban_alert_follows_the_ban_dates_and_says_when_they_are_provisional(
    db: Engine,
) -> None:
    def ban(day: date) -> list[Any]:
        with Session(db) as session:
            return midday_ban_conflict(session, make_settings(), SimulatedClock(day))

    (far,) = ban(date(2026, 11, 5))
    assert far.severity == "info"
    assert far.title == (
        "RAK-01 Site 2: the 06:00 to 15:30 shift runs into the midday ban in 2027 (provisional)"
    )
    assert "planning assumption until MoHRE announces" in far.explanation
    assert far.facts["provisional"] is True and far.actions == []  # no site-shift screen yet
    assert [f.severity for f in ban(date(2027, 5, 20))] == ["action_needed"]  # 26 days before
    assert [f.severity for f in ban(date(2027, 7, 1))] == ["critical"]  # inside the ban
    with db.begin() as c:
        c.execute(
            text("UPDATE project_sites SET default_shift_end = '12:30' WHERE name = 'Site 2'")
        )
    assert ban(date(2026, 11, 5)) == []
    assert run(db).resolved == 1  # the alert goes with it


# --------------------------------------------------------------- dismissed, snoozed, escalated


def _dismiss(db: Engine, alert_id: Any) -> None:
    with db.begin() as c:
        c.execute(
            text(
                """UPDATE alerts SET status = 'dismissed', resolved_at = :now,
                          resolution_note = 'Handled by phone with the worker' WHERE id = :id"""
            ),
            {"id": alert_id, "now": SEED_NOW},
        )


def test_a_dismissed_condition_stays_down_until_it_gets_worse(db: Engine) -> None:
    ninety = rows(
        db,
        """SELECT id, dedupe_key FROM alerts WHERE type = 'document_expiry'
           AND facts_json->>'threshold' = '90' ORDER BY title LIMIT 1""",
    )[0]
    _dismiss(db, ninety[0])
    assert run(db, at(hours=1)).raised == 0  # the same condition: not raised again
    assert one(db, "SELECT count(*) FROM alerts WHERE dedupe_key = :k", k=ninety[1]) == 1
    # A month later it has crossed the next threshold (60 days), so it comes back.
    summary = run(db, at(days=31))
    assert summary.raised >= 1
    now_live = rows(
        db,
        """SELECT facts_json->>'threshold' FROM alerts
           WHERE dedupe_key = :k AND status = 'open'""",
        k=ninety[1],
    )
    assert [r[0] for r in now_live] == ["60"]


def test_a_dismissed_alert_returns_when_its_severity_rises(db: Engine) -> None:
    stuck = alert(db, "MOB-2026-0107:%")
    key = one(db, "SELECT dedupe_key FROM alerts WHERE id = :i", i=stuck[0])
    _dismiss(db, stuck[0])
    run(db)
    assert (
        one(db, "SELECT count(*) FROM alerts WHERE dedupe_key = :k AND status = 'open'", k=key) == 0
    )
    run(db, at(days=1))  # two days before the report: critical
    assert (
        one(
            db,
            "SELECT severity::text FROM alerts WHERE dedupe_key = :k AND status = 'open'",
            k=key,
        )
        == "critical"
    )


def test_a_snooze_ends_and_the_alert_is_open_again_if_the_cause_remains(db: Engine) -> None:
    ref = alert(db, "RAK-07 starts 12 Feb 2027:%")
    with db.begin() as c:
        c.execute(
            text("""UPDATE alerts SET status = 'snoozed', snoozed_until = :until WHERE id = :i"""),
            {"i": ref[0], "until": SEED_NOW + timedelta(hours=4)},
        )
    run(db, at(hours=1))
    assert one(db, "SELECT status::text FROM alerts WHERE id = :i", i=ref[0]) == "snoozed"
    summary = run(db, at(hours=5))
    assert summary.reopened == 1
    assert one(db, "SELECT status::text FROM alerts WHERE id = :i", i=ref[0]) == "open"
    assert one(db, "SELECT count(*) FROM audit_log WHERE action = 'alert.reopened'") == 1


def test_a_snoozed_alert_whose_cause_is_gone_is_resolved_not_reopened(db: Engine) -> None:
    ref = alert(db, "SR-2026-0001 has waited%")
    with db.begin() as c:
        c.execute(
            text("UPDATE alerts SET status = 'snoozed', snoozed_until = :u WHERE id = :i"),
            {"i": ref[0], "u": SEED_NOW + timedelta(hours=4)},
        )
        c.execute(  # the approver answers: the step and the approval are decided
            text("UPDATE approval_requests SET status = 'approved' WHERE created_at < '2026-11-04'")
        )
    run(db, at(hours=5))
    assert one(db, "SELECT status::text FROM alerts WHERE id = :i", i=ref[0]) == "resolved"


def test_untaken_alerts_move_up_after_the_configured_hours(db: Engine) -> None:
    labour = alert(db, "Farhan Ali: labour card ends in 15 days%")  # action needed
    sanjeev = alert(db, "Sanjeev Rana: residency visa ends in 7 days%")  # critical
    info = alert(db, "RAK-01 Site 2:%")[0]  # information, and far from changing

    def level(alert_id: Any) -> int:
        return int(one(db, "SELECT escalation_level FROM alerts WHERE id = :i", i=alert_id))

    run(db, at(hours=3.5))
    assert (level(sanjeev[0]), level(labour[0])) == (0, 0)
    run(db, at(hours=4))  # critical: 4 hours to the HR Manager
    assert (level(sanjeev[0]), level(labour[0])) == (1, 0)
    run(db, at(hours=8))  # critical: 8 hours to the Operations Manager
    assert level(sanjeev[0]) == 2
    run(db, at(hours=24))  # action needed: 24 hours
    assert level(labour[0]) == 1
    run(db, at(hours=48))
    assert level(labour[0]) == 2
    run(db, at(hours=100))
    assert level(info) == 0  # information never escalates
    audits = one(db, "SELECT count(*) FROM audit_log WHERE action = 'alert.escalated'")
    assert audits >= 4
    assert one(db, "SELECT count(*) FROM alerts WHERE last_escalated_at IS NOT NULL") >= 2


def test_an_alert_someone_has_taken_or_snoozed_does_not_escalate(db: Engine) -> None:
    taken = alert(db, "Sanjeev Rana: residency visa ends in 7 days%")
    with db.begin() as c:
        c.execute(text("UPDATE alerts SET status = 'in_progress' WHERE id = :i"), {"i": taken[0]})
    run(db, at(hours=30))
    assert one(db, "SELECT escalation_level FROM alerts WHERE id = :i", i=taken[0]) == 0


# ----------------------------------------------------------------------- the run itself


def test_the_last_scheduled_run_is_remembered_but_runs_after_a_change_are_not_logged(
    db: Engine,
) -> None:
    with Session(db) as session:
        assert last_run(session) == SEED_NOW  # the seed's own run
    run(db, at(hours=2))  # after a change: not logged
    with Session(db) as session:
        assert last_run(session) == SEED_NOW
    run(db, at(hours=9), reason="schedule")
    with Session(db) as session:
        assert last_run(session) == SEED_NOW + timedelta(hours=9)
    assert one(db, "SELECT count(*) FROM audit_log WHERE action = 'alerts.detectors_run'") == 2


def test_a_detector_that_fails_never_fails_the_change_it_follows(
    db: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_: Any) -> list[Any]:
        raise RuntimeError("a detector bug")

    monkeypatch.setitem(alert_engine.DETECTORS, "document_expiry", broken)
    with Session(db) as session:
        run_after_change(session, make_settings(), at())  # does not raise
        assert session.execute(text("SELECT count(*) FROM alerts")).scalar_one() > 0  # still usable
