"""How well an applicant fits the job they applied for: a percentage worked out here, in Python.

The match is skills (55), experience (25), documents ready (10) and available within a month (10).
A model never computes it; it only ever words what these numbers say (rule
RECRUIT_ADVICE_PYTHON_ONLY). The requirements per job category are the company's own and live in
this file, so changing one is a code review, not a prompt edit. This is demo data: the page says so.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

# job category -> (minimum years of experience, required skills)
REQUIREMENTS: dict[str, tuple[int, tuple[str, ...]]] = {
    "Mason": (
        3,
        ("blockwork", "plastering", "tile setting", "reading drawings", "scaffold safety"),
    ),
    "Carpenter": (4, ("formwork", "shuttering", "joinery", "reading drawings", "power tools")),
    "Steel fixer": (
        3,
        ("rebar cutting", "bar bending", "reading drawings", "tying", "crane signals"),
    ),
    "Electrician": (
        4,
        ("conduit", "cable pulling", "panel wiring", "testing", "UAE wiring regulations"),
    ),
    "Plumber": (
        3,
        ("pipe fitting", "drainage", "pressure testing", "reading drawings", "water heaters"),
    ),
    "Painter": (2, ("surface preparation", "spray painting", "texture coating", "waterproofing")),
    "Project manager": (
        8,
        ("scheduling", "cost control", "client reporting", "HSE", "subcontractor management"),
    ),
    "Site engineer": (
        4,
        ("setting out", "quantity surveying", "quality inspection", "AutoCAD", "HSE"),
    ),
    "Safety officer": (
        5,
        ("HSE audits", "risk assessment", "incident reporting", "toolbox talks", "NEBOSH"),
    ),
    "General labour": (1, ("site cleaning", "material handling", "safety basics")),
}
CATEGORIES = tuple(REQUIREMENTS)
AVAILABLE_WITHIN_DAYS = 30


@dataclass(frozen=True)
class Match:
    percent: int
    tier: str  # "strong" (90 and above), "good" (80 and above), "partial"
    matched: list[str]
    missing: list[str]
    reasons: list[str]


def tier_of(percent: int) -> str:
    return "strong" if percent >= 90 else "good" if percent >= 80 else "partial"


def score(
    category: str,
    years: int,
    skills: list[str],
    documents_ready: bool,
    available_from: date | None,
    today: date,
) -> Match:
    """The match of one applicant against the requirements of the category they applied for."""
    min_years, required = REQUIREMENTS.get(category, (0, ()))
    have = {s.strip().lower() for s in skills}
    matched = [s for s in required if s.lower() in have]
    missing = [s for s in required if s.lower() not in have]
    skill_part = 55 * (len(matched) / len(required)) if required else 55
    experience_part = 25 * min(years / min_years, 1) if min_years else 25
    soon = available_from is not None and available_from <= today + timedelta(
        days=AVAILABLE_WITHIN_DAYS
    )
    percent = round(
        skill_part + experience_part + (10 if documents_ready else 0) + (10 if soon else 0)
    )
    reasons = [f"{len(matched)} of {len(required)} required skills"]
    reasons.append(
        f"{years} years of experience (needs {min_years})"
        if years < min_years
        else f"{years} years of experience (meets the {min_years} needed)"
    )
    reasons.append("documents ready" if documents_ready else "documents not ready yet")
    reasons.append("can start within a month" if soon else "cannot start within a month")
    return Match(percent, tier_of(percent), matched, missing, reasons)
