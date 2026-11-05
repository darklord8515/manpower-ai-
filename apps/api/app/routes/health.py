"""Liveness and readiness. The only routes that are public (no permission)."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    db: Literal["ok", "down"]
    env: str


@router.get("/health", response_model=Health)
def health(
    response: Response,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Health:
    try:
        session.execute(text("SELECT 1"))
        db: Literal["ok", "down"] = "ok"
    except SQLAlchemyError:
        db = "down"
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return Health(status="ok" if db == "ok" else "degraded", db=db, env=settings.app_env.value)
