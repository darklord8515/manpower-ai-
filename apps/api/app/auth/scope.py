"""Which employees may this user see? The only source of scope is user_project_access.

Every query on employees, assignments, mobilizations and documents applies `employee_scope`.
A worker outside the caller's scope is not found (404), never "forbidden", so the existence of
the worker is not leaked.
"""

from __future__ import annotations

from typing import Any

from app.auth.deps import AuthUser


def employee_scope(user: AuthUser, permission: str, alias: str = "e") -> tuple[str, dict[str, Any]]:
    """An SQL condition on employees (`alias`) plus its bind parameters.

    - all: everyone.
    - project / site: people with a live assignment on the user's projects (or on the user's own
      sites, for site grants). No access rows means nobody.
    - department: people in the same department as the user's own employee record.
    - own: only the user's own employee record.
    """
    scope = user.scope(permission)
    if scope is None:
        return "FALSE", {}
    if scope == "all":
        return "TRUE", {}
    if scope in ("project", "site"):
        return (
            f"""{alias}.id IN (
                SELECT a.employee_id FROM employee_assignments a
                WHERE a.status IN ('planned', 'active')
                  AND (a.project_id = ANY(:scope_projects) OR a.site_id = ANY(:scope_sites)))""",
            {
                "scope_projects": list(user.whole_projects),
                "scope_sites": list(user.sites),
            },
        )
    if scope == "department":
        if user.employee_id is None:
            return "FALSE", {}
        return (
            f"{alias}.department_id = (SELECT department_id FROM employees WHERE id = :scope_self)",
            {"scope_self": user.employee_id},
        )
    if user.employee_id is None:  # own
        return "FALSE", {}
    return f"{alias}.id = :scope_self", {"scope_self": user.employee_id}


def full_profile(user: AuthUser) -> bool:
    """Whether the user may see a worker beyond name, code, trade and phone.

    HR, managers and supervisors can (they hold staffing or document rights); an employee can see
    their own record. A logistics coordinator gets the narrow projection only, and the document
    lists are closed to them.
    """
    return (
        user.can("staffing:read")
        or user.can("document:verify")
        or user.scope("employee:read") == "own"
    )


def masked(number: str | None) -> str | None:
    """A number with all but the last four characters hidden."""
    return None if number is None else f"•••• {number[-4:]}"


def mask_number(user: AuthUser, number: str | None) -> str | None:
    """Passport and Emirates ID numbers: full only with employee:read_sensitive."""
    if number is None or user.can("employee:read_sensitive"):
        return number
    return masked(number)
