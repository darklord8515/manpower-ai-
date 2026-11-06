# CONSTRUCTIQ — Design direction

Goal: very neat, clean, calm enterprise UI. Dense enough for managers to scan 40 workers
at once; premium enough to impress a CEO. Think "operations software", not "marketing site".

## References (study the patterns, never copy their branding)
| Reference | Take from it |
|---|---|
| Linear | Calm density, keyboard-first, Cmd+K command bar, subtle borders instead of shadows |
| Vercel dashboard | Neutral palette, generous but consistent spacing, clean empty states |
| Stripe Dashboard | KPI tiles with a small trend, dense readable tables, detail side panels |
| Attio | Record tables with inline status chips, filters and saved views |
| shadcn/ui Blocks | Starting point for the sidebar layout and dashboard grid (we restyle with our tokens) |

BuildAxis (Webflow architecture template) is a mood reference only: strong type and
restraint. Use its feel on the login screen. Do NOT bring hero images, long scroll sections
or big empty cards into the app.

## Photos
- **Login:** one full-height construction-site photo with a dark overlay (`--photo-overlay`) and the
  Alhamra wordmark (`assets/brand/ALHAMRA-LOGO.svg`, white, see `CLAUDE.md` → Brand) with CONSTRUCTIQ set in
  type beneath it; the sign-in form sits beside it.
