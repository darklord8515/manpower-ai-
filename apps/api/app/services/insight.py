"""The one sentence at the top of Home (INSIGHT_PYTHON_ONLY).

Chosen and worded here from a ranked list of rules, from the same numbers as the figures below it.
No model writes or edits it. If nothing needs attention it says so.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.auth.deps import AuthUser
from app.schemas import ExpiryCounts
from app.services.alerts import service as alerts
from app.services.alerts.findings import plural


def _documents(documents: ExpiryCounts) -> str:
    running_out = documents.d30 + documents.expired
    if not running_out:
        return "No documents are running out in the next 30 days."
    verb = "runs" if documents.d30 == 1 else "run"
    already = f", and {documents.expired} already have" if documents.expired else ""
    return f"{plural(documents.d30, 'document')} {verb} out in the next 30 days{already}."


def insight_for(
    session: Session, user: AuthUser, now: datetime, *, short_total: int, documents: ExpiryCounts
) -> str:
    """The MD/CEO hears about shortages first; HR hears about the most urgent alert."""
    if "ceo" in user.roles:
        gap = (
            f"{plural(short_total, 'person', 'people')} short across active projects."
            if short_total
            else "Every active project is fully staffed."
        )
        return f"{gap} {_documents(documents)}"
    if user.can("alert:read"):
        summary = alerts.summary(session, user, now)
        if summary.top:
            more = summary.needs_attention - 1
            tail = f" {more} more need{'s' if more == 1 else ''} attention." if more else ""
            return f"{summary.top[0].title}.{tail}"
        return "Nothing needs attention today."
    return _documents(documents)
