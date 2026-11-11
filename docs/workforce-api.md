# Workforce API (Phase 8)

All routes are under `/workforce`. Reads need `employee:read` and an all-projects scope (HR and the MD).
Writes need `employee:write` (people) or `project:write` (plan, project stage); the MD is read-only.
No list ever carries a phone number or email; one person's profile shows them to HR only.

## Words
- **Designation**: a role. `kind` is `staff` or `labour`. A UAE-nationals-only place is its own line:
  `uae_only: true`, shown as "UAEN Site engineer".
- **Status** of a person: `offer_issued` -> `documents_cleared` -> `active` (joined) -> `resigned`
  (also `terminated`, `absconded`, `on_leave`). Steps run in order; resigning is always possible.
- **Headcount** per project and designation: `planned`, `active`, `pipeline` (offer issued + documents
  cleared), `to_hire = max(planned - active - pipeline, 0)`, `over = the excess`. Resigned never counts.

## Reading
| Route | Returns |
|---|---|
| `GET /workforce/projects` | every project (head office and cost centres too): code, name, kind, stage, `stage_label`, dates, and `staff` / `labour` headcount |
| `GET /workforce/people?kind=staff\|labour&project=CODE&status=&q=&designation=&department=&limit=&offset=` | `{items, total, by_status}`; the Staff and Labour tabs, with the project filter |
| `GET /workforce/projects/{code}/people` | `{staff: {items,total,by_status}, labour: {...}}`: the two tables on the project page |
| `GET /workforce/projects/{code}/plan` | `{project, staff: [line], labour: [line], totals}`; a line has `designation, kind, department, uae_only, planned, active, pipeline, to_hire, over, needed_by, source` |
| `GET /workforce/people/{code}` | profile with `next_step` and `history` |
| `GET /workforce/recruitment?kind=` | the hiring board: `rows` (designation, kind, department, `to_hire`, `could_move`, `hire`, `advice`, `projects: [table rows]`) and `totals` |
| `GET /workforce/history?by=ai\|hr&project=` | what was done: kind, who decided (`hr` or `ai`), reason, person, from/to project |
| `GET /workforce/chart` | per project planned / active / pipeline / to_hire, and totals, for the graph |
| `GET /workforce/designations?kind=` | the role list for dropdowns |
| `GET /workforce/mobilization?project=&kind=` | the Mobilization board: `columns` offer_issued, documents_cleared, can_join (documents cleared + an expected joining date), each with people (`expected_join_on`, `late`), plus `total` and `late` |

## Writing
| Route | Body | Notes |
|---|---|---|
| `POST /workforce/people` | `{name, designation, project_code?, auto?, status?, code?, phone?, email?, uae_national?, joined_on?, source?, resolve?}` | with `project_code` the person is placed there; with `auto: true` the system picks the real project (never head office, camp or other groups) that needs the role most and says why (`decided_by: "ai"`, `reason`). Returns the placement and a plain-words `message` |
| `POST /workforce/people/{code}/milestone` | `{to: documents_cleared\|active\|resigned, on?}` | out-of-order steps are 409 |
| `POST /workforce/people/{code}/move` | `{project_code, resolve?}` | |
| `PATCH /workforce/people/{code}/join-date` | `{expected_join_on: date or null}` | the date HR expects someone to join; it becomes their joining date when they are marked joined. Only for people who have not joined |
| `PUT /workforce/projects/{code}/plan` | `{designation, uae_only?, planned, needed_by?, source?}` | sets a planned count |
| `PATCH /workforce/projects/{code}` | `{stage?, starts_on?, ends_on?}` | stages: `pre_construction, active, handover, completed, on_hold` |
| `POST /imports/trackers?kind=labour\|staff&apply=false\|true` | the .xlsx as the raw body | preview first; apply writes |

## The over-filled answer
Adding or moving into a full line changes nothing and answers **409** with
`{"detail": "...", "overfilled": {"table": [{project, designation, planned, now, after}], "people": [{code, name, status}], "project": "CODE", "options": ["increase_plan", "choose_another_person", "cancel"]}}`.
HR chooses: send the same request again with `"resolve": "increase_plan"` (the plan grows by one and
the person is placed), pick one of `people` to move or resign instead, or cancel. With `auto: true` and
no open place anywhere the answer is a plain 409 (`detail` only).