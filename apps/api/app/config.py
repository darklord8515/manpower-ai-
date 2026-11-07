"""Application settings, validated at startup.

Demo-only choices (free LLMs, local files, simulated clock, role switcher) live in settings, so
going to production is a configuration change. `validate_for_environment` is the production guard:
with APP_ENV=production the API refuses to start on any demo-only setting.
"""

from __future__ import annotations

from dataclasses import dataclass
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


@dataclass(frozen=True)
class LLMTier:
    """A model tier that is switched on: where to reach it and which model to ask for."""

    name: str
    provider: Literal["openai_compatible", "anthropic"]
    model: str
    base_url: str
    api_key: str
    free: bool
    vendor: str = ""  # "groq", "openrouter"... when chosen through a named provider


@dataclass(frozen=True)
class LLMSpec:
    """One entry of a tier line (`groq:llama-3.3-70b-versatile`), usable or not."""

    tier: str
    role: Literal["primary", "fallback"]
    vendor: str
    model: str
    known: bool
    has_key: bool
    free: bool


# Named providers: how to reach them. Keys come from GROQ_API_KEY, OPENROUTER_API_KEY, HF_TOKEN,
# ANTHROPIC_API_KEY; Ollama needs none. Models stay in .env (LLM_TIER_*_PRIMARY / _FALLBACK).
PROVIDERS: dict[str, tuple[Literal["openai_compatible", "anthropic"], str]] = {
    "groq": ("openai_compatible", "https://api.groq.com/openai/v1"),
    "openrouter": ("openai_compatible", "https://openrouter.ai/api/v1"),
    "huggingface": ("openai_compatible", "https://router.huggingface.co/v1"),
    "ollama": ("openai_compatible", "http://localhost:11434/v1"),
    "anthropic": ("anthropic", "https://api.anthropic.com"),
}
NO_KEY_NEEDED = {"ollama"}


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
    # Groq / OpenRouter :free / Ollama and is refused in production. A tier with no model is off:
    # every AI feature then falls back (the narrator keeps the template wording).
    # base_url is the OpenAI-compatible root, e.g. https://api.groq.com/openai/v1,
    # https://openrouter.ai/api/v1 or http://localhost:11434/v1 (Ollama needs no key).
    llm_tier_light_provider: Literal["openai_compatible", "anthropic"] = "openai_compatible"
    llm_tier_light_model: str = ""
    llm_tier_light_free: bool = True
    llm_tier_light_base_url: str = ""
    llm_tier_light_api_key: str = ""
    llm_tier_mid_provider: Literal["openai_compatible", "anthropic"] = "openai_compatible"
    llm_tier_mid_model: str = ""
    llm_tier_mid_free: bool = True
    llm_tier_mid_base_url: str = ""
    llm_tier_mid_api_key: str = ""
    llm_timeout_seconds: float = Field(default=30, ge=1, le=300)
    # Named providers (preferred): "provider:model", e.g. groq:llama-3.3-70b-versatile. The
    # fallback answers when the primary is rate-limited, down or refuses the key. When a tier's
    # primary is set the flat llm_tier_*_{model,base_url,api_key,free} lines above are ignored.
    llm_tier_light_primary: str = ""
    llm_tier_light_fallback: str = ""
    llm_tier_mid_primary: str = ""
    llm_tier_mid_fallback: str = ""
    groq_api_key: str = ""
    openrouter_api_key: str = ""
    hf_token: str = ""
    anthropic_api_key: str = ""
    # Providers on a paid plan, comma-separated (e.g. "groq"). Groq and Hugging Face count as
    # free tier unless listed here; OpenRouter is free only for ":free" models.
    llm_paid_providers: str = ""
    # Sent to OpenRouter so it can label the app in its dashboard.
    web_base_url: str = "http://localhost:3000"

    # Business config
    doc_check_default_horizon_days: int = Field(default=90, ge=1, le=365)
    transfer_buffer_days: int = Field(default=7, ge=0, le=60)
    forecast_doc_horizon_days: int = Field(default=90, ge=1, le=365)
    forecast_window_days: int = Field(default=120, ge=1, le=730)
    # People finishing up to this many days AFTER a project starts are offered as "could join late".
    forecast_late_window_days: int = Field(default=21, ge=0, le=90)
    # Documents a worker must hold, valid through the cover window, to count as deployable.
    forecast_required_docs: str = "residency_visa,medical_fitness"
    # Recruitment is asked for this many days before a project starts. Overseas hiring (MOHRE quota,
    # offer, entry permit, medical, residency) takes about twice as long as local. These are
    # assumptions to confirm with HR, not law.
    recruit_lead_days_local: int = Field(default=30, ge=0, le=365)
    recruit_lead_days_overseas: int = Field(default=60, ge=0, le=365)
    approval_wait_hours: int = Field(default=24, ge=1, le=240)
    # An alert nobody has taken moves up a level after these hours: "first,second" (HR Manager, then
    # Operations Manager). Info alerts never escalate. Checked whenever the detectors run.
    alert_escalation_critical_hours: str = "4,8"
    alert_escalation_action_hours: str = "24,48"

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

    def _vendor_key(self, vendor: str) -> str:
        keys = {
            "groq": self.groq_api_key,
            "openrouter": self.openrouter_api_key,
            "huggingface": self.hf_token,
            "anthropic": self.anthropic_api_key,
        }
        return keys.get(vendor, "").strip()

    def _vendor_is_free(self, vendor: str, model: str) -> bool:
        if vendor == "anthropic":
            return False
        if vendor == "openrouter":
            return model.endswith(":free")
        paid = {p.strip().lower() for p in self.llm_paid_providers.split(",") if p.strip()}
        return vendor not in paid  # Groq, Hugging Face and Ollama are free unless declared paid

    def llm_specs(self, name: Literal["light", "mid"]) -> list[LLMSpec]:
        """The tier's `provider:model` lines (primary, then fallback), usable or not."""
        lines: tuple[tuple[Literal["primary", "fallback"], str], ...] = (
            (
                "primary",
                self.llm_tier_light_primary if name == "light" else self.llm_tier_mid_primary,
            ),
            (
                "fallback",
                self.llm_tier_light_fallback if name == "light" else self.llm_tier_mid_fallback,
            ),
        )
        specs: list[LLMSpec] = []
        for role, text in lines:
            if not text.strip():
                continue
            vendor, _, model = text.partition(":")
            vendor, model = vendor.strip().lower(), model.strip()
            known = vendor in PROVIDERS and bool(model)
            has_key = known and (vendor in NO_KEY_NEEDED or bool(self._vendor_key(vendor)))
            free = self._vendor_is_free(vendor, model) if known else False
            specs.append(LLMSpec(name, role, vendor, model, known, has_key, free))
        return specs

    def llm_tiers(self, name: Literal["light", "mid"]) -> list[LLMTier]:
        """Every model that can answer for a tier, in the order to try them. Empty = AI is off."""
        specs = self.llm_specs(name)
        if not specs:
            flat = self._flat_tier(name)
            return [flat] if flat else []
        tiers: list[LLMTier] = []
        for s in specs:
            if not (s.known and s.has_key):
                continue
            provider, base_url = PROVIDERS[s.vendor]
            tiers.append(
                LLMTier(
                    name, provider, s.model, base_url, self._vendor_key(s.vendor), s.free, s.vendor
                )
            )
        return tiers

    def llm_tier(self, name: Literal["light", "mid"]) -> LLMTier | None:
        """The tier's first model if one can be reached, else None (AI is off for it)."""
        tiers = self.llm_tiers(name)
        return tiers[0] if tiers else None

    def _flat_tier(self, name: Literal["light", "mid"]) -> LLMTier | None:
        """The older single-provider lines (LLM_TIER_*_MODEL / _BASE_URL / _API_KEY)."""
        provider = self.llm_tier_light_provider if name == "light" else self.llm_tier_mid_provider
        model = (self.llm_tier_light_model if name == "light" else self.llm_tier_mid_model).strip()
        base_url = (
            self.llm_tier_light_base_url if name == "light" else self.llm_tier_mid_base_url
        ).strip()
        key = (
            self.llm_tier_light_api_key if name == "light" else self.llm_tier_mid_api_key
        ).strip()
        free = self.llm_tier_light_free if name == "light" else self.llm_tier_mid_free
        if not model:
            return None
        if provider == "anthropic":
            if not key:
                return None
            base_url = base_url or "https://api.anthropic.com"
        elif not base_url:
            return None  # an OpenAI-compatible provider has no default address to guess
        return LLMTier(name, provider, model, base_url.rstrip("/"), key, free)

    @property
    def required_document_types(self) -> list[str]:
        return [d.strip() for d in self.forecast_required_docs.split(",") if d.strip()]

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
    tiers: tuple[Literal["light", "mid"], ...] = ("light", "mid")
    for tier in tiers:
        for spec in s.llm_specs(tier):
            where = f"LLM tier '{tier}' {spec.role} ({spec.vendor}:{spec.model})"
            if not spec.known:
                problems.append(f"{where} is not a known provider:model")
            elif spec.free:
                problems.append(
                    f"{where} is a free-tier model (set LLM_PAID_PROVIDERS or change it)"
                )
            if spec.known and not spec.has_key:
                problems.append(f"{where} has no API key")
    if not s.llm_specs("light") and s.llm_tier_light_free:
        problems.append("LLM tier 'light' points at a free-tier provider (LLM_TIER_LIGHT_FREE)")
    if not s.llm_specs("mid") and s.llm_tier_mid_free:
        problems.append("LLM tier 'mid' points at a free-tier provider (LLM_TIER_MID_FREE)")
    flat: tuple[tuple[Literal["light", "mid"], str, str], ...] = (
        ("light", s.llm_tier_light_model, s.llm_tier_light_api_key),
        ("mid", s.llm_tier_mid_model, s.llm_tier_mid_api_key),
    )
    for tier, model, key in flat:
        if not s.llm_specs(tier) and model.strip() and not key.strip():
            problems.append(f"LLM tier '{tier}' has a model but no API key (LLM_TIER_*_API_KEY)")
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
