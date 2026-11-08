# HAMRA AI — Design direction

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
  Alhamra wordmark (`assets/brand/ALHAMRA-LOGO.svg`, white, see `CLAUDE.md` → Brand) with HAMRA AI set in
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
- Sidebar header: the Alhamra mark (`assets/brand/ALHAMRA-FAVICON-LOGO.svg`) with HAMRA AI beside it; only
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

**As built (Virtual HR, Phase 6.2).** The Command Centre is the Virtual HR chat: the top-bar "Ask HR"
button and Ctrl/Cmd+K open it in the drawer (the thread is kept while the app is open), and
`/assistant` is the same thread as a page with your saved conversations (private; delete asks
first). Shown only to people with `ai:use`.
- A question is a plain bubble on the right; an answer is the AI answer card, never loose text:
  summary, then blocks (counts, a table that scrolls inside its card, alerts as links, bars), the
  "Why" line (how the question was understood, and where the numbers were read and when), links to
  the screens that hold the full list, and the collapsed Trace (real steps, one by one as they happen).
- The card's pill says who worded it: "AI-worded · checked" (a model's sentence that passed the
  facts check), "Python wording", or "Python only" (no model answered).
- A refusal (salary, phone numbers, document numbers) and "unavailable" are amber notes with no
  data. A wrong word is a question back ("The trades are: ..."), never a guess.
