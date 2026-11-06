"""The demo workers must match the prototype exactly and add up to the numbers on its screens."""

from __future__ import annotations

import json
from collections import Counter
from datetime import timedelta
from pathlib import Path

from app.seed.data import PROJECTS, SEED_TODAY
from app.seed.workers import build_workers

FIXTURE = Path(__file__).parent / "fixtures" / "prototype_workers.json"


def test_workers_match_the_prototype_snapshot() -> None:
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    actual = [
        {
            "code": w.code,
            "name": w.name,
            "trade": w.trade,
            "level": w.level,
            "status": w.status,
            "project": w.project,
            "reason": w.reason,
            "phone": w.phone,
            "docs": [
                {"type": d.type, "until": d.until.isoformat(), "number": d.number} for d in w.docs
            ],
        }
        for w in build_workers()
    ]
    assert len(actual) == len(expected)
    for got, want in zip(actual, expected, strict=True):
        assert got == want, f"{want['code']} differs from the prototype"


def test_totals_match_the_ceo_dashboard() -> None:
    workers = build_workers()
    by_status = Counter(w.status for w in workers)
    assert len(workers) == 150
    assert by_status == {"deployed": 112, "mobilizing": 9, "available": 21, "unavailable": 8}


def test_each_project_has_the_deployed_headcount_on_its_card() -> None:
    deployed = Counter(w.project for w in build_workers() if w.status == "deployed")
    for project in PROJECTS:
        assert deployed.get(project.code, 0) == project.deployed, project.code


def test_codes_and_names_are_unique() -> None:
    workers = build_workers()
    assert len({w.code for w in workers}) == 150
    assert len({w.name for w in workers}) == 150


def test_documents_running_out_match_the_counts_on_the_dashboards() -> None:
    days = [(d.until - SEED_TODAY).days for w in build_workers() for d in w.docs]
    assert sum(1 for n in days if n < 0) == 2
    assert sum(1 for n in days if 0 <= n <= 30) == 8
    assert sum(1 for n in days if 30 < n <= 60) == 11
    assert sum(1 for n in days if 60 < n <= 90) == 17


def test_the_visa_in_the_to_do_expires_in_seven_days() -> None:
    sanjeev = next(w for w in build_workers() if w.code == "EMP-0088")
    assert sanjeev.next_doc.type == "Visa"
    assert sanjeev.next_doc.until == SEED_TODAY + timedelta(days=7)
