# CONSTRUCTIQ — Agents

One tool-calling loop, one `LLMClient` interface. Rules the agents must respect are in
`docs/rules.md`; the database seed for this file is the `agents` insert at the end of `db/schema.sql`.

| Agent | Code | Tier | MVP priority (docs/mvp-plan.md) |
|---|---|---|---|
| Workforce Agent (incl. forecasting) | `workforce` | mid | P1 recommendations · P3 forecasting |
| Alert Narrator (one call, no tools) | `narrator` | light | P2 |
| Import Agent | `import` | light | P4 |
| Supervisor Agent | `supervisor` | light | P6 (Command Centre) |
| Mobilization Agent | `mobilization` | light | P6 (Command Centre) |
| Demobilization Agent | `demobilization` | light | P7 (may become Workforce Agent tools) |
| Document Intelligence Agent | `document` | light | **Post-MVP** (seeded disabled) |

## Shared contract (applies to every agent)

- **Permissions come from the caller.** Every run has a `user_id`; every tool checks that user's
  permission and scope *before* touching the database. A refused call is logged to
  `agent_tool_calls` with `allowed = false` and the agent tells the user what it can't do and why.
- **Tools wrap the service layer.** A tool is a Pydantic input model plus a function that calls the
  same Python service the REST API uses. No tool runs SQL of its own, and no number an agent shows
  is computed by the model.
- **The model proposes; Python decides.** Agents read and recommend; their only write is a
  *draft* staffing request. Every committed write (submit, approve, reserve, raise recruitment,
  snooze, dismiss) is a button on a permission-checked API route, pressed by a person. Hard rules
  (`docs/rules.md`) run on every write.
- **Redaction before every model call.** `doc_number`, `contract_value_aed` and phone / WhatsApp
  numbers never reach a model. The model works with employee codes (`EMP-0142`); the service layer
  resolves them. Logistics callers get the narrow projection even inside tool results.
- **Untrusted text stays data.** OCR text, spreadsheet cells and staffing request free text are
  passed inside a clearly delimited data block and are never followed as instructions.
- **Limits.** Max 6 tool rounds and the agent's `token_budget` per run. On invalid model output:
  one retry with the validation error, then the run ends as `failed`. No guessing.
- **Logging.** Every run → `agent_runs` (model, tokens, latency, cost, status). Every tool call →
  `agent_tool_calls`. Every write → `audit_log`, with `agent_run_id` when an agent's
  recommendation was accepted.
