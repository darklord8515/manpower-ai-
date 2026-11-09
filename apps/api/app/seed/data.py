"""Fixed demo inputs, copied from the prototype so the two cannot drift (a test compares them)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

# The seeded "today" (Thursday 5 Nov 2026). The Clock adapter replaces this in the app later.
SEED_TODAY = date(2026, 11, 5)

# The residency visa and the Emirates ID are one document (one expiry, one renewal).
DOC_TYPES = ["Residency visa", "Medical fitness", "Labour card"]
DOC_TYPE_CODE = {
    "Residency visa": "residency_visa",
    "Medical fitness": "medical_fitness",
    "Labour card": "labour_card",
}

# Trade -> trade group, the way the client groups them (Structure, Finishes, MEP, Plant & Transport,
# Supervision, General). The first eight are the trades the demo workers hold; the rest give the
# Add-project form the choices a real contractor needs (nobody on file, so the forecast says recruit).
TRADE_GROUPS: dict[str, str] = {
    "Steel fixer": "Structure",
    "Carpenter": "Structure",
    "Shuttering carpenter": "Structure",
    "Scaffolder": "Structure",
    "Rigger": "Structure",
    "Welder": "Structure",
    "Mason": "Finishes",
    "Tile mason": "Finishes",
    "Painter": "Finishes",
    "Electrician": "MEP",
    "Plumber": "MEP",
    "AC technician": "MEP",
    "Ductman": "MEP",
    "Pipe fitter": "MEP",
    "Equipment operator": "Plant & Transport",
    "Tower crane operator": "Plant & Transport",
    "Hoist operator": "Plant & Transport",
    "Driver light": "Plant & Transport",
    "Driver heavy": "Plant & Transport",
    "Chargehand": "Supervision",
    "Foreman": "Supervision",
    "General labour": "General",
    "Helper": "General",
    "Flagman": "General",
}
ALL_TRADES = list(TRADE_GROUPS)

TRADES_FOR_GEN = ["General labour", "Mason", "Carpenter", "Electrician", "Painter"]

FIRST_NAMES = [
    "Aamir", "Bilal", "Chandan", "Dinesh", "Eshwar", "Farhan", "Ganesh", "Harish", "Irfan",
    "Jagdish", "Kiran", "Lokesh", "Mahesh", "Naresh", "Omar", "Pradeep", "Qasim", "Rohit",
    "Sandeep", "Tariq", "Umesh", "Vijay", "Waqar", "Yasir", "Zahid", "Anwar", "Basheer",
    "Devendra", "Elias", "Firoz",
]  # fmt: skip
LAST_NAMES = [
    "Ali", "Barua", "Chaudhry", "Dhakal", "Ekka", "Fernandes", "Gurung", "Hossain", "Iqbal",
    "Jha", "Khan", "Lama", "Mondal", "Nair", "Oraon", "Pandey", "Rai", "Sheikh", "Thakur",
    "Uddin", "Verma", "Yadav", "Zaman", "Ansari", "Biswas", "Chettri", "Das", "Mirza",
]  # fmt: skip


@dataclass(frozen=True)
class ProjectSeed:
    code: str
    name: str
    status: str  # project_status enum value
    starts: date
    ends: date
    deployed: int
    # (plural trade name, planned, deployed)
    trades: tuple[tuple[str, int, int], ...]
    outdoor: bool = True
    sites: int = 1


PROJECTS: tuple[ProjectSeed, ...] = (
    ProjectSeed("RAK-01", "Marina Waterfront", "active", date(2026, 3, 1),
                date(2027, 8, 31), 27,
                (("Equipment operators", 8, 7), ("General labour", 14, 13), ("Masons", 8, 7)),
                sites=2),
    ProjectSeed("RAK-02", "Aila Homes", "active", date(2026, 5, 1), date(2027, 1, 31), 24,
                (("Steel fixers", 8, 8), ("Carpenters", 8, 8), ("Masons", 8, 8))),
    ProjectSeed("RAK-03", "Greens", "active", date(2026, 7, 1),
                date(2027, 9, 30), 18,
                (("Steel fixers", 10, 2), ("Masons", 6, 6), ("Carpenters", 6, 6),
                 ("General labour", 4, 4))),
    ProjectSeed("RAK-04", "Rak Court", "active", date(2026, 8, 15), date(2027, 3, 31),
                12, (("Electricians", 6, 6), ("Plumbers", 4, 4), ("Painters", 2, 2)),
                outdoor=False),
    ProjectSeed("RAK-05", "Beach Club", "active", date(2026, 2, 1),
                date(2026, 12, 15), 15,
                (("Masons", 6, 6), ("Carpenters", 5, 4), ("General labour", 5, 5))),
    ProjectSeed("RAK-06", "Saij", "active", date(2026, 6, 1), date(2027, 5, 31),
                16, (("Steel fixers", 8, 5), ("Carpenters", 8, 6), ("General labour", 6, 5))),
    ProjectSeed("RAK-07", "Falcon Villas", "planning", date(2027, 2, 12),
                date(2027, 12, 31), 0,
                (("Masons", 10, 0), ("Steel fixers", 8, 0), ("General labour", 6, 0))),
)  # fmt: skip


@dataclass(frozen=True)
class NamedWorker:
    code: str
    name: str
    trade: str
    level: int
    docs_until: date
    doc_type: str = "Residency visa"  # which document `docs_until` belongs to
    available_from: date = SEED_TODAY  # later than today = still on RAK-02 until then
    project: str | None = None
    placed: str | None = None  # a project the worker is deployed on although the source had none


def _d(y: int, m: int, d: int) -> date:
    return date(y, m, d)


# The Allocation Board pool (prototype POOL).
POOL: tuple[NamedWorker, ...] = (
    NamedWorker("EMP-0142", "Anil Kumar", "Steel fixer", 4, _d(2027, 8, 3)),
    NamedWorker("EMP-0107", "Bikash Rai", "Steel fixer", 4, _d(2027, 6, 14)),
    NamedWorker("EMP-0118", "Mohammed Salim", "Steel fixer", 3, _d(2027, 5, 20)),
    NamedWorker("EMP-0125", "Suresh Nair", "Steel fixer", 3, _d(2027, 3, 30)),
    NamedWorker("EMP-0131", "Joseph Mathew", "Steel fixer", 3, _d(2027, 9, 11)),
    NamedWorker("EMP-0133", "Ramesh Yadav", "Steel fixer", 3, _d(2027, 4, 2)),
    NamedWorker("EMP-0139", "Kamal Hossain", "Steel fixer", 3, _d(2027, 7, 19), available_from=_d(2026, 11, 7)),
    NamedWorker("EMP-0146", "Dilip Gurung", "Steel fixer", 3, _d(2028, 2, 1)),
    NamedWorker("EMP-0111", "Faisal Ahmed", "Steel fixer", 4, _d(2027, 1, 12)),
    NamedWorker("EMP-0120", "Prakash Shrestha", "Steel fixer", 3, _d(2026, 12, 20)),
    NamedWorker("EMP-0150", "Rajesh Thapa", "Steel fixer", 2, _d(2027, 10, 1), available_from=_d(2026, 11, 10)),
    NamedWorker("EMP-0152", "Nabin Magar", "Steel fixer", 3, _d(2027, 11, 30)),
    NamedWorker("EMP-0170", "Ram Bahadur", "General labour", 2, _d(2027, 6, 1)),
    NamedWorker("EMP-0171", "Abdul Karim", "General labour", 1, _d(2027, 1, 20)),
    NamedWorker("EMP-0172", "Gopal Das", "General labour", 2, _d(2027, 9, 9)),
    NamedWorker("EMP-0160", "Vinod Pillai", "Electrician", 4, _d(2027, 12, 1)),
    NamedWorker("EMP-0161", "Sabin KC", "Electrician", 3, _d(2027, 8, 15)),
    NamedWorker("EMP-0162", "Arif Hussain", "Electrician", 3, _d(2027, 1, 5), doc_type="Medical fitness"),
    NamedWorker("EMP-0163", "Thomas Varghese", "Electrician", 2, _d(2027, 5, 5)),
    NamedWorker("EMP-0180", "Sunil Perera", "Carpenter", 3, _d(2027, 4, 4)),
    NamedWorker("EMP-0181", "Manoj Tamang", "Carpenter", 3, _d(2027, 6, 6)),
)  # fmt: skip

STEEL_RAK02 = (
    ("EMP-0301", "Arjun Thapa"), ("EMP-0302", "Mohan Das"), ("EMP-0303", "Shiva Karki"),
    ("EMP-0304", "Rakesh Paswan"), ("EMP-0305", "Naveen Kumar"), ("EMP-0306", "Salim Uddin"),
    ("EMP-0307", "Tek Bahadur"), ("EMP-0308", "Ajith Menon"),
)  # fmt: skip

# The Forecast workers (prototype FC_WORKERS). Level 3 for everyone; `placed` puts the ones the
# prototype leaves without a project onto a project so the totals match the project cards.
FC_WORKERS: tuple[NamedWorker, ...] = (
    NamedWorker("EMP-0210", "Deepak Sharma", "Mason", 3, _d(2027, 11, 30)),
    NamedWorker("EMP-0211", "Imtiaz Ahmed", "Mason", 3, _d(2027, 9, 15)),
    NamedWorker("EMP-0201", "Hari Lama", "Mason", 3, _d(2027, 8, 1), project="RAK-02"),
    NamedWorker("EMP-0202", "Bilal Khan", "Mason", 3, _d(2027, 10, 10), project="RAK-02"),
    NamedWorker("EMP-0220", "Ganesh Rai", "Mason", 3, _d(2027, 12, 1), project="RAK-05"),
    NamedWorker("EMP-0221", "Joseph Fernandes", "Mason", 3, _d(2027, 7, 7), project="RAK-05"),
    NamedWorker("EMP-0230", "Asif Raza", "Mason", 3, _d(2027, 12, 12), placed="RAK-03"),
    NamedWorker("EMP-0231", "Suman Tamang", "Mason", 3, _d(2027, 3, 20), placed="RAK-04"),
    NamedWorker("EMP-0232", "Kiran Bhatt", "Mason", 3, _d(2027, 4, 2), doc_type="Medical fitness", placed="RAK-04"),
    NamedWorker("EMP-0233", "Rafiq Islam", "Mason", 3, _d(2027, 10, 1), placed="RAK-03"),
    NamedWorker("EMP-0234", "Prem Gurung", "Mason", 3, _d(2027, 9, 9), project="RAK-01"),
    *(NamedWorker(code, name, "Steel fixer", 3, _d(2027, 9, 30), project="RAK-02") for code, name in STEEL_RAK02),
    NamedWorker("EMP-0410", "Ramesh Chaudhary", "General labour", 3, _d(2027, 8, 8), placed="RAK-04"),
    NamedWorker("EMP-0411", "Abdul Hamid", "General labour", 3, _d(2027, 10, 20), placed="RAK-04"),
    NamedWorker("EMP-0412", "Binod Yadav", "General labour", 3, _d(2027, 12, 2), placed="RAK-03"),
    NamedWorker("EMP-0413", "Sohel Rana", "General labour", 3, _d(2027, 7, 30), placed="RAK-03"),
    NamedWorker("EMP-0420", "Dev Raj", "General labour", 3, _d(2027, 9, 1), project="RAK-06"),
    NamedWorker("EMP-0421", "Kamal Thapa", "General labour", 3, _d(2027, 11, 11), project="RAK-06"),
    NamedWorker("EMP-0422", "Anwar Hossain", "General labour", 3, _d(2027, 6, 30), project="RAK-06"),
)  # fmt: skip

# Documents running out: days from the seeded today. 7 more inside 30 days (Sanjeev Rana's visa is
# the 8th), 10 in 31-60 and 14 in 61-90; the named workers above supply 1 and 3 more.
SOON_OFFSETS = [
    3, 12, 15, 19, 22, 26, 29,
    33, 35, 38, 41, 44, 47, 50, 53, 56, 59,
    63, 64, 66, 70, 72, 73, 75, 78, 80, 82, 84, 86, 88, 90,
]  # fmt: skip
EXPIRED_OFFSETS = (-4, -11)

# Contracts and exits. Named workers by code; generated workers by (project, trade), the first free one.
# The named ones are free steel fixers (the surplus), so the RAK-07 story for masons and labour is
# unchanged: they show up under "Not counted" with the reason.
NAMED_CONTRACT_ENDS: dict[str, date] = {"EMP-0152": date(2027, 3, 15)}
NAMED_EXITS: dict[str, tuple[date, str]] = {"EMP-0125": (date(2027, 1, 31), "resigned")}
GENERATED_CONTRACT_ENDS: tuple[tuple[str, str, date], ...] = (
    ("RAK-01", "Equipment operator", date(2026, 12, 31)),  # ends before the job does
    ("RAK-04", "Electrician", date(2027, 1, 20)),
    ("RAK-01", "General labour", date(2027, 6, 30)),
)
GENERATED_EXITS: tuple[tuple[str, str, date, str], ...] = (
    ("RAK-01", "General labour", date(2026, 12, 15), "terminated"),
)
# The first generated worker who is "on leave" has in fact left without notice.
ABSCONDED_ON = date(2026, 10, 30)

# Recruitment already in progress: (project, trade, headcount, stage, source, expected arrival,
# the named worker it replaces or None). One arrives after RAK-07 starts, which no spreadsheet shows.
RECRUITMENT: tuple[tuple[str, str, int, str, str, date, str | None], ...] = (
    ("RAK-07", "General labour", 1, "visa_processing", "overseas", date(2027, 3, 2), None),
    ("RAK-07", "Mason", 2, "offer_issued", "overseas", date(2027, 3, 1), None),
    ("RAK-01", "Steel fixer", 1, "sourcing", "local", date(2027, 2, 1), "EMP-0125"),
)

# People released from a project before it ends: (project, trade, last day). The first matching
# worker on that project is used, so the data repeats. They make the RAK-07 forecast (starts
# 12 Feb 2027, 7-day handover buffer) show people who finish just before the buffer closes and a
# few days after the start.
EARLY_ENDS: tuple[tuple[str, str, date], ...] = (
    ("RAK-01", "Mason", date(2027, 2, 8)),  # inside the handover buffer
    ("RAK-01", "Mason", date(2027, 2, 20)),  # 8 days after the start
    ("RAK-01", "Mason", date(2027, 2, 24)),  # 12 days after the start
    ("RAK-06", "Steel fixer", date(2027, 2, 18)),
    ("RAK-06", "General labour", date(2027, 2, 26)),
)

# Approved leave: (project, trade, first day, last day). The first matching worker not already used.
LEAVES: tuple[tuple[str, str, date, date], ...] = (
    ("RAK-01", "Mason", date(2027, 2, 1), date(2027, 2, 28)),
    ("RAK-05", "Mason", date(2027, 2, 10), date(2027, 3, 10)),
)

# Open staffing requests raised by the HR Executive, for the Allocation Board:
# (project, from, until, priority, note, ((trade, headcount, minimum level), ...)).
# SR-2026-0001 asks for 7 steel fixers: 7 people are cleared, 3 are left out with a reason (two visas
# end first, one is resigning). SR-2026-0002 asks for 3 carpenters but only 2 are free, so it shows
# a partial fill.
REQUESTS: tuple[tuple[str, date, date, int, str, tuple[tuple[str, int, int], ...]], ...] = (
    ("RAK-03", date(2026, 11, 8), date(2027, 2, 3), 2,
     "Steel fixers for the Block B slab, from Sunday", (("Steel fixer", 7, 2),)),
    ("RAK-06", date(2026, 11, 16), date(2027, 3, 31), 3,
     "Carpenters for the warehouse units", (("Carpenter", 3, 3),)),
)  # fmt: skip

# The nine seeded Mobilizing workers (in code order) become MOB-2026-0101 to 0109 with their tasks
# part-way done: which of the five checklist items (documents, bed, transport, ppe, induction) are
# done. Two are ready to report, five are part-way and two have not started. The seventh (0107) is
# the stuck one: its documents check and induction are open, so the documents task is overdue.
MOBILIZATION_FIRST_NUMBER = 101
MOBILIZATION_DONE: tuple[tuple[str, ...], ...] = (
    ("documents", "bed", "transport", "ppe", "induction"),
    ("documents", "bed", "transport", "ppe", "induction"),
    ("documents", "bed", "transport", "ppe"),
    ("documents", "bed", "transport"),
    ("documents", "bed"),
    ("documents",),
    ("bed", "transport", "ppe"),
    ("documents",),
    (),
)


# Sites whose default shift ends later than the usual 12:30: (project, site number) -> end time.
# RAK-01 site 2 works until 15:30, which runs into the (provisional) 2027 midday ban.
SITE_SHIFT_ENDS: dict[tuple[str, int], str] = {("RAK-01", 2): "15:30"}
