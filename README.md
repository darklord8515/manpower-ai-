# HAMRA AI

Workforce operations platform for Alhamra Construction & Development (Ras Al Khaimah, UAE).
Read `CLAUDE.md` first, then `docs/mvp-plan.md` and `docs/design-direction.md`.

## First-time setup
Requires Git, Node 24+, Python 3.12 (installed by uv), uv, Docker Desktop and GNU Make.

```
make env        # creates .env with random secrets (never overwrites an existing one)
make db         # Postgres 16 + n8n in Docker
uv --directory apps/api sync
npm --prefix apps/web install
npx --prefix apps/web playwright install chromium
```

## Everyday
```
make dev        # database, API on :8000, web on :3000
make test       # API and web tests
make lint       # ruff, pyright, eslint, tsc
```

`make seed`, `make reset-demo` and `make eval` arrive with the schema and the agents.

## Layout
```
apps/api/    FastAPI service (rules, permissions, agent tools)
apps/web/    Next.js app
assets/      brand logos (originals) and hero source pictures
infra/       docker-compose (Postgres 16, n8n)
db/          schema.sql, the Alembic baseline
scripts/     build and setup scripts (brand, hero images, env, contrast check)
docs/        plan, design rules, agents, rules
prototype/   static HTML design prototype (reference only)
legacy-web/  the old frontend (read-only reference)
```