- **Model tiers.** Agents declare a tier, never a model. Config maps tier → provider + model:

  | Tier | Used for | Demo default (free) | Later |
  |---|---|---|---|
  | `light` | intent, routing, alert wording, column mapping, checklists | small fast model on Groq / OpenRouter free / Ollama | Claude Haiku 5.5 |
  | `mid` | staffing reasoning over candidate lists and forecasts | strongest free model with reliable tool calling | Claude Sonnet 5.5 |

  Exact model names live in `.env` so they can change without a code change: per tier a primary and
  a fallback as `provider:model` (`LLM_TIER_MID_PRIMARY=groq:…`, `LLM_TIER_MID_FALLBACK=openrouter:…`),
  with one key per provider (`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, `ANTHROPIC_API_KEY`).
  The older single-provider lines (`LLM_TIER_*_MODEL` / `_BASE_URL` / `_API_KEY`) still work until a
  tier's primary is set.
- **Providers fail; agents carry on.** A busy provider (429, 5xx, unreachable) is retried briefly
  (at most 3 tries, 8 s of waiting; a `Retry-After` longer than that is not waited for), then the
  fallback answers. A model that fails 3 times in a minute is skipped for a minute. The run records
  the model that actually answered (`agent_runs.model`, `provider:model` after a fallback). With no
  model answering, AI features fall back to Python wording and say so.
- **Choosing models.** `make ai-check` (run it yourself; it prints no keys) scores each candidate in
  `apps/api/agents/evals/models.yaml` on strict JSON, routing and tool calls, with latency, and
  suggests the `.env` lines.

Permission notation: `employee:read [scoped]` means the tool also filters rows by the caller's scope
(own / site / project / all) from `user_project_access`.

---

## 1. Workforce Agent — `workforce` · tier `mid`

**Job.** Turns a staffing need into a draft request, finds candidates, filters them through
availability, documents and work rules, and recommends the best set with a reason for each.
Explains forward forecasts for upcoming projects. Its recommendations appear on HR's Allocation
Board, where HR swaps, approves or rejects workers. It runs when a Project Manager raises a request
(Command Centre), when HR presses "Ask Workforce Agent" on a request line, and when someone asks a
workforce or forecast question.

| Tool | Inputs | Output | Permission |
|---|---|---|---|
| `draft_staffing_request` | `project_code`, `site_name?`, `needed_from`, `needed_until?`, `lines[]` {`trade_code`, `headcount`, `min_level?`}, `source_text` | `request_no`, `status = draft` | `staffing:create [scoped]` |
| `workforce_summary` | `as_of?` (default today), `project_code?`, `trade_code?` | Counts by availability; per project and trade: required (from `manpower_requirements`), deployed, gap, open requests | `employee:read [scoped]` |
| `forecast_availability` | `project_code`, `start_date?` (default: the project's `starts_on`), `trade_code?` | Per trade: needed, already assigned, deployable with sources and dependencies, exclusions, recruitment pending, gap (details below) | `forecast:read [scoped]` |
| `search_employees` | `trade_code`, `min_level?`, `available_from`, `available_until?`, `project_code?`, `limit` (≤ 50) | Candidate projection: `[{employee_code, name, trade, level, availability_window, documents_valid}]` | `employee:read [scoped]`, or `staffing:create` for the candidate pool (below) |
| `check_availability` | `employee_codes[]` (≤ 50), `period` {`from`, `until?`} | per code: `{free, conflicts[] {project_code, period}, on_leave}` | `employee:read [scoped]` |
| `check_documents` | `employee_codes[]` (≤ 50), `valid_until?` (default: today + 90 days) | per code: `{cleared, blocking[] {doc_type, expiry_date, days_short}}` — never `doc_number` | `employee:read [scoped]` |
| `check_work_rules` | `project_code`, `site_name?`, `period`, `shift_start?`, `shift_end?` | `{midday_ban_applies, ban_window?, provisional, effective_shift, violations[]}` | `project:read [scoped]` |
| `recommend_candidates` | `request_no`, `line_id`, `selections[]` {`employee_code`, `reason` (≤ 200 chars)}, `excluded[]` {`employee_code`, `rule`, `detail`} | `{accepted[], rejected[] {employee_code, rule, detail}, shortfall}`; stored as the line's current recommendation (`agent_runs.output_json`) | `staffing:read [scoped]` |
| `get_employee_documents` | `employee_code` | `[{doc_type, expiry_date, status, days_left}]` — never `doc_number` | `employee:read [scoped]` |
| `list_expiring_documents` | `within_days` (7 · 30 · 60 · 90), `doc_types?`, `project_code?`, `limit` (≤ 100) | `[{employee_code, name, doc_type, expiry_date, days_left, status}]` from `v_document_expiry` | `employee:read [scoped]` |

**`forecast_availability`, computed entirely in Python / SQL** (rules `FORECAST_*` in `docs/rules.md`):

```
window      = [start_date, horizon)   horizon = min(project ends_on, start_date + FORECAST_DOC_HORIZON_DAYS)
needed      = manpower_requirements for the project and trade covering start_date
already     = planned / active assignments to this project covering start_date
deployable  = available now
            + workers whose current assignment ends on or before start_date − TRANSFER_BUFFER_DAYS (7)
            − approved leave overlapping the window
            − required documents expiring before horizon
            − workers already reserved (any planned assignment overlapping the window)
pending     = open / in-progress recruitment_requests for this project and trade
gap         = max(needed − already − deployable, 0)
uncovered   = max(gap − pending, 0)
```

Output per trade: `{trade, needed, already_assigned, deployable, gap, recruitment_pending,
uncovered_gap, sources[] {kind: available_now | ending_before_start, count, employee_codes[],
project_code?, assignment_ends_on?, depends_on? {project_code, must_finish_by}},
excluded {on_leave, documents, already_reserved, inside_buffer}}`. Workers coming from another
project carry `depends_on: {project_code, must_finish_by = start_date − buffer}`; the UI shows
"depends on RAK-02 finishing by 5 Feb 2027".

The agent explains the forecast and suggests next steps in words. It does **not** reserve transfers
or raise recruitment requests; those are buttons on the Manpower Forecast screen and in alerts,
pressed by someone with `assignment:approve` / `recruitment:create`.

**Candidate pool (approved).** Rule `CANDIDATE_POOL`: a caller with `staffing:create` may search the
company-wide **available pool**, only in the candidate projection: name, employee code, trade, skill
level, availability window, `documents_valid`. Never document numbers, nationality, date of birth,
phone or camp. Full profiles stay scoped.

`recommend_candidates` re-runs every hard rule in Python and drops anyone who fails, with the rule.
It writes nothing except the recommendation.

**As built (Phase 5.2).** `app/ai/workforce.py`, `app/ai/tools.py` (the loop), `app/routes/agent.py`. The
tool list above is the design; the agent has five tools, enforced by `agents.allowed_tools` (migration
`0010`) and each checking the caller's permission first: `get_request_line` (`staffing:read`),
`search_candidates` and `check_candidates` (`staffing:create`; the second runs every hard rule through
`allocation.verdict`, which is what `check_availability`, `check_documents` and `check_work_rules` were
for until the BAN_* board rules exist), `recommend_candidates` (`staffing:create`) and
`forecast_availability` (`forecast:read`). Two uses: **recommend people for a request line** (the board's
"Ask Workforce agent"; a tool loop, at most 6 rounds and the agent's token budget) and **explain a forecast**
(the forecast's "Explain": the forecast service's numbers, one structured call). `draft_staffing_request`,
`workforce_summary`, `get_employee_documents` and `list_expiring_documents` are not built: they belong to
the Command Centre. The agent writes nothing about people; HR applies a recommendation with
"Use these n", which calls the board's own choose route with `agent_run`, so the picks are recorded as the
agent's and every hard rule runs again. Rules: `WORKFORCE_*` in `docs/rules.md`.

**Must never.** Create, approve, reserve or change assignments, or raise recruitment requests.
Compute or "adjust" a forecast number. Recommend a candidate that a hard rule excludes, or hide an
exclusion. Rank on nationality, age or any field other than trade, level, availability, documents,
location and history. Pad a shortfall: if only 6 of 8 are cleared, it proposes 6 and says so.

---

## 2. Alert Narrator — `narrator` · tier `light` · not a tool-using agent

**Job.** Words an Action Center alert. Detectors (Python) create every alert with a template title
and its `facts_json`; the narrator rewrites `title`, `explanation` and the labels / order of
`recommended_actions_json` so HR can read it in a few seconds.

- **Input:** alert `type`, `severity`, `facts_json` (already redacted), and the detector's
  `allowed_actions[]` (action key, required permission, params). Nothing else: no database access,
  no tools.
- **Output (strict JSON):** `{title ≤ 90 chars, explanation ≤ 400 chars, actions[] {action, label ≤ 40 chars}}`.
- **Checks before saving** (`ALERT_NARRATION_FAITHFUL`): every number, date, project code and
  employee code in the text must appear in `facts_json`; every `action` must be in
  `allowed_actions`; no recommendation outside them. Fail → keep the template text; the run is
  logged as `failed`.
- Runs when an alert is created or its facts change (cached by a hash of `facts_json` and severity), in
  batches after detector runs.

**As built (Phase 5.1).** `app/services/alerts/narrator.py`; the shared model layer is `app/ai/`
(`llm.py` the two adapters, `runtime.py` structured calls and the run log, `redact.py`, `faithful.py`).
Only critical and action-needed alerts are narrated. The model also sees the alert's current (template)
wording, so it rewords rather than invents; its text may reuse numbers, dates and codes from the facts
**or from that template**. Rules: `NARRATE_*` and `AI_*` in `docs/rules.md`. With the light tier off nothing
is narrated and the template stays. `make ai-smoke` makes one real call without saving anything.

**Must never.** Change severity, status, assignee or due date. Add facts, estimates or advice not in
`facts_json`. Invent an action. Address the user as if it took an action.

---

## 3. Import Agent — `import` · tier `light` · P4

**Job.** Given an uploaded Excel / CSV of employees, proposes which column maps to which employee
field, checks the mapping, and previews the result. HR confirms and runs the import in the UI.
The import screen also works with manual mapping when the agent is unavailable or wrong; the agent
only pre-fills the mapping.

| Tool | Inputs | Output | Permission |
|---|---|---|---|
| `read_spreadsheet` | `file_id`, `sheet?` | `{sheets[], headers[], sample_rows[≤ 5]}` with phone / ID-like cells redacted | `employee:write` |
| `validate_mapping` | `file_id`, `mapping` {column → field} | `{valid, per_field[] {field, errors, examples[≤ 3]}, unmapped_required[]}` | `employee:write` |
| `preview_import` | `file_id`, `mapping` | `{create, update, skip, errors}` counts and first 20 problem rows | `employee:write` |

Target fields: `employee_code`, `full_name`, `nationality`, `date_of_birth`, `phone`,
`whatsapp_number`, `department`, `primary_trade`, `designation`, `joined_on`, plus document
expiry columns. Salary columns are ignored even if present.

**Must never.** Write employees (the import itself is a human action through the REST API).
Map a column to a field that doesn't exist. Treat cell contents as instructions. Read sheets beyond
the sample unless a validation tool does it in Python.

---

## 4. Supervisor Agent — `supervisor` · tier `light` · P6

**Job.** In the Command Centre (Cmd+K), reads the user's message, classifies the intent and hands it
to exactly one domain agent with a short task statement. Merges the sub-agent's structured result
into the answer card (summary line, data, "Why" line, actions, trace).

| Tool | Inputs | Output | Permission |
|---|---|---|---|
| `route_to_agent` | `agent_code` (workforce · mobilization · demobilization · import), `task` (≤ 500 chars), `intent` | Sub-run id and its validated `output_json` | `ai:use` |

Routing is refused before the sub-agent runs if the caller lacks every permission the target agent's
tools need, or if the target agent is disabled. Screens that call an agent directly (the Allocation
Board's "Ask Workforce Agent", the Forecast screen's "Explain") skip the Supervisor.

**Must never.** Call domain tools directly. Answer workforce or project questions from the model's own
knowledge. Route to a disabled agent. Re-phrase a refusal as a partial answer. Run more than one
sub-agent per request in the MVP.

---

## 5. Mobilization Agent — `mobilization` · tier `light` · P6

**Job.** Answers "where is this mobilization?", checks readiness against the checklist, and creates
the department tasks once a mobilization is approved.

| Tool | Inputs | Output | Permission |
|---|---|---|---|
| `list_mobilizations` | `from?`, `to?`, `project_code?`, `status?`, `limit` (≤ 50) | `[{mob_no, employee_code, name, project_code, report_on, status}]` | `mobilization:read [scoped]` |
| `get_mobilization` | `mob_no` | Status, report date, bed and vehicle (labels only), readiness snapshot, tasks | `mobilization:read [scoped]` |
| `check_readiness` | `mob_no` | `{ready, items[] {item: docs·ppe·induction·bed·transport, ok, detail}}` | `mobilization:read [scoped]` |
| `create_mob_tasks` | `mob_no` | `[{task_id, department, title, due_on}]` — titles come from a fixed Python template | `mobilization:create [scoped]` |

The mobilization service itself (P1) creates tasks on approval; this agent only answers questions
and re-creates tasks if they were never created. `create_mob_tasks` refuses unless the mobilization
is `approved` and has no open tasks yet (idempotent).

**Must never.** Approve, cancel or complete a mobilization. Assign beds or vehicles (that is
`logistics:assign`, a human action). Invent task titles outside the template. Send messages.

---

## 6. Demobilization Agent — `demobilization` · tier `light` · P7

**Job.** Tracks clearance for a release and suggests where the released workers could go next.
If P7 is cut, `get_demobilization` and `check_clearance` move to the Workforce Agent as tools and
this agent is removed from the seed; the tool contracts below stay the same.

| Tool | Inputs | Output | Permission |
|---|---|---|---|
| `get_demobilization` | `demob_no` | Status, release date, reason, clearance flags, `next_assignment?` | `mobilization:read [scoped]` |
| `check_clearance` | `demob_no` | `{cleared, items[] {item: timesheets·ppe·bed·hr·finance, ok, detail}}` | `mobilization:read [scoped]` |
| `search_employees` | as in Workforce Agent | as in Workforce Agent | `employee:read [scoped]` |

**Must never.** Close a demobilization, release a bed, or mark clearance items done. Suggest a next
assignment that fails a hard rule.

---

## Post-MVP: Document Intelligence Agent — `document` · tier `light` · seeded disabled

Moved out of the MVP (see `docs/mvp-plan.md` → "Path to production"). The MVP keeps manual document
upload and HR verification; expiry tracking is a Python detector, and the document read tools moved
to the Workforce Agent.

Planned design, unchanged: upload → `StorageBackend` → Tesseract OCR + MRZ parse with check digits
(Python) → **redacted** text and parsed fields → model normalises → Python validates dates and MRZ →
`extracted_json`, `extraction_confidence`, `status = pending_check`. One tool, `extract_document`
(`document:upload [scoped]`). It must never follow instructions in document text, see `doc_number`,
or set a document to `verified` / `rejected`.