- Actions are links only. The chat never changes data; the MD/CEO gets the same read-only links.
- States: loading (steps, then skeleton rows for history), empty (suggestions per role), error with
  Try again (not offered for "wait for the answer"), the AI-off notice, light and dark, 390px (the
  drawer is full width, the history folds behind a History button).

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
  - **"Left out by the rules" sits above the worker list, open, as an amber (warning) callout**,
    one line per person with the plain reason ("visa expires 12 Jan 2027, before 3 Feb 2027")
    and the rule code. (Built: the list comes from the Python rules service. When the Workforce
    agent exists in Phase 5 it explains this list; it does not make it.)
  - **Agent trace** (built): "Ask Workforce agent" (bot icon, beside Suggest people) opens the
    agent's card under the line's buttons. Its steps appear one by one as the agent really does them
    ("Read the request line", "Searched the people who could be chosen", "Checked 3 people against
    the hard rules", "Chose 7"), each worded by the server from the tool's own counts, never by
    the model. Then the summary ("Recommends 7 workers, 1 place stays open."), an amber **Dropped
    by the rules** callout for anyone the model proposed and the rules refused (with the rule code),
    and one row per person with a bot icon and a one-line reason. A reason the model worded that
    states something the tools never said is replaced by the rules' wording and marked "reason
    worded by the rules". **Use these n** chooses them as the agent's (every hard rule runs again);
    afterwards the card keeps only the summary, the callout and the collapsed Trace. Failure shows
    "The agent could not finish." with the reason and Try again. With no model set up the button is
    shown switched off with "The AI model is not set up on this server." Esc closes the card.
  - **Workers are compact table rows (40px)**: checkbox, name + code, level, availability, docs
    valid until, one-line reason (full text in a tooltip; bot icon = AI, person icon = HR), Swap
    and an icon-only Remove (labelled for screen readers). All 8 rows of the demo line fit on one
    1440 × 900 screen. Open slots collapse to one dashed row ("2 open slots").
  - Remove needs a reason (3+ characters); removed workers stay listed with Restore, which runs
    the rules again and shows why if it is refused. Bulk: checkbox per worker, "Remove selected"
    (one reason for all). **Swap** takes the old person off with the reason "Swapped for X", then
    adds X; if the rules refuse X, the old person is put straight back and the reason shows on X.
    Esc cancels a swap. "Suggest people" (built) fills the open slots from the rules service and
    marks each row with the list icon; "Ask Workforce agent" (bot icon) marks its rows with the bot.
  - **Approve opens a consequence preview** (a dialog, not a toast): each person with their
    start date and "after finishing on RAK-05 (20 Nov 2026)" where it applies, then "n assignments
    planned, n mobilizations started", "n depend on another job finishing on time" and
    "The line will be n of m". The preview is the server's answer to the same call with
    `preview: true`, which writes nothing. Confirming runs the rules again; if anyone no longer
    passes, nothing is saved and the dialog names them with the rule code.
  - **Reject line** is an inline form (reason ≥ 10 characters, with a live count). **Cancel
    request** (header, only while nobody is approved) is an inline form with a reason.
  - **Read-only roles** see the board without the buttons they cannot use: the HR Executive sees
    "Approving needs the HR Manager."; the person who raised a request sees "You raised this
    request, so someone else has to approve it."; the MD/CEO has no pool and no Suggest, only
    Approve and Reject.
  - **New request** (sheet): project (its dates fill in), needed from/until, priority (1 urgent …
    5 lowest), one line per trade with headcount and minimum level, optional note. It goes to
    the HR Manager for approval; both mistakes on a line show together.
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
- **Keyboard:** ←/→ (and ↑/↓) move focus through the request cards, Enter opens one, Esc cancels a
  swap or closes a form, the approval preview and the New request sheet. The selected request is
  kept in the address (`/requests?request=SR-2026-0001`).
- **After approval, on the board:** the success banner links to the pipeline ("Open the pipeline")
  and each MOB number in the locked line opens that person's checklist.
- **Not built yet:** the midday-ban rules (BAN_*) on the board.

### Mobilization (the pipeline and the checklist)
Where an approved person becomes a person on site. HR is the user: the HR Manager and the HR
Executive tick tasks off and confirm arrival for every department (the MVP has no Operations or Site
logins); the MD/CEO can read everything and change nothing.
- **Pipeline** (`KanbanBoard`, `/mobilization`): four columns, left to right: *Pending checklist*
  (no task done), *In progress*, *Ready to report* (every task done, waiting for the day) and
  *On site* (arrived in the last 14 days). Four columns from 1024px, stacked sections below, so at 390px
  there is no sideways scroll. **Cards cannot be dragged**: the stage is computed from the tasks by
  the Python service (`MOB_STAGE`), never set by hand. A card shows the MOB number (mono), the person
  and code, trade and project, the report day (or the arrival day), a progress bar with "3 of 5
  tasks done", and an amber "n overdue" chip when a task is past its due date.
- **Header:** the title, then one line from the data: "9 people being mobilized, 2 with an overdue
  task". Search (name, code, MOB number, project), project filter, "Overdue only".
- **Checklist** (right-side `DetailSheet`, opened by a card or `?mob=MOB-2026-0107`): who, trade,
  project, report day, progress, then the five tasks grouped by department (Human Resources,
  Operations, Site workforce). Each task shows its due date and an "Overdue" chip, or "Done by
  Noura Demo, 4 Nov 2026". **Mark done** and **Reopen** are small buttons, server-confirmed with a
  pending state (never optimistic: the server can refuse); the answer is the whole checklist, so
  the progress bar, the stage chip in the header and the card behind the sheet move together.
- **Confirm arrival** is the one accent button, at the foot of the sheet. It is enabled only when the
  report day has come and every task is done; otherwise it is disabled and the sentence above it says
  why ("Reports on 8 Nov 2026. Arrival can be confirmed from that day." / "Finish the checklist
  first: 2 tasks are still open."). Confirming makes the person Deployed, closes the checklist
  (no buttons any more) and puts them in *On site*; the board shows "Aamir Siddiqui arrived and is
  now Deployed."
- **Read-only** (MD/CEO): no task buttons and no arrival button; the sheet says "Only HR ticks tasks
  off." and "Only HR confirms arrival."
- **Worker profile:** the Projects tab shows the MOB number (a link to the checklist) and "n of 5
  tasks done" for anyone being mobilized.
- **States:** skeleton columns, an empty board that points to Allocation, "No one matches these
  filters", error with Retry (board and sheet), light and dark, keyboard (cards are buttons, Esc
  closes the sheet and returns focus to the card).
- **Not built yet:** `blocked` tasks and notes, approving a mobilization that waits for approval
  (nothing creates one with the HR Manager or MD/CEO approving), beds and vehicles, and
  demobilization. A mobilization that is late or about to be raises a `mobilization_stuck` alert
  (see To-do below).

### Action Center: To-do, the bell, and Home (as built)
- **Severity** is always icon + label + colour, never colour alone: Critical (octagon-x, danger),
  Action needed (triangle-alert, warning), Info (info, info blue). Status chips use the same rule:
  In progress, Snoozed until <date>, Dismissed; an alert that moved up shows "Escalated to HR
  Manager" in the row.
- **To-do** (`/todo`, in the sidebar beside Home; needs `alert:read`): the heading says "9 need
  attention, 3 for information, 2 snoozed · Detectors last ran at 09:00 on 5 Nov 2026."
  View tabs **Open · Snoozed · Cleared**, severity tabs with counts (All, Critical, Action needed,
  Info), type and project selects, search, "Assigned to me". Rows are sorted by severity, then due
  time: checkbox, severity chip, title, type, project code (mono), assignee ("HR team" when nobody
  took it), age. Snoozing, dismissing or clearing a row collapses it (height + fade) and every
  counter follows. At 390px each row wraps to two lines.
- **Bulk:** tick rows (or "Select all") → Snooze (same choices as one alert) or Assign. Bulk
  dismiss is not offered: each dismissal needs its own reason, and the bar says so.
- **Alert sheet** (right side; `?alert=` in the address, so the link can be shared): severity +
  status, title, the explanation (labelled "Written by AI from the facts below" only when a model
  wrote it, and the history then says "Worded by AI from the facts"; with no model configured every
  explanation is worded in Python), the **facts table** ("Facts behind this
  alert"; label left, value left, dates as `5 Nov 2026`, codes in mono, numbers in tabular
  figures), the one accent button that opens the screen where the cause is fixed (Open worker,
  Open Allocation, Open mobilization, Open forecast), then Take it / Assign / Snooze / Dismiss and
  the history. Esc closes it and focus goes back to the row.
- **Take / Assign:** Take makes the alert yours ("You are working on this."); Assign picks from
  the people who work on alerts.
- **Snooze** offers 4 hours, Tomorrow 07:00, 3 days and "Or pick a day"; a critical alert can only
  be snoozed for up to a day (so only the first two), any other for up to 7 days. It comes back at
  07:00 if the cause is still there.
- **Dismiss** only exists for alerts a person can rightly decide are not a problem (shortfall,
  ending soon, document, midday ban). It opens an inline form: reason required (≥ 10
  characters), with the count shown ("9 of 10 characters"). A dismissed alert stays down unless
  the condition gets worse. Mobilization, approval and transfer alerts clear themselves when the
  cause is fixed and can only be snoozed.
- **Bell** (top bar, every signed-in role that can read alerts): the number of critical +
  action-needed alerts in the viewer's scope; the menu lists the 5 most urgent, "Open To-do", and
  when the detectors last ran. It refreshes every 30 s while the tab is visible and straight away
  after any change made in the app (taking, snoozing, approving, ticking a task).
- **Home:** HR's first widget is the Action Center (counts by severity, the 5 most urgent, "Open
  To-do"); the MD/CEO's is an "Open alerts" tile (three counts with icons and labels, each linking
  to the read-only list filtered by severity). The one-line insight under the greeting is chosen
  and worded by the API.
