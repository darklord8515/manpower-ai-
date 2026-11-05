"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings, validate_for_environment
from app.routes import health

# Routes that need no permission. Everything else must declare require("resource:action")
# (added with RBAC). tests/test_route_guard.py fails if a route is added without a decision.
PUBLIC_PATHS: frozenset[str] = frozenset(
    {"/health", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    validate_for_environment(settings)  # production guard: raises ConfigError on demo settings

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        yield

    app = FastAPI(
        title="CONSTRUCTIQ API",
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
    app.include_router(health.router)
    return app


app = create_app()
