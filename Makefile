# CONSTRUCTIQ developer commands. Works with GNU Make on Windows (cmd.exe) and Linux.
COMPOSE = docker compose --env-file .env -f infra/docker-compose.yml
API = uv --directory apps/api

.PHONY: help env dev db db-down db-logs db-shell migrate api-dev web-dev test test-api test-web lint lint-api lint-web fmt seed reset-demo ai-smoke eval

help:
	@echo make env        - create .env with random secrets (first time only)
	@echo make dev        - start Postgres + n8n, then the API (8000) and web app (3000)
	@echo make db         - start Postgres 16 and n8n only
	@echo make migrate    - apply database migrations (as the database owner)
	@echo make db-down    - stop them (data is kept)
	@echo make test       - API and web tests
	@echo make lint       - ruff + pyright + eslint + tsc
	@echo make fmt        - format code
	@echo make seed / reset-demo / eval - arrive with the schema (Day 3) and agents

env:
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/init-env.ps1

db:
	$(COMPOSE) up -d --wait postgres n8n

db-down:
	$(COMPOSE) down

db-logs:
	$(COMPOSE) logs -f --tail=100

db-shell:
	$(COMPOSE) exec postgres psql -U postgres -d constructiq

migrate:
	$(API) run alembic upgrade head

api-dev:
	$(API) run uvicorn app.main:app --reload --port 8000

web-dev:
	npm --prefix apps/web run dev

dev: db
	$(MAKE) -j2 api-dev web-dev

test-api:
	$(API) run pytest

test-web:
	npm --prefix apps/web run test

test: test-api test-web

lint-api:
	$(API) run ruff check .
	$(API) run ruff format --check .
	$(API) run pyright

lint-web:
	npm --prefix apps/web run lint
	npm --prefix apps/web run typecheck

lint: lint-api lint-web

fmt:
	$(API) run ruff format .
	$(API) run ruff check . --fix
	npm --prefix apps/web run format

seed: migrate
	$(API) run python -m app.seed seed

reset-demo: seed

ai-smoke:
	$(API) run python -m app.ai.smoke

eval:
	@echo eval arrives with the agents