- **MD/CEO:** sees every alert and the facts; the sheet says "Only HR works on alerts." and has
  no Take / Assign / Snooze / Dismiss and no checkboxes. The links to other screens still work.
- **Projects → Change dates:** each project row has a Change dates button (needs `project:write`)
  that opens a sheet with Starts and Ends. It explains at once when the end is before the start,
  keeps Save off until something changed, and sends only what changed. People already placed keep
  the dates they were given; the forecast and the alerts follow the new dates immediately (this is
  how a transfer's source job ending later raises the transfer alert). The page confirms "RAK-07
  now runs from 12 Feb 2027 to 31 Jan 2028."
- **States:** skeleton rows, "No open alerts" with when the detectors last ran, "No alerts match
  these filters" with Clear filters, an error that names what failed with Retry (list, bell and
  sheet separately), light and dark, keyboard throughout.
- **Not built yet:** sending messages and the
  "Send reminder" / "Remind approver" actions, the 07:00 and 18:00 schedule (the detectors run
  after every change and on `POST /alerts/run` until n8n calls it), "Open site shifts" and "Request
  exemption", and editing the 2027 midday-ban dates in the app (it is a provisional rule, labelled
  as such in the alert, until HR confirms the dates).

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

### Projects and the forecast, as built (HR, Operations, CEO)
- **Projects:** a table (code and name, status chip, dates, "27 of 30" with "3 short" in the danger tone, a
  Forecast button). **Add project** (accent button, only with `project:write`) opens a right sheet: name,
  start and end date, outdoor site, and a list of trades with a headcount each (each trade once; rows can be
  added and removed). Mistakes are explained under the field and focus goes to the first one; a refusal from
  the server is shown above the buttons. On success the forecast opens with "RAK-08 was added".
- **Forecast:** one card per trade: Needed, Already assigned, Deployable, Recruitment pending, Gap (danger
  text above 0) and a status chip: Covered (success), Covered, depends on others (info), Recruiting (info),
  Recruit N (danger tint, with an icon). Under the numbers, one sentence worded by Python: "Recruit 4 by
  13 Jan 2027, or have 2 start up to 12 days late and recruit 2." **Show people** lists Free now, From
  <project> (with a "depends on <project> finishing by ..." chip), **Could join late** (finishing just inside
  the handover buffer or up to 21 days after the start, shown with the days; never counted), and Not counted
  (on leave, documents, planned elsewhere, not available) with the reason.
