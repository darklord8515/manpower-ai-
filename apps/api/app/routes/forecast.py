"""The manpower forecast for a project: who could join it, trade by trade."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser, get_clock, get_settings, require
from app.clock import Clock
from app.config import Settings
from app.db import get_session
from app.schemas import ProjectForecast
from app.services.forecast import ForecastError, forecast_project

router = APIRouter(tags=["forecast"])


@router.get("/projects/{code}/forecast")
def project_forecast(
    code: str,
    session: Annotated[Session, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    settings: Annotated[Settings, Depends(get_settings)],
    user: Annotated[AuthUser, Depends(require("forecast:read"))],
    start: Annotated[date | None, Query(description="What-if start date")] = None,
) -> ProjectForecast:
    try:
        result = forecast_project(session, user, settings, code, clock.today(), start)
    except ForecastError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error
    if result is None:  # also when the project exists but is outside the caller's scope
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return result