- **Projects:** one site photo per project card and in the project DetailSheet header.
- **Nowhere else.** No photos on data screens (dashboards, board, forecast, Action Center).
- Source: Unsplash, hotlinked from `images.unsplash.com`, credited on the image ("Photo: <name> /
  Unsplash", linked to the photo page wherever the image isn't inside a clickable card).
- Always a fallback background and real `alt` text, so the layout holds when photos don't load.
- Production uses the client's own site photos through `StorageBackend`.

## Impact without decoration
Impact comes from data and motion, not ornament: the agent trace that appears step by step, the
forecast Sankey and capacity heatmap, counters that update when HR acts. No maps for now.

## Tokens (`apps/web/styles/tokens.css`)
- Brand: red `#B8202E` (the client's colour), black, white. Neutrals are plain greys (`#F5F5F5` page, white cards).
- Red (`--accent*`) is for **actions and navigation only**: primary button, links, focus ring, the active-nav bar.
  Black is the sidebar (`--sb-*`, black in both themes, white logo on it).
- Status: success green, warning amber, danger red, info blue. Because red now means "brand", status never
  uses a solid red fill: it is a soft tint plus an icon plus a word ("Urgent"). `scripts/check-contrast.mjs`
  checks every text/background token pair against WCAG AA in light and dark.
- Type: IBM Plex Sans (UI), IBM Plex Mono (IDs, codes). `font-variant-numeric: tabular-nums` on all numbers.
- Type scale: 12 / 13 / 14 (body) / 16 / 20 / 24 / 30. Weights 400, 500, 600 only.
- Spacing: 4px grid. Radius: 6px controls, 10px cards. Borders 1px. Shadows only on popovers and dialogs.
- Light and dark mode from day one, both from the same tokens.

## Layout
- Black left sidebar (collapsible to icons), HRM-style groups (Home / To-do, People, Work): nav items come
  from the user's role permissions. Only built screens are listed; nothing unbuilt is shown. The active
  item has a red bar that slides between items. HRM patterns come from BambooHR, Rippling, Personio,
  Zoho People and Frappe HR (patterns only, never their branding).
- Sidebar header: the Alhamra mark (`assets/brand/ALHAMRA-FAVICON-LOGO.svg`) with CONSTRUCTIQ beside it; only
  the mark when collapsed.
- Top bar: page title + breadcrumb, global search, Cmd+K AI command bar, notifications, user menu.
  In demo mode, a role switcher pill ("Viewing as: Project Manager").
- Page body: KPI row (4–6 tiles) → one primary table or board → optional secondary row.
- Detail opens in a right-side sheet, not a new page, so context is never lost.
- Max content width 1440px. Works at 390px (mobile): sidebar becomes a drawer, tables become cards.

## Core components (build once, reuse everywhere)
KpiTile · DataTable (sort, filter, column visibility, row select, sticky header) · StatusChip ·
AlertCard · ApprovalCard · DocumentExpiryBadge · PersonCell (avatar + name + trade) · EmptyState ·
SkeletonLoader · DetailSheet · KanbanBoard (mobilization pipeline) · AiAnswerCard · InsightLine.

**Built with their motion on Day 2, before any screen**, and shown in a dev-only gallery route that
renders every state (loading, empty, error, success, light, dark, 390px). Screens reuse them; no
screen builds its own version.

| Component | Motion (all ≤ 200ms, ease-out, off under `prefers-reduced-motion`) |
|---|---|
| KpiTile | Number counts up on first load; counts from the old value to the new one when data changes (600ms, the one exception: a count-up can't be read at 200ms). Trend and detail fade in with the number. |
| DetailSheet | Slides in from the right (scrim fades). Esc, the close button and the scrim close it. Focus moves in, and returns to the opener on close. |
| StatusChip | Tint and label cross-fade when the state changes (e.g. Open → Resolved). Icon + label + colour always. |
| AlertCard | On resolve / dismiss / snooze the row collapses (height + fade) and the severity counters in the Action Center, bell and CEO tile count to their new values. |
| AiAnswerCard | Summary first, then the data, the "Why" line, actions and a collapsed Trace. While the agent works, its steps appear one by one (see "Signature moment"). |
| SkeletonLoader | Shimmer while loading. Matches the layout it replaces, so nothing jumps. |
| EmptyState | No motion. Says why it is empty and offers the next step. |

## Dashboard anatomy (every role dashboard)
1. **One insight line** at the top, a single sentence about what needs attention, e.g. "3 projects
   short of welders by 12 Feb". It links to the screen that fixes it. The text and every number come
   from a Python service (`INSIGHT_PYTHON_ONLY` in `docs/rules.md`), never from a model.
2. **KPI row** (4–6 KpiTiles).
3. **One real chart**: a forecast area chart or plan-vs-actual bars (Recharts), with direct value
   labels, a text alternative, a loading skeleton and an empty state.
4. Then the role's primary table or board, and secondary panels.
No stock photos or decorative images on dashboards. Photos exist only on the login screen and on
project cards / headers (see "Photos").

## Interaction rules
- **Every action changes visible state**: resolving an alert, approving workers, importing a file,
  switching role, simulating a date. The user never presses something and sees nothing change.
- **Optimistic UI only where safe**: reversible actions with no server-side validator that can
  refuse them (select / remove a worker on the board, assign, snooze, mark read). The UI updates at
  once and rolls back with a message if the server refuses.
- **Never optimistic**: approve, reserve transfers, raise recruitment, dismiss, import commit.
  Their validators can refuse, so the control shows a pending state, then the server result.
- **Live updates, no page reload**: in the same session a mutation updates every affected view
  (board, mobilization pipeline, CEO counters, alert counts, audit log) by invalidating their
  queries. Other sessions (the CEO watching while HR approves) get the same through a server-sent
  event stream, with 15-second polling on visible tabs as the fallback.
- **Role switching** (demo) signs in as the seeded user for that role, then re-renders the whole
  shell: sidebar, bell, landing page.
- **Simulate date** (demo) changes the date the rule checks use, shows a banner with the simulated
  date and a "Back to today" control, and the midday-ban and forecast views update immediately.

## Signature moment: the Allocation Board
Requesting recommendations plays a visible sequence, driven by the agent's real tool calls (not a
canned animation), shown in order as each completes:
"Understood the request" → "Checking visas…" → "Checking availability…" → "Midday-ban check…" →
"8 cleared, 2 excluded". If the tools return faster than the eye can read, steps are staggered by
at most 250ms and the Trace shows the real durations.
Then the candidate rows animate in one after another (≤ 40ms apart), and the excluded workers
appear in the amber callout with a plain-English reason each. The sequence stays as a collapsed
Trace afterwards.
Approving a line then updates, with no reload: the board (rows animate out, the line locks with who
approved and the mobilization numbers), the mobilization pipeline (new cards appear in
"Pending checklist"), the CEO dashboard (counters count to new values) and the audit log (new
entries stream in).

## AI Command Centre
- Opens with Cmd+K or the top-bar button as a right-side drawer, available on every dashboard.
- Answers render as cards: summary line, the data (table / list of workers), a "Why" line,
  and action buttons (Approve / Edit / Discard). Never a wall of chat text.
- Show which agent answered and the tools it used in a small collapsible "Trace" row.

## Motion (Motion library, `motion/react`)
Use for: sheet and drawer slides, dialog fade/scale, list reorder in the kanban, chip state changes,
agent-trace steps appearing one by one, rows animating in after a recommendation and out after an
approval. Durations 120–200ms, ease-out.
- KPI numbers count up on first load and count from the old to the new value when they change
  (e.g. CEO counters after an HR approval): 600ms, ease-out, with a timed fallback that sets the
  final value so a paused tab never shows a half-counted number.
- Loading skeletons shimmer (the only looping animation allowed, and only while loading).
- `prefers-reduced-motion`: all of it off; values and steps appear immediately.

**Rules for every animation.** Only `transform` and `opacity` move. Each one explains something (where a
thing came from, what changed, what is selected). First-load entrances stagger the first 8 rows only,
25ms apart, and run once. Springs are tuned to settle in about 180ms.

**Shared primitives** (`apps/web/components/motion/`, shown in the gallery under "Motion primitives"):
`PageTransition` (4px rise and fade, no exit), `SlidingTabs` (one highlight slides to the chosen
option), `Reveal` / `revealProps` (first-rows entrance, used by `DataTable`), `StateSwap` (loading, empty,
error and data cross-fade), `NumberTicker` (the count-up above), and the `.press` utility (buttons press
in 2%). The prototype has the same behaviour for segmented controls and page changes.

**Where Aceternity UI fits.** We take its functional ideas (sliding tabs, animated sidebar indicator,
number ticker, layout animations) and build them with our own tokens. We do not use its decorative
effects (spotlight, beams, aurora, 3D tilt, glow cards) inside the app: they fight the calm, flat style and
the 120–200ms rule. The login screen may carry one subtle photo fade. Nothing is copied from
Aceternity until its licence file has been read and allows it.

Do NOT use: scroll-triggered reveals, parallax, bouncing, decorative looping animations, glow or
spotlight effects, exit animations that make the next screen wait.

## Wording
- Open-ended dates read "no end date", never "open-ended", and never break across lines.
- Dates `5 Nov 2026`; short form `5 Nov` only where the year is obvious (tables, chips).

## Role dashboards (all must be built)
| Role | Dashboard | Must show |
|---|---|---|
| CEO / MD | Executive Overview | Active projects, deployed vs available, shortages by project, pending approvals, open alerts by severity, document compliance %, midday-ban compliance, upcoming mobilizations |
| Operations Manager | Operations Board | Requests by status, mobilization kanban, manpower plan vs actual, conflicts |
| HR Manager / Executive | HR Console | **Action Center on top**, then open requests waiting for HR (links to the Allocation Board), expiring docs 30/60/90, blocked candidates, pending doc checks, headcount by trade |
| Project Manager | My Projects | Own projects: plan vs actual, open requests, arrivals/departures this week |
| Logistics Coordinator | Camps & Transport | Bed occupancy per camp, arrivals needing beds, pickup lists by vehicle |
| Site Supervisor | Today on Site | Crew list, today's arrivals/departures, midday-ban window, confirm arrival |
| Employee | My Profile (mobile-first) | Assignment, document expiry, camp and pickup, upload renewed doc |
| Super Admin | Admin | Users & roles, agent registry, agent run logs, token/cost usage, Automations (schedule, last run, Run now) |

## HR screens (HR is the primary user)
HR will test allocation hands-on before the CEO sees anything, so HR screens ship complete:
- **Search and filters** on every list. Active filters show as removable chips, plus a "Clear
  filters" control and a result count ("Showing 12 of 21").
- **Validation messages** come from the API's hard rules. Plain English first, rule code second
  (in mono), shown next to the thing that failed, never only as a toast:
  "Visa expires 12 Jan 2027, before cover ends 3 Feb 2027 · `DOC_VALID_THROUGH`".
- **Loading, empty and error states** for every list and panel. Empty states say why and offer
  the next step ("No available steel fixers at level 3+. Lower the level or include people
  available later."). Error states give the reason and a Retry button.
- **Bulk actions** where HR handles many rows: select several, then act once (accept, remove,
  approve a line). Bulk actions say how many rows they affect.
- **No dead buttons.** A control either works or is visibly labelled "Not built yet" and
  disabled, with the reason in its tooltip and accessible name.
- Read-only for roles without the permission (e.g. HR Executive on the board): actions are
  hidden and a short note says which permission is needed.

### Allocation Board
One screen for HR to turn open staffing requests into approved workers.
- **Top: request bar.** Search (request no., project, trade), filters (status, project) and a
  horizontal row of request cards: request no. (mono), project, lines (trade × headcount),
  needed-from date, status chip, fill progress. Default sort: needed-from date, then priority.
  No separate page title: the top bar names the screen, and the height goes to the worker rows.
- **Main: the selected request, line by line.** One compact facts line under the request title.
  - Line header: trade × headcount, level, "n of m selected", and the line actions on the right:
    "Approve n workers" (partial fill allowed and stated), "Reject line" (inline form, reason
    ≥ 10 characters). A line with an unresolved validation error can't be approved; the button
    explains why. The helper sentence shows only when the line is empty or partial.
  - **"Excluded by the agent" sits above the worker list, open, as an amber (warning) callout**,
    one line per person with the plain reason ("visa expires 12 Jan 2027, before 3 Feb 2027")
    and the rule code.
  - **Agent trace**: while recommendations are requested, the steps appear one by one
    (understood request → workers checked → exclusions with reasons → ranking criteria →
    result), then the rows animate in. Afterwards it stays as a collapsed "Agent trace" row.
  - **Workers are compact table rows (40px)**: checkbox, name + code, level, availability, docs
    valid until, one-line reason (full text in a tooltip; bot icon = AI, person icon = HR), Swap
    and an icon-only Remove (labelled for screen readers). All 8 rows of the demo line fit on one
    1440 × 900 screen. Open slots collapse to one dashed row ("2 open slots").
  - Remove needs a reason; removed workers stay listed with Restore. Bulk: checkbox per worker,
    "Remove selected". "Ask Workforce Agent" when a line has no recommendation yet.
- **Right: candidate pool for the active line (sticky).** Available workers in the candidate projection
  (name, code, trade, level, availability window, documents valid). Search; filters: trade
  (defaults to the line's trade), minimum level, "documents valid only", "available by the
  needed date". Each candidate: Add (if a slot is open) or "Swap in" during a swap. Adding runs
  the same validators as approval and shows any failure inline on that candidate.
- **After approval:** the line locks and shows who approved, how many assignments were planned,
  and the mobilization numbers started. The request status updates
  (`partially_filled` / `filled`), and the CEO dashboard counts follow.
- **Layout:** request bar on top; below it the line (flexible) and the pool (340px, sticky under the
  top bar) from 1024px; stacked below that. At 390px the worker table becomes cards and the
  request bar scrolls sideways.
- **Keyboard:** ←/→ (and ↑/↓) move through requests, Enter opens one, Esc cancels a swap or closes a form.

### Action Center (top of the HR Console, and the bell)
- **Severity** is always icon + label + colour, never colour alone: Critical (octagon-x, danger),
  Action needed (triangle-alert, warning), Info (info, info blue). Status chips use the same rule:
  Open, In progress, Snoozed until <date>, Resolved, Dismissed.
- **List:** sorted by severity, then due time. Each row: severity chip, title, project code (mono),
  age ("2 h ago"), assignee (avatar or "HR team"), due, escalation level ("Escalated to HR Manager").
  Filters: severity, type, project, status (default: open + in progress), "assigned to me";
  search; counts per severity as filter chips. Bulk: select → Snooze (pick an end time) or Assign.
  Bulk dismiss is not offered: each dismissal needs its own reason.
- **DetailSheet** (right side): severity + status, title, explanation (labelled "Written by AI
  from the facts below" when narrated), the **facts table** from `facts_json` (numbers
  right-aligned, dates as `5 Nov 2026`, codes in mono), recommended actions as buttons (only those
  the viewer may use; the first is the one accent), then Take / Assign / Snooze / Dismiss and the
  alert's history from the audit log.
- Dismiss opens an inline form: reason required (≥ 10 characters), with the count shown.
  Snooze offers 4 h / tomorrow 07:00 / 3 days / pick a date, capped by the rules.
- **Bell:** count of open critical + action-needed alerts in the viewer's scope; the popover lists
  the 5 most urgent, with "Open Action Center".
- **CEO:** a counts-by-severity tile (three numbers with icons and labels), linking to a read-only
  list.
- Empty state: "No open alerts. Detectors last ran at 07:00." Error state names the API and offers
  Retry.

### Manpower Forecast (HR, Operations, CEO)
- **Header:** project picker (upcoming and active projects in scope) and start date (defaults to
  the project start, editable to test "what if"). Note: "Deployable workers aren't held until you
  reserve them."
- **Table per trade:** Needed · Already assigned · Deployable · Recruitment pending · Gap (danger
  text when > 0, "Covered" with a success chip when 0). Numbers right-aligned and tabular.
- **Expand a trade** to see sources: "Available now (4)", "From RAK-02, ends 31 Jan 2027 (8) ·
  depends on RAK-02 finishing by 5 Feb 2027" (warning chip with a link icon), and exclusions with
  reasons: on leave, documents expire before the horizon, already reserved, inside the transfer
  buffer. Each source lists workers in the candidate projection.
- **Actions per trade:** "Reserve transfers" (select workers from the sources, confirm; disabled
  with a reason without `assignment:approve`), "Raise recruitment request" (inline form: headcount
  defaults to the uncovered gap, needed-by, reason ≥ 10 characters). "Explain" asks the Workforce
  Agent for a plain-English summary of the same numbers.
- Reserved rows show "Reserved · SR-… · depends on …". If a dependency breaks, the row shows the
  critical alert inline.

### Workers (HR, Operations, CEO)
- **List:** search (`/` focuses it), a status strip with counts (Everyone, Available, On a project,
  Mobilizing, Not available), Trade / Project / Documents filters with counts, server-side sorting and
  paging (25 a page), ticked rows with "Copy phone numbers", "Download CSV" of the current view.
  The whole view lives in the address bar (`?status=available&trade=Mason&page=2&worker=EMP-0088`),
  so it can be shared or reloaded.
- **Profile:** a right sheet (Esc closes, focus returns to the row) with Overview, Documents and
  Projects. Overview opens with "Needs attention": documents that are expired or end before the job does.
- **Numbers:** masked (`•••• 4821`) until the eye is pressed; the API records who looked; it hides
  again after 30 seconds. No eye without `employee:read_sensitive`.
- **Narrow projection (logistics):** name, code, trade and phone only; no filters, no export.
- **Phone (390px):** the table becomes cards; the sheet fills the width.

## Quality checklist (check every screen before "done")
- Aligned to the 4px grid; no orphan spacing values.
- One accent use per region; status colours only mean status.
- Every table and panel has loading, empty and error states.
- No dead buttons: every control works or is labelled "Not built yet" and disabled.
- Validation messages appear next to what failed, in plain English with the rule code.
- Numbers right-aligned and tabular. Dates as `5 Nov 2026`. Currency as `AED 1,250`.
- Keyboard: focus ring visible, Esc closes sheets, Cmd+K works.
- Contrast passes WCAG AA in both themes.
- Looks right at 1440px and 390px.

## Sign-in and Home (the first thing people see)
- **Sign-in:** the time-of-day picture on the left (dark at the top for the wordmark, dark at the bottom for the caption), the form on the right; at 390px the picture is a strip above the form.
  Real behaviour only: inline errors, show/hide password, Caps Lock warning, lock-out countdown from `Retry-After`, `next` redirect (own-site paths only), demo accounts only when the API says demo mode is on.
  No forgot-password button until email exists (n8n); the page says "Ask your administrator".
- **Home hero:** the same picture, a role label, "Good morning, Noura", one sentence from real numbers, the date. Dark overlay on the left third only.
- **Time rule:** Gulf Standard Time (`Asia/Dubai`, UTC+4) whatever the visitor's computer says. 05:00-11:59 morning, 12:00-16:59 afternoon, 17:00-04:59 evening. The picture and greeting change at those times without a reload.
  Demo mode: the avatar menu has "Preview morning / afternoon / evening" for presenters.
- **Pictures:** `morning.png`, `afternoon.png`, `evening.png` (`assets/hero-source/`, 2172x724) are converted by `node scripts/build-hero-images.mjs` to `apps/web/public/hero/*.webp` (about 120-210 KB; half-width versions for phones). One picture loads at a time; it cross-fades in 400ms (the only motion over 200ms besides the count-up).
- **Home anatomy:** hero, four KPI tiles, one large chart and one side chart, then a table. HR: documents running out per week (90 days), where everyone is, documents to deal with first, planned against deployed. MD/CEO: planned against deployed, where everyone is, projects table.
  Red is used for emphasis only (the tint under the documents line, the shortfall part of a bar); status colours keep their meaning.