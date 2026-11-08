"""What Python decides before any model is asked.

Restricted questions, greetings and "what can you do" never reach a model. Bare references (an
employee code, a project code) and a few plain phrases are routed by pattern, and the same patterns
are the fallback when no model is reachable, so the simplest questions still get a real answer.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.assistant.intents import Route, available_to, capabilities, employee_code, project_code
from app.ai.redact import RedactionError, check_messages
from app.auth.deps import AuthUser
from app.schemas import ChatAction, ChatAnswer

MAX_QUESTION = 1000

_RESTRICTED = re.compile(
    r"\b(salar(?:y|ies)|wages?|pay\s?slips?|payroll"
    r"|how much (?:is|does|do) .{0,40}(?:paid|earn|make)"
    r"|passport (?:number|no\.?|#)|emirates id|eid number|iqama|visa (?:number|no\.?)"
    r"|(?:document|doc|id|labour card|work permit) (?:number|no\.?)"
    r"|contract value|phone (?:number|no\.?)|mobile (?:number|no\.?)|whatsapp (?:number|no\.?)"
    r"|contact (?:number|details)|(?:his|her|their) (?:number|phone|mobile))\b",
    re.IGNORECASE,
)
_SALARY = re.compile(r"\b(salar(?:y|ies)|wages?|pay\s?slips?|payroll|paid|earn)\b", re.IGNORECASE)
_GREETING = re.compile(
    r"^\s*(hi|hello|hey|salam|salaam|good (?:morning|afternoon|evening)"
    r"|thanks|thank you|thx|ok|okay)\b[\s!.,]*$",
    re.IGNORECASE,
)
_HELP = re.compile(
    r"^\s*(help|what can (?:you|i)\b.*|what do you do|how do(?:es)? (?:this|you) work|who are you)"
    r"[\s?!.]*$",
    re.IGNORECASE,
)
_ATTENTION = re.compile(r"\b(to-?do|todo|what needs (?:my )?attention|needs? attention)\b", re.I)


@dataclass(frozen=True)
class Gated:
    """Either a finished answer, or a route to follow (possibly none: ask the model)."""

    answer: ChatAnswer | None = None
    status: Literal["succeeded", "refused"] = "succeeded"
    route: Route | None = None
    source: str = ""  # how the route was found: "pattern"


def normalise(raw: str) -> str:
    return " ".join("".join(c if c.isprintable() else " " for c in raw).split())


def _refuse(summary: str, why: str, actions: list[ChatAction] | None = None) -> Gated:
    return Gated(
        ChatAnswer(kind="refusal", summary=summary, why=why, actions=actions or []), "refused"
    )


def check(message: str, user: AuthUser) -> Gated:
    """The pre-model checks, in order. A hit is a final answer; a bare reference is a route."""
    try:
        check_messages([{"role": "user", "content": message}])
    except RedactionError:
        return _refuse(
            "That message contains what looks like a phone, passport or ID number, so I stopped "
            "before reading it. Use the employee code instead, for example EMP-0142.",
            "Phone numbers and document numbers are never sent to the assistant or to a model.",
        )
    if _RESTRICTED.search(message):
        if _SALARY.search(message):
            return _refuse(
                "HAMRA AI holds no salary or pay data, so I cannot answer that.",
                "Salary is not stored in this system at all.",
            )
        return _refuse(
            "I never show phone numbers or document numbers in the chat. Open the worker's "
            "profile: the eye icon shows one number to people allowed to see it, and every look "
            "is audited.",
            "Phone and document numbers stay out of the assistant by design.",
            [ChatAction(label="Open Workers", href="/workers")],
        )
    if _GREETING.match(message):
        return Gated(
            ChatAnswer(
                kind="info",
                summary="Hello. Ask me about workers, documents, alerts, projects, forecasts or "
                "staffing requests.",
            )
        )
    if _HELP.match(message):
        lines = capabilities(user)
        return Gated(
            ChatAnswer(
                kind="info",
                summary="I can answer from HAMRA AI's own data, as you: " + " ".join(lines),
                why="Your role decides which of these you can use.",
            )
        )
    stripped = message.strip(" ?.!")
    code = employee_code(stripped)
    if code and re.fullmatch(r"(?i)emp[-\s]?\d{1,4}", stripped):
        return Gated(route=Route(intent="worker", code=code), source="pattern")
    project = project_code(stripped)
    if project and re.fullmatch(r"(?i)[a-z]{2,4}[-\s]?\d{1,3}", stripped):
        return Gated(route=Route(intent="forecast", project=project), source="pattern")
    if _ATTENTION.search(message) and len(message) < 60:
        return Gated(route=Route(intent="alerts", mine=None), source="pattern")
    return Gated()


# -------------------------------------------------------------- the fallback when no model answers


def keyword_route(session: Session, message: str) -> Route | None:
    """A plain-words guess at the intent, used only when no model can be asked. Never invents a
    value: it fills a trade or a project only when the question names one."""
    lower = message.lower()
    project = project_code(message)
    trade = next(
        (
            str(r[0])
            for r in session.execute(text("SELECT name FROM trades"))
            if str(r[0]).lower() in lower or str(r[0]).lower() + "s" in lower
        ),
        None,
    )
    if re.search(r"\b(alerts?|urgent|critical|attention|to-?do)\b", lower):
        return Route(intent="alerts", severity="critical" if "critical" in lower else None)
    if re.search(r"\b(expir\w*|visa|medical|labour card|labor card|permit)\b", lower):
        window = (
            "expired"
            if re.search(r"\b(already|expired)\b", lower)
            else "d90"
            if "90" in lower
            else "d60"
            if "60" in lower
            else "d30"
        )
        return Route(intent="documents", window=window, project=project)
    if re.search(r"\b(forecast|can we staff|gap|short of|shortage)\b", lower) and project:
        return Route(intent="forecast", project=project)
    if re.search(r"\b(requests?|approvals?)\b", lower):
        return Route(intent="requests", project=project)
    if re.search(r"\bprojects?\b", lower) and not trade:
        return Route(intent="projects", project=project)
    if re.search(
        r"\b(available|free|idle|deployed|mobili[sz]ing|leaving|workers?|people)\b", lower
    ):
        status = next(
            (s for s in ("available", "deployed", "mobilizing", "demobilizing") if s in lower),
            "available" if re.search(r"\b(free|idle)\b", lower) else None,
        )
        return Route(intent="workers", trade=trade, project=project, status=status)
    return None


def can_help_with(user: AuthUser) -> list[str]:
    return [i.name for i in available_to(user)]
