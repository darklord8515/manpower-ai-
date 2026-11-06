"""Application settings, validated at startup.

Demo-only choices (free LLMs, local files, simulated clock, role switcher) live in settings, so
going to production is a configuration change. `validate_for_environment` is the production guard:
with APP_ENV=production the API refuses to start on any demo-only setting.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

REPO_ROOT = Path(__file__).resolve().parents[3]
MIN_SECRET_LENGTH = 32


class AppEnv(StrEnum):
    LOCAL = "local"
    TEST = "test"
    DEMO = "demo"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: AppEnv = AppEnv.LOCAL
    demo_mode: bool = False
    simulated_clock: bool = False

    # Database. The app uses the pooled URL; migrations use the direct one (Neon).
    database_url: str = "postgresql+psycopg://constructiq_app:change-me@localhost:5432/constructiq"
    database_url_direct: str = ""
    database_pooled: bool = False  # true behind PgBouncer transaction mode: no prepared statements
    # Local Docker only: lets migrations connect as the database owner without a second URL.
    postgres_password: str = ""
    postgres_port: int = 5432

    # Storage adapter
    storage_backend: Literal["local", "s3"] = "local"

    # LLM tiers (provider + model come from config, never from code). *_free is true for
    # Groq / OpenRouter :free / Ollama and is refused in production.
    llm_tier_light_provider: Literal["openai_compatible", "anthropic"] = "openai_compatible"
    llm_tier_light_model: str = ""
    llm_tier_light_free: bool = True
    llm_tier_mid_provider: Literal["openai_compatible", "anthropic"] = "openai_compatible"
    llm_tier_mid_model: str = ""
    llm_tier_mid_free: bool = True

    # Business config
    doc_check_default_horizon_days: int = Field(default=90, ge=1, le=365)
    transfer_buffer_days: int = Field(default=7, ge=0, le=60)
    forecast_doc_horizon_days: int = Field(default=90, ge=1, le=365)
    forecast_window_days: int = Field(default=120, ge=1, le=730)
    approval_wait_hours: int = Field(default=24, ge=1, le=240)

    # Secrets (never committed; read from .env or the host's secret store)
    secret_key: str = ""
    n8n_hmac_secret: str = ""
    # Password of the seeded demo users. Only the seed script reads it; refused in production.
    demo_password: str = ""

    cors_origins: str = "http://localhost:3000"

    @property
    def is_production(self) -> bool:
        return self.app_env is AppEnv.PRODUCTION

    @property
    def migration_url(self) -> str:
        """Owner connection for migrations and seeding (the app role cannot create tables)."""
        if self.database_url_direct:
            return self.database_url_direct
        if self.is_production:
            raise ConfigError("DATABASE_URL_DIRECT is required to run migrations in production")
        if not self.postgres_password:
            raise ConfigError(
                "Set DATABASE_URL_DIRECT, or POSTGRES_PASSWORD for the local Docker database"
            )
        return URL.create(
            "postgresql+psycopg",
            username="postgres",
            password=self.postgres_password,
            host="localhost",
            port=self.postgres_port,
            database="constructiq",
        ).render_as_string(hide_password=False)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


class ConfigError(RuntimeError):
    """Raised at startup when the configuration is unsafe for the environment."""


def production_problems(s: Settings) -> list[str]:
    """Every reason this configuration must not run as production. Empty list = fine."""
    problems: list[str] = []
    if s.demo_mode:
        problems.append("DEMO_MODE must be off (it enables the role switcher and demo labels)")
    if s.simulated_clock:
        problems.append("SIMULATED_CLOCK must be off (rule checks must use the real date)")
    if s.storage_backend == "local":
        problems.append("STORAGE_BACKEND=local is development-only; use s3")
    if s.llm_tier_light_free:
        problems.append("LLM tier 'light' points at a free-tier provider (LLM_TIER_LIGHT_FREE)")
    if s.llm_tier_mid_free:
        problems.append("LLM tier 'mid' points at a free-tier provider (LLM_TIER_MID_FREE)")
    for name, value in (("SECRET_KEY", s.secret_key), ("N8N_HMAC_SECRET", s.n8n_hmac_secret)):
        if len(value) < MIN_SECRET_LENGTH:
            problems.append(f"{name} is missing or shorter than {MIN_SECRET_LENGTH} characters")
    if s.demo_password:
        problems.append("DEMO_PASSWORD must not be set (it is the seeded demo accounts' password)")
    if "change-me" in s.database_url:
        problems.append("DATABASE_URL still contains the placeholder password")
    return problems


def validate_for_environment(s: Settings) -> None:
    """The production guard. Called at startup; refuses to start production on demo settings."""
    if not s.is_production:
        return
    problems = production_problems(s)
    if problems:
        raise ConfigError(
            "Refusing to start with APP_ENV=production:\n  - " + "\n  - ".join(problems)
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
