"""Every route is either explicitly public or declares what it needs.

A route that is neither fails here, so a new endpoint can never ship without a decision about who
may call it: `require("resource:action")` for data, `authenticated()` for "any signed-in user".
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute
from starlette.routing import Route

from app.auth.deps import AUTHENTICATED
from app.main import PUBLIC_PATHS, create_app

PERMISSION_FORMAT = "resource:action"


def _declared(dependant: Dependant) -> Iterator[str]:
    for dependency in dependant.dependencies:
        permission = getattr(dependency.call, "permission", None)
        if isinstance(permission, str):
            yield permission
        yield from _declared(dependency)


def _routes() -> list[APIRoute | Route]:
    return [r for r in create_app().routes if isinstance(r, APIRoute | Route)]


def test_every_route_is_public_on_purpose_or_declares_a_permission() -> None:
    undecided = [
        r.path
        for r in _routes()
        if r.path not in PUBLIC_PATHS
        and not (isinstance(r, APIRoute) and any(_declared(r.dependant)))
    ]
    assert undecided == [], f"Routes without a permission decision: {undecided}"


def test_declared_permissions_look_like_resource_colon_action() -> None:
    for route in _routes():
        if not isinstance(route, APIRoute) or route.path in PUBLIC_PATHS:
            continue
        for permission in _declared(route.dependant):
            assert permission == AUTHENTICATED or ":" in permission, (
                f"{route.path} declares '{permission}', expected {PERMISSION_FORMAT}"
            )


def test_the_public_list_is_short_and_known() -> None:
    assert {
        "/health", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc",
        "/auth/config", "/auth/login", "/auth/demo-login",
    } == PUBLIC_PATHS  # fmt: skip
