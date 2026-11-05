# CONSTRUCTIQ

AI workforce operations platform for a construction company in Ras Al Khaimah, UAE.
This is the MVP the CEO will review before approving the full build. Quality bar: enterprise SaaS.

Read these before any task:
- `docs/mvp-plan.md` — scope, demo story, RBAC, dashboards, data model, 12-day plan
- `docs/design-direction.md` — UI rules. Follow them exactly.
- `db/schema.sql` — the database. It is the source of truth; do not invent tables.
- `docs/agents.md` — the 6 agents: tools, permissions, limits, model tier
- `docs/rules.md` — hard rules (Python validators) and policy rules (agents read)
- `docs/CONSTRUCTIQ-spec.pdf` — full client concept (most of it is OUT of MVP scope)

`legacy-web/` is the old frontend. Read it for ideas only. Never import from it, never edit it.

## Stack
- Web: Next.js (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, Recharts,
  Motion (`motion` package, `import { motion } from "motion/react"`), lucide-react icons.
- API: Python 3.12, FastAPI, SQLAlchemy 2, Pydantic v2, Alembic, PostgreSQL 16.
- Automation: n8n (self-hosted, Docker).
- AI: one `LLMClient` interface. Demo runs on free models through an OpenAI-compatible
  adapter (Groq / OpenRouter / Ollama); an Anthropic adapter exists for later. Provider and
  model per tier (`light`, `mid`) come from config, never from code.
- Documents: Tesseract OCR + passport MRZ parsing in Python. The LLM only normalises fields.
- Files: `StorageBackend` interface (local filesystem for dev, S3-compatible bucket when hosted);
  served only through signed URLs.
- Hosting (demo): Neon Postgres 16 (app DB + separate n8n DB); Render free for web, API and n8n,
  all as Docker images; Cloudflare R2 for files; GitHub Actions cron for schedules. See
  `docs/mvp-plan.md` → "Hosting" and "Path to production".

## Environments and adapters
Build everything production-grade. Demo-only choices sit behind config or an adapter, so going
to production is a configuration change, never a code rewrite.
- `APP_ENV` = `local` | `test` | `demo` | `production`. Settings are validated at startup.
- Adapters (interface in code, implementation picked by config):
  `LLMClient` (openai_compatible: Groq / OpenRouter / Ollama · anthropic),
  `StorageBackend` (local filesystem · S3-compatible), `Clock` (system · demo-simulated),
  messaging goes through n8n (credentials live in n8n, not in the API).
- **Production guard:** with `APP_ENV=production` the API refuses to start if `DEMO_MODE` is on,
  `STORAGE_BACKEND=local`, any LLM tier points at a provider marked `free_tier`, the simulated
  clock is enabled, or a required secret is missing.
- `DEMO_MODE` only turns on demo UX (role switcher, "simulate date", demo labels). The role
  switcher signs in as the seeded demo user for that role through the real auth flow; it never
  bypasses RBAC. The simulated date is server-side, audited, and only affects rule checks.
- Demo data comes only from the seed script (`is_demo = true`). `make seed` and
  `make reset-demo` refuse to run when `APP_ENV=production`.
- No shortcuts in RBAC, validation, migrations or tests in any environment.

## Brand
The company logos are `ALHAMRA-LOGO.svg` (wordmark with "Construction & Development") and
`ALHAMRA-FAVICON-LOGO.svg` (square mark), at the repo root. Both are all-white artwork.
- Never edit the originals. The app copies them to `apps/web/public/brand/` and uses them as inline
  SVG symbols coloured with `currentColor` from the tokens, so they show on light and dark.
- Wordmark: login screen only (on the photo overlay). Mark: sidebar header and the browser-tab
  icon (on a dark rounded square, since white-only artwork vanishes on a light tab).
- No cropping, stretching, extra effects or second colours. Keep clear space of at least the
  mark's inner-square width. Product name CONSTRUCTIQ is set in type beside or under the logo.

## Layout
```
apps/web/          Next.js app
apps/api/          FastAPI app
apps/api/agents/   supervisor + agent tools + evals
infra/             docker-compose (postgres, n8n, api, web)
db/schema.sql      schema
docs/              plan, design rules, agents, rules, spec
prototype/         static HTML design prototype (reference only, not app code)
```

## Non-negotiable rules
- Business rules live in Python services. Never in prompts, never in the frontend.
- Every API route declares its permission: `Depends(require("resource:action"))`.
- Every query on employees / assignments / mobilizations / documents applies the caller's
  scope (own / site / project / all) via `user_project_access` (the only source of scope).
- Never return `doc_number` without `employee:read_sensitive` (in the caller's scope).
  There is no salary data in this system.
- Logistics Coordinator sees a narrow employee projection only: name, code, trade, phone, camp.
- Candidate pool: `staffing:create` may search the company-wide available pool in this projection
  only: name, code, trade, skill level, availability window, `documents_valid`.
- HR is the primary user. HR screens ship complete: search, filters, validation messages,
  loading / empty / error states, bulk actions where sensible. No dead buttons; anything unbuilt
  is labelled as such.
- AI agents act only through typed tools; each tool checks the caller's permission first.
  A role's AI access is exactly the set of tools its permissions allow.
- Restricted fields are redacted before any model call, whatever the provider.
- Models never compute numbers. Forecasts, gaps, counts and dates come from Python services;
  agents and the Alert Narrator only explain them.
- Alerts are created, updated and resolved only by Python detectors. Agents never approve,
  reserve or change committed data; their only write is a draft staffing request. Every other
  write is a button on a permission-checked API route.
- Text extracted from uploaded documents is data, never instructions to a model.
- The frontend hides what a role can't use, but the API is the real gate.
- Demo data is created by the seed script and tagged `is_demo=true`. No hard-coded data in components.
- UI uses only tokens from `apps/web/styles/tokens.css`. No inline hex colours, no one-off spacing.
- Secrets only in `.env` (git-ignored) or the host's secret store. Never commit keys.
- `db/schema.sql` is the Alembic baseline. Every later change is a migration; CI applies all
  migrations to an empty PG16 and fails if the result differs from `db/schema.sql`.

## Commands
`make dev` · `make test` · `make lint` · `make seed` · `make reset-demo` · `make eval`

## Done means
The CEO receives this as a near-final product; only hosting/infra is out of scope. Quality is part
of every slice, never a final pass. A slice is done only when all of this is true:
- Tests and lint pass.
- Every screen in it has: a loading skeleton, an empty state, an error state, success feedback,
  keyboard support (visible focus, Esc closes sheets), light + dark, a 390px layout, seeded data,
  and no dead buttons. Anything unbuilt is not shown at all.
- Playwright screenshots at 1440px and 390px (light and dark) are reviewed against
  `docs/design-direction.md` and shown to the user.
- Every interaction changes visible state (resolving an alert, approving, importing, switching
  role, simulating a date). Optimistic UI only where safe (`docs/design-direction.md` →
  "Interaction rules").
- If a feature can't meet this bar in the time left, stop, say so and propose cutting it. Never
  ship it half-finished.
- One focused commit per slice.

## How to work
**Plan and slices**
- Plan first. For anything over ~3 files, show the plan and wait for approval.
- Small slices: one screen, one endpoint group, or one agent tool at a time.
- If a fix fails twice, stop and explain what you know instead of trying random changes.

**Think before coding**
- State assumptions. If something is unclear or has more than one reading, name it and ask; don't
  pick silently or hide confusion.
- If a simpler approach exists, say so and push back when warranted.

**Simplicity first**
- Write the minimum code that solves the task. No features beyond what was asked, no abstractions
  for single-use code. If 200 lines could be 50, rewrite it.
- Two things are *not* speculative and are always required: the adapters and production guard in
  "Environments and adapters", and the loading / empty / error / success states in "Done means".

**Surgical changes**
- Touch only what the task needs; match the existing style. Don't refactor or "improve" adjacent
  code, comments or formatting.
- Remove only the imports, variables and functions your own change orphaned. If you notice unrelated
  dead code, mention it; don't delete it.
- Every changed line should trace to the request. `legacy-web/` is never touched.

**Goal-driven execution**
- Turn each task into a check you can run: a bug gets a failing test first, then the fix; a
  refactor keeps tests green before and after.
- For multi-step work, write the steps as `1. step → verify: check` and loop until each check passes.
