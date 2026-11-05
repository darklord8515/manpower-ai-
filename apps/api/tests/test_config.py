"""The production guard: demo-only settings must stop a production start."""

from __future__ import annotations

import pytest
from pydantic_settings import SettingsConfigDict

from app.config import AppEnv, ConfigError, Settings, production_problems, validate_for_environment
from app.main import create_app

GOOD_SECRET = "x" * 40


class IsolatedSettings(Settings):
    """Settings that ignore the developer's .env, so tests see only what they pass in."""

    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)


def prod_settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "app_env": AppEnv.PRODUCTION,
        "demo_mode": False,
        "simulated_clock": False,
        "storage_backend": "s3",
        "llm_tier_light_free": False,
        "llm_tier_mid_free": False,
        "secret_key": GOOD_SECRET,
        "n8n_hmac_secret": GOOD_SECRET,
        "database_url": "postgresql+psycopg://constructiq_app:a-real-password@db:5432/constructiq",
    }
    base.update(overrides)
    return IsolatedSettings.model_validate(base)


def test_clean_production_config_is_accepted() -> None:
    settings = prod_settings()
    assert production_problems(settings) == []
    validate_for_environment(settings)


@pytest.mark.parametrize(
    ("override", "expected"),
    [
        ({"demo_mode": True}, "DEMO_MODE"),
        ({"simulated_clock": True}, "SIMULATED_CLOCK"),
        ({"storage_backend": "local"}, "STORAGE_BACKEND"),
        ({"llm_tier_light_free": True}, "'light'"),
        ({"llm_tier_mid_free": True}, "'mid'"),
        ({"secret_key": ""}, "SECRET_KEY"),
        ({"n8n_hmac_secret": "short"}, "N8N_HMAC_SECRET"),
        ({"database_url": "postgresql+psycopg://u:change-me@h/db"}, "placeholder"),
    ],
)
def test_each_demo_setting_blocks_production(override: dict[str, object], expected: str) -> None:
    settings = prod_settings(**override)
    with pytest.raises(ConfigError, match=expected):
        validate_for_environment(settings)


def test_all_problems_are_reported_together() -> None:
    settings = prod_settings(demo_mode=True, storage_backend="local", secret_key="")
    problems = production_problems(settings)
    assert len(problems) >= 3


def test_create_app_refuses_unsafe_production() -> None:
    with pytest.raises(ConfigError):
        create_app(prod_settings(demo_mode=True))


@pytest.mark.parametrize("env", [AppEnv.LOCAL, AppEnv.TEST, AppEnv.DEMO])
def test_non_production_environments_are_not_blocked(env: AppEnv) -> None:
    validate_for_environment(IsolatedSettings(app_env=env, demo_mode=True))


def test_production_hides_api_docs() -> None:
    app = create_app(prod_settings())
    assert app.docs_url is None
    assert app.openapi_url is None
