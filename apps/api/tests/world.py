"""A small builder for forecast scenarios: put exactly the projects and people a test needs into the
database. Each scenario has its own trade ("Test trade") so the 150 seeded workers cannot interfere.

The simulated date is Thursday 5 Nov 2026 and the new project starts on 12 Feb 2027:
  handover buffer 7 days  -> people must finish by 5 Feb 2027
  late window 21 days     -> could join late if they finish by 5 Mar 2027
  cover window            -> 12 Feb to 13 May 2027 (90 days)
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Engine, text

START = date(2027, 2, 12)


class World:
    """Small helpers that put exactly the people and projects a test needs into the database."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        with engine.begin() as c:
            self.trade_id = c.execute(
                text(
                    "INSERT INTO trades (code, name) VALUES ('test_trade', 'Test trade') RETURNING id"
                )
            ).scalar_one()

    def project(
        self, code: str, starts: date, ends: date | None, need: int = 0, status: str = "active"
    ) -> uuid.UUID:
        with self.engine.begin() as c:
            pid = c.execute(
                text(
                    """INSERT INTO projects (code, name, status, starts_on, ends_on)
                       VALUES (:code, :name, CAST(:status AS project_status), :starts, :ends)
                       RETURNING id"""
                ),
                {"code": code, "name": f"Project {code}", "status": status, "starts": starts,
                 "ends": ends},
            ).scalar_one()  # fmt: skip
            if need:
                c.execute(
                    text(
                        """INSERT INTO manpower_requirements (project_id, trade_id, headcount, period)
                           VALUES (:p, :t, :n, daterange(:starts, :ends, '[]'))"""
                    ),
                    {"p": pid, "t": self.trade_id, "n": need, "starts": starts,
                     "ends": ends or date(2027, 12, 31)},
                )  # fmt: skip
        return pid

    def worker(
        self,
        code: str,
        availability: str = "available",
        residency_until: date = date(2028, 6, 1),
        level: int = 3,
        contract_end: date | None = None,
        exit_on: date | None = None,
        exit_reason: str | None = None,
        employment: str = "active",
    ) -> uuid.UUID:
        with self.engine.begin() as c:
            wid = c.execute(
                text(
                    """INSERT INTO employees
                           (employee_code, full_name, primary_trade_id, availability,
                            contract_end_on, exit_on, exit_reason, employment_status)
                       VALUES (:code, :name, :trade, CAST(:availability AS availability_state),
                               :contract_end, :exit_on, CAST(:exit_reason AS exit_reason),
                               CAST(:employment AS employment_status))
                       RETURNING id"""
                ),
                {"code": code, "name": f"Worker {code}", "trade": self.trade_id,
                 "availability": availability, "contract_end": contract_end,
                 "exit_on": exit_on, "exit_reason": exit_reason, "employment": employment},
            ).scalar_one()  # fmt: skip
            c.execute(
                text(
                    "INSERT INTO employee_skills (employee_id, trade_id, level) VALUES (:e, :t, :l)"
                ),
                {"e": wid, "t": self.trade_id, "l": level},
            )
            for doc, until in (
                ("residency_visa", residency_until),
                ("medical_fitness", date(2028, 6, 1)),
            ):
                c.execute(
                    text(
                        """INSERT INTO employee_documents (employee_id, doc_type, expiry_date, status)
                           VALUES (:e, CAST(:d AS document_type), :u, 'verified')"""
                    ),
                    {"e": wid, "d": doc, "u": until},
                )
        return wid

    def assign(
        self, worker: uuid.UUID, project: uuid.UUID, first: date, last: date | None,
        status: str = "active",
    ) -> None:  # fmt: skip
        with self.engine.begin() as c:
            c.execute(
                text(
                    """INSERT INTO employee_assignments (employee_id, project_id, period, status)
                       VALUES (:e, :p, daterange(:first, :last, '[]'), CAST(:status AS assignment_status))"""
                ),
                {"e": worker, "p": project, "first": first, "last": last, "status": status},
            )

    def leave(self, worker: uuid.UUID, first: date, last: date) -> None:
        with self.engine.begin() as c:
            c.execute(
                text(
                    """INSERT INTO leave_records (employee_id, leave_type, period, approved)
                       VALUES (:e, 'annual', daterange(:f, :l, '[]'), true)"""
                ),
                {"e": worker, "f": first, "l": last},
            )

    def recruitment(
        self,
        project: uuid.UUID,
        headcount: int,
        status: str = "open",
        arrival: date | None = None,
        source: str = "overseas",
    ) -> None:
        with self.engine.begin() as c:
            c.execute(
                text(
                    """INSERT INTO recruitment_requests
                           (request_no, project_id, trade_id, headcount, needed_by, reason, status,
                            requested_by, source, expected_arrival)
                       SELECT 'RR-TEST-' || substr(md5(random()::text), 1, 8), :p, :t, :n, :by,
                              'Needed for the new site', CAST(:s AS recruitment_status), id,
                              CAST(:source AS recruit_source), :arrival
                       FROM users LIMIT 1"""
                ),
                {
                    "p": project,
                    "t": self.trade_id,
                    "n": headcount,
                    "by": date(2027, 1, 13),
                    "s": status,
                    "source": source,
                    "arrival": arrival,
                },
            )


def scenario(engine: Engine, need: int = 6) -> World:
    """One of each kind of person, so every rule is visible in one forecast."""
    w = World(engine)
    target = w.project("T-NEW", START, date(2027, 12, 31), need=need, status="planning")
    old = w.project("T-OLD", date(2026, 3, 1), date(2027, 8, 31))
    other = w.project("T-OTH", date(2027, 2, 1), date(2027, 6, 1))
    w.worker("W01")  # free now
    w.leave(w.worker("W02"), date(2027, 2, 1), date(2027, 2, 20))  # approved leave in the window
    w.worker("W03", residency_until=date(2027, 3, 1))  # visa ends inside the window
    w.assign(
        w.worker("W04", "deployed"), old, date(2026, 3, 1), date(2027, 1, 31)
    )  # finishes early
    w.assign(
        w.worker("W05", "deployed"), old, date(2026, 3, 1), date(2027, 2, 5)
    )  # exactly start-7
    w.assign(w.worker("W06", "deployed"), old, date(2026, 3, 1), date(2027, 2, 6))  # inside buffer
    w.assign(w.worker("W07", "deployed"), old, date(2026, 3, 1), date(2027, 2, 22))  # 10 days late
    w.assign(w.worker("W08", "deployed"), old, date(2026, 3, 1), date(2027, 3, 5))  # exactly +21
    w.assign(
        w.worker("W09", "deployed"), old, date(2026, 3, 1), date(2027, 3, 6)
    )  # one day too late
    w.assign(w.worker("W10", "deployed"), old, date(2026, 3, 1), None)  # open-ended
    w.worker("W11", "unavailable")
    w12 = w.worker("W12")
    w.assign(w12, other, date(2027, 2, 1), date(2027, 6, 1), status="planned")  # reserved
    w.assign(w.worker("W13", "deployed"), target, START, None)  # already on the new project
    return w
