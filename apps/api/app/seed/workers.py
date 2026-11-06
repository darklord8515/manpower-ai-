"""The 150 demo workers: a line-by-line port of the generator in prototype/index.html (`WORKERS`).

tests/test_seed_matches_prototype.py compares this output with a snapshot of the prototype's, so a
change here that is not made there (or the other way round) fails the build.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from app.seed.data import (
    DOC_TYPES,
    EXPIRED_OFFSETS,
    FC_WORKERS,
    FIRST_NAMES,
    LAST_NAMES,
    POOL,
    PROJECTS,
    SEED_TODAY,
    SOON_OFFSETS,
    TRADES_FOR_GEN,
)


@dataclass
class DocSeed:
    type: str
    until: date
    number: str


@dataclass
class WorkerSeed:
    code: str
    name: str
    trade: str
    level: int
    status: str  # available | deployed | mobilizing | unavailable
    project: str | None = None
    reason: str | None = None  # why an unavailable worker is unavailable
    phone: str = ""
    docs: list[DocSeed] = field(default_factory=lambda: [])
    earliest: tuple[date, str] | None = None  # (expiry, document type) of the earliest document

    @property
    def next_doc(self) -> DocSeed:
        return min(self.docs, key=lambda d: d.until)


def _singular(plural: str) -> str:
    return plural[:-1] if plural.endswith("s") else plural


def _doc_number(doc_type: str, i: int, k: int) -> str:
    n = f"{((i + 1) * 7919 + (k + 1) * 104729) % 10_000_000:07d}"
    if doc_type == "Visa":
        return f"784/2025/{n}"
    if doc_type == "Emirates ID":
        return f"784-198{i % 10}-{n}-{k}"
    if doc_type == "Medical fitness":
        return f"MED-{n[1:]}"
    return f"LC{n}"


def build_workers(today: date = SEED_TODAY) -> list[WorkerSeed]:
    used: set[str] = set()
    out: list[WorkerSeed] = []

    def add(worker: WorkerSeed) -> WorkerSeed:
        used.add(worker.name)
        out.append(worker)
        return worker

    for p in POOL:
        later = p.available_from > today
        add(
            WorkerSeed(
                p.code, p.name, p.trade, p.level,
                "deployed" if later else "available",
                "RAK-02" if later else None,
                earliest=(p.docs_until, p.doc_type),
            )
        )  # fmt: skip
    for w in FC_WORKERS:
        project = w.project or w.placed
        add(
            WorkerSeed(
                w.code, w.name, w.trade, w.level,
                "deployed" if project else "available", project,
                earliest=(w.docs_until, w.doc_type),
            )
        )  # fmt: skip
    add(WorkerSeed("EMP-0088", "Sanjeev Rana", "Mason", 3, "deployed", "RAK-01",
                   earliest=(today + timedelta(days=7), "Visa")))  # fmt: skip
    add(WorkerSeed("EMP-0094", "Yusuf Demo", "Equipment operator", 3, "mobilizing", "RAK-01"))

    counter = 0

    def name_at(n: int) -> str:
        k = 0
        while True:
            name = (
                f"{FIRST_NAMES[(n * 7 + k * 5) % len(FIRST_NAMES)]} "
                f"{LAST_NAMES[(n * 11 + k * 3 + 1) % len(LAST_NAMES)]}"
            )
            if name not in used:
                return name
            k += 1

    def generate(
        trade: str, status: str, project: str | None, reason: str | None = None
    ) -> WorkerSeed:
        nonlocal counter
        counter += 1
        level = [2, 3, 3, 4, 2, 3, 1, 4, 3, 5][counter % 10]
        return WorkerSeed(f"EMP-{500 + counter:04d}", name_at(counter), trade, level, status,
                          project, reason)  # fmt: skip

    for project in (p for p in PROJECTS if p.status != "planning"):
        have = sum(1 for w in out if w.status == "deployed" and w.project == project.code)
        mix = [
            _singular(name) for name, _planned, deployed in project.trades for _ in range(deployed)
        ]
        for i in range(project.deployed - have):
            add(generate(mix[i % len(mix)], "deployed", project.code))

    mobilizing_projects = ["RAK-06"] * 5 + ["RAK-05", "RAK-01", "RAK-03"]
    for i, project in enumerate(mobilizing_projects):
        trade = ["Steel fixer", "Carpenter", "General labour", "Mason"][i % 4]
        add(generate(trade, "mobilizing", project))
    reasons = ["On leave"] * 5 + ["Medical"] * 3
    for i, reason in enumerate(reasons):
        add(generate(TRADES_FOR_GEN[i % 5], "unavailable", None, reason))

    for i, w in enumerate(out):
        w.phone = f"+971 5{i % 6} {100 + (i * 37) % 900} {1000 + (i * 7919) % 9000}"
        earliest = w.earliest or (today + timedelta(days=150 + (i * 53) % 560), DOC_TYPES[i % 4])
        gap = 100 if (earliest[0] - today).days <= 90 else 40  # keep other docs clear of the window
        w.docs = [
            DocSeed(
                doc_type,
                earliest[0]
                if doc_type == earliest[1]
                else earliest[0] + timedelta(days=gap + (i * 17 + k * 41) % 170),
                _doc_number(doc_type, i, k),
            )
            for k, doc_type in enumerate(DOC_TYPES)
        ]
        w.earliest = None

    deployed_generated = [w for w in out if w.code >= "EMP-0501" and w.status == "deployed"]
    for k, offset in enumerate(SOON_OFFSETS):
        deployed_generated[k * 2].docs[k % 4].until = today + timedelta(days=offset)
    unavailable = [w for w in out if w.status == "unavailable"][:2]
    for k, worker in enumerate(unavailable):
        worker.docs[0 if k == 0 else 2].until = today + timedelta(days=EXPIRED_OFFSETS[k])
    return out
