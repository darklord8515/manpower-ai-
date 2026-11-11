"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings, validate_for_environment
from app.routes import (
    agent,
    alerts,
    applicants,
    assistant,
    auth,
    calendar,
    documents,
    employee_import,
    executive,
    forecast,
    health,
    mobilizations,
    preferences,
    project_leadership,
    project_overview,
    projects,
    recruitment,
    requests,
    reservations,
    tracker_import,
    worker_mail,
    worker_photo,
    workers,
    workforce,
)

# Routes that need no login. Everything else must declare require("resource:action") (or
# authenticated()). tests/test_route_guard.py fails if a route is added without a decision.
PUBLIC_PATHS: frozenset[str] = frozenset(
    {
        "/health",
        "/openapi.json",
        "/docs",
        "/docs/oauth2-redirect",
        "/redoc",
        "/auth/config",
        "/auth/login",
        "/auth/demo-login",  # answers 404 unless DEMO_MODE is on
    }
)
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    validate_for_environment(settings)  # production guard: raises ConfigError on demo settings

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        yield

    app = FastAPI(
        title="HAMRA AI API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.middleware("http")
    async def same_origin_only(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """Cross-site request forgery guard: a state-changing request from a browser must come from
        one of our own origins. (The session cookie is also SameSite=Lax.)"""
        origin = request.headers.get("origin")
        if (
            request.method in _UNSAFE_METHODS
            and origin is not None
            and origin not in settings.cors_origin_list
        ):
            return JSONResponse({"detail": "Cross-site request refused"}, status_code=403)
        response = await call_next(request)
        # Personal data: never cached by a browser or proxy, never sniffed into another type.
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(workers.router)
    app.include_router(worker_mail.router)
    app.include_router(worker_photo.router)
    app.include_router(project_leadership.router)
    app.include_router(applicants.router)
    app.include_router(tracker_import.router)
    app.include_router(employee_import.router)
    app.include_router(workforce.router)
    app.include_router(executive.router)
    app.include_router(calendar.router)
    app.include_router(documents.router)
    app.include_router(projects.router)
    app.include_router(project_overview.router)
    app.include_router(forecast.router)
    app.include_router(preferences.router)
    app.include_router(reservations.router)
    app.include_router(recruitment.router)
    app.include_router(requests.router)
    app.include_router(mobilizations.router)
    app.include_router(alerts.router)
    app.include_router(agent.router)
    app.include_router(assistant.router)
    return app


app = create_app()
