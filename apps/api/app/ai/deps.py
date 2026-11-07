"""FastAPI dependencies for the AI layer. Tests replace these with a scripted model."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.ai.llm import LLMClient, client_for
from app.config import Settings, get_settings


def light_client(settings: Annotated[Settings, Depends(get_settings)]) -> LLMClient | None:
    """The `light` tier model, or None when that tier is off."""
    return client_for(settings, "light")


def mid_client(settings: Annotated[Settings, Depends(get_settings)]) -> LLMClient | None:
    """The `mid` tier model, or None when that tier is off."""
    return client_for(settings, "mid")