- **Explain** (built; needs `ai:use`): a button beside the what-if date opens the same agent card
  above the trades with the agent's plain-words summary of the numbers on screen, labelled "Written
  by AI from the numbers below. The numbers themselves come from the forecast service." The summary
  is kept only if every number, date and code in it is in the forecast; otherwise the card says the
  wording did not match and shows nothing. The card belongs to the date it was asked for: changing
  the date closes it. Switched off, with the reason, when no model is set up.
- **What if:** a start-date field re-runs the forecast; "Back to project start" returns. The date is in the
  address bar. Reserve transfers and Raise recruitment request are the next slice and are not shown yet.

### Documents (HR, MD/CEO)
- **Tabs:** Expired, Next 30 days, 31 to 60 days, 61 to 90 days, each with a count that follows the filters. Search
  (`/` focuses it), Document type and Project filters, "Clear filters". The whole view is in the address bar.
- **Table:** worker (opens the profile on its Documents tab, numbers still masked), document, expires, a time-left chip
  (same colours as Home), project, **job ends** with a warning chip "ends before the job" when the document runs out
  first, and a phone link. Ticked rows copy their phone numbers. "Download CSV" follows the tab and filters.
- **States:** skeleton, an empty state per tab in plain words, "No documents match" with a way back, an error with
  Retry. Phone: cards, with the warning chip kept. The Home widget "Documents to deal with first" links here ("See all").
### Home widgets and Customize (HR, MD/CEO)
- **Fixed above, flexible below.** The hero and the four KPI tiles never move. Everything under them is a widget in a
  3-column grid (one column on a phone). Each widget has a fixed width of 1, 2 or 3 columns; people change the order,
  not the size.
- **Default layout.** HR: Documents running out, Where everyone is, Documents to deal with first, Projects planned and
  deployed, People by trade, People not available, Leaving soon, Recruitment pipeline. MD/CEO: Projects chart, Where
  everyone is, Projects table, Recruitment pipeline, Leaving soon; People by trade is off until asked for.
- **Customize** (a quiet button above the widgets) switches the grid into edit mode. Each widget gets a slim bar above
  it with a drag handle, its title and a Hide button; the widget itself is inert while editing, so a chart is never
  clicked by accident. The bar sits above the widget and never covers anything in its header. Hidden widgets are listed
  below with a Show button (shown ones go to the end). Done saves; Reset to default restores ours; Cancel discards.
  A failed save keeps the changes on screen and says why.
- **Dragging.** Mouse and touch (the handle only, after 6 px); keyboard: focus the handle, Space, arrow keys, Space.
  Screen readers hear "Picked up ..., position 3 of 8" and "Dropped ... in position 1 of 8". Motion is off when the
  person asks for reduced motion.
- **Loading.** Widgets that load their own data show a skeleton, an empty state and an error with Retry. A hidden
  widget costs no request.
- **Not built, on purpose:** nationality mix (no data), headcount trend (no leaver history), per-trade shortage (the seed's
  trade mix does not match the project plans, so it would disagree with the project totals), a team-wide default set by HR.
### Reserve, raise a request and Recruitment (HR)
- **On each trade card** three buttons: Show people, **Reserve people**, **Raise recruitment request**. Without the
  permission a button is disabled with its reason (tooltip and the line "Some actions need the HR Manager"); it is never
  hidden, so HR knows the action exists. Reserve is also disabled when nobody can be reserved.
- **Reserve sheet:** everyone the forecast allows, free-now and finishing-before-start ticked, "could join late" unticked
  and shown in warning text. A plain sentence says what will happen ("You will reserve 4 people. 2 start only after they
  finish on another project..."). After confirming, each person is listed as reserved (with the start and where they come
  from) or refused (with the server's reason). Under Show people, **Reserved (n)** lists them with a Release link.
- **Raise sheet:** how many (default the uncovered gap), local or overseas, needed by (follows the lead time of the chosen
  source, never in the past), expected arrival, reason. Errors under the field; focus goes to the first. It states that
  it contacts nobody.
- **Recruitment screen:** a "Leaving, with nobody to replace them" card with a Raise replacement button each, then a table
  of requests with the pipeline stage chip, local or overseas, expected arrival with a warning "late" chip, and the one
  next step ("Move to visa processing") plus Cancel. Moving asks how many (splitting if fewer) and an optional new arrival
  date; cancelling asks first. Tabs: In progress, Finished or cancelled. Phone: cards.
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