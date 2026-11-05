"""Every route is either explicitly public or must declare a permission.

Today only /health and the API docs are public. When RBAC lands, this test is extended to assert
that every other route has a `require("resource:action")` dependency; until then it fails if any
route is added, forcing an explicit decision.
"""

from __future__ import annotations

from fastapi.routing import APIRoute
from starlette.routing import Route

from app.main import PUBLIC_PATHS, create_app


def test_no_route_exists_without_an_explicit_decision() -> None:
    app = create_app()
    undecided = [
        route.path
        for route in app.routes
        if isinstance(route, APIRoute | Route) and route.path not in PUBLIC_PATHS
    ]
    assert undecided == [], f"Routes without a permission decision: {undecided}"
