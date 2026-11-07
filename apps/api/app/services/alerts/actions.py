"""Which buttons an alert may offer. Only actions that exist today are listed.

An action is a link to a screen that already does the work (`ALERT_ACTIONS`): the permission the
viewer needs is the permission that screen needs, and a button they cannot use is not shown.
Snooze and Dismiss are not listed here; they are offered to anyone with `alert:act`.

Not built, so not offered: send a renewal reminder, remind an approver (Phase 5, n8n), open the site
shifts and request an exemption (no screen for them yet).
"""

from __future__ import annotations

from typing import Any

from app.auth.deps import AuthUser

# action key -> (button label, permission needed to use it)
CATALOG: dict[str, tuple[str, str]] = {
    "open_forecast": ("Open forecast", "forecast:read"),
    "open_allocation": ("Open Allocation", "staffing:read"),
    "open_mobilization": ("Open mobilization", "mobilization:read"),
    "open_worker": ("Open worker", "employee:read"),
}


def action(key: str, **params: Any) -> dict[str, Any]:
    label, _permission = CATALOG[key]
    return {"action": key, "label": label, "params": params}


def allowed(user: AuthUser, actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The actions this person may use, in the order the detector listed them."""
    return [a for a in actions if a.get("action") in CATALOG and user.can(CATALOG[a["action"]][1])]
