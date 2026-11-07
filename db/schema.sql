-- =====================================================================
-- CONSTRUCTIQ MVP — PostgreSQL schema (v0.3, 2026-11-05)
-- 35 tables in 8 domains: access, workforce, projects, allocation,
-- mobilization, rules & workflow, AI & audit, alerts.
-- Target: PostgreSQL 16 (gen_random_uuid() is built in from PG13).
-- Hosting: runs unchanged on vanilla PG16 (local Docker, CI) and on Neon PG16
-- (btree_gist 1.7 and citext 1.6 supported; checked against Neon docs 2026-11-05).
-- Run it as the database owner role (on Neon: the project owner, a member of
-- neon_superuser), never as constructiq_app.
--
-- v0.2 changes: shift times on sites and assignments, arrival confirmation,
-- notifications.read_at, user_project_access surrogate key (sole source of
-- scope; project_sites.supervisor_id removed), salary columns removed (the
-- client will not provide salary data), new permissions and the service_n8n
-- role, default privileges for the app role.
-- v0.3 changes: recruitment_requests and alerts tables (forward forecasting and
-- the HR Action Center), employee_assignments.depends_on_assignment_id for
-- reserved transfers, work_rules.is_provisional, permissions for forecast,
-- recruitment and alerts, Document Intelligence agent disabled (post-MVP).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- needed for the no-overlap constraint
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive emails

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
CREATE TYPE employment_status  AS ENUM ('active', 'on_leave', 'suspended', 'resigned', 'terminated',
                                        'absconded');
CREATE TYPE exit_reason        AS ENUM ('resigned', 'terminated', 'absconded', 'contract_ended', 'other');
CREATE TYPE availability_state AS ENUM ('available', 'deployed', 'mobilizing', 'demobilizing', 'unavailable');
CREATE TYPE document_type      AS ENUM ('passport', 'residency_visa', 'work_permit', 'labour_card',
                                        'medical_fitness', 'trade_certificate', 'safety_certificate',
                                        'driving_licence', 'other');
CREATE TYPE document_status    AS ENUM ('pending_check', 'verified', 'rejected', 'expired');
CREATE TYPE project_status     AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE request_status     AS ENUM ('draft', 'submitted', 'in_review', 'approved', 'partially_filled',
                                        'filled', 'rejected', 'cancelled');
CREATE TYPE assignment_status  AS ENUM ('planned', 'active', 'completed', 'cancelled');
CREATE TYPE mob_status         AS ENUM ('draft', 'pending_approval', 'approved', 'in_progress', 'completed',
                                        'cancelled');
CREATE TYPE task_status        AS ENUM ('open', 'in_progress', 'done', 'blocked');
CREATE TYPE approval_status    AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE access_scope       AS ENUM ('own', 'site', 'project', 'department', 'all');
CREATE TYPE notify_channel     AS ENUM ('in_app', 'email', 'whatsapp');
CREATE TYPE run_status         AS ENUM ('running', 'succeeded', 'failed', 'refused', 'awaiting_approval');
-- The pipeline HR already tracks in Excel: Future Requirement, Under Recruitment, Offer Issued,
-- Visa Processing, Arrived - Pending Deployment, Active.
CREATE TYPE recruitment_status AS ENUM ('open', 'sourcing', 'offer_issued', 'visa_processing', 'arrived',
                                        'filled', 'cancelled');
CREATE TYPE recruit_source     AS ENUM ('local', 'overseas');
CREATE TYPE line_status        AS ENUM ('open', 'approved', 'rejected');
CREATE TYPE alert_type         AS ENUM ('upcoming_shortfall', 'ending_without_next', 'document_expiry',
                                        'mobilization_stuck', 'transfer_dependency_broken',
                                        'approval_waiting', 'midday_ban_conflict');
CREATE TYPE alert_severity     AS ENUM ('critical', 'action_needed', 'info');
CREATE TYPE alert_status       AS ENUM ('open', 'in_progress', 'snoozed', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------
-- 1. ACCESS (6)
-- ---------------------------------------------------------------------
CREATE TABLE roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE,            -- 'ceo', 'project_manager', ...
    name        text NOT NULL,
    dashboard   text NOT NULL,                   -- landing dashboard key, e.g. 'executive'
    default_scope access_scope NOT NULL DEFAULT 'own',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+:[a-z_]+$'),  -- 'resource:action'
    description text
);

CREATE TABLE role_permissions (
    role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    scope         access_scope NOT NULL,         -- scope this role gets for this permission
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         citext NOT NULL UNIQUE,
    full_name     text NOT NULL,
    password_hash text,                          -- null when SSO is used later
    employee_id   uuid,                          -- FK added after employees exists
    is_active     boolean NOT NULL DEFAULT true,
    mfa_enabled   boolean NOT NULL DEFAULT false,
    ui_preferences jsonb NOT NULL DEFAULT '{}',   -- the person's own screen layout, nothing else
    last_login_at timestamptz,
    is_demo       boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by uuid REFERENCES users(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

-- user_project_access is created after projects (section 3).

-- ---------------------------------------------------------------------
-- 2. WORKFORCE (6)
-- ---------------------------------------------------------------------
CREATE TABLE departments (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    name text NOT NULL
);

CREATE TABLE trades (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code     text NOT NULL UNIQUE,               -- 'steel_fixer', 'mason', 'electrician'
    name     text NOT NULL,
    category text                                -- 'civil', 'mep', 'finishing', 'staff'
);

CREATE TABLE employees (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code     text NOT NULL UNIQUE,      -- company staff number
    full_name         text NOT NULL,
    nationality       text,
    date_of_birth     date,
    phone             text,
    whatsapp_number   text,
    preferred_language text DEFAULT 'en',        -- used for notification templates later
    department_id     uuid REFERENCES departments(id),
    primary_trade_id  uuid REFERENCES trades(id),
    designation       text,
    joined_on         date,
    -- End of the current contract, and the planned or actual last day with the company.
    -- Both are optional; the manpower forecast does not count people who have left by then.
    contract_end_on   date,
    exit_on           date,
    exit_reason       exit_reason,
    employment_status employment_status NOT NULL DEFAULT 'active',
    availability      availability_state NOT NULL DEFAULT 'available',
    -- No salary data: the client will not provide it. The sensitive fields are
    -- employee_documents.doc_number (passport numbers and the Emirates ID number held on the residency visa).
    is_demo           boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employees_trade_idx  ON employees (primary_trade_id, availability);
CREATE INDEX employees_status_idx ON employees (employment_status);

ALTER TABLE users ADD CONSTRAINT users_employee_fk
    FOREIGN KEY (employee_id) REFERENCES employees(id);

CREATE TABLE employee_skills (
    employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    trade_id         uuid NOT NULL REFERENCES trades(id),
    level            smallint NOT NULL CHECK (level BETWEEN 1 AND 5),
    years_experience numeric(4,1),
    verified         boolean NOT NULL DEFAULT false,
    PRIMARY KEY (employee_id, trade_id)
);

CREATE TABLE employee_documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    doc_type        document_type NOT NULL,
    doc_number      text,                        -- sensitive: passport no. / Emirates ID no. (residency_visa)
    issued_on       date,
    expiry_date     date,
    status          document_status NOT NULL DEFAULT 'pending_check',
    file_url        text,                        -- object storage key, never a public URL
    extracted_json  jsonb,                       -- raw AI extraction, kept for review
    extraction_confidence numeric(4,3),
    verified_by     uuid REFERENCES users(id),
    verified_at     timestamptz,
    is_current      boolean NOT NULL DEFAULT true, -- false once superseded by a renewal
    is_demo         boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_documents_expiry_idx
    ON employee_documents (expiry_date) WHERE is_current;
CREATE UNIQUE INDEX employee_documents_one_current
    ON employee_documents (employee_id, doc_type) WHERE is_current AND doc_type <> 'other';

CREATE TABLE leave_records (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type  text NOT NULL,                   -- 'annual', 'sick', 'emergency'
    period      daterange NOT NULL,
    approved    boolean NOT NULL DEFAULT false,
    is_demo     boolean NOT NULL DEFAULT false,
    EXCLUDE USING gist (employee_id WITH =, period WITH &&)
);

-- ---------------------------------------------------------------------
-- 3. PROJECTS (4) + user_project_access
-- ---------------------------------------------------------------------
CREATE TABLE clients (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name    text NOT NULL,
    contact text,
    is_demo boolean NOT NULL DEFAULT false
);

CREATE TABLE projects (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code               text NOT NULL UNIQUE,     -- 'RAK-03'
    name               text NOT NULL,
    client_id          uuid REFERENCES clients(id),
    project_manager_id uuid REFERENCES users(id),
    status             project_status NOT NULL DEFAULT 'planning',
    starts_on          date,
    ends_on            date,
    contract_value_aed numeric(14,2),            -- finance-restricted
    description        text,
    is_demo            boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE project_sites (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       text NOT NULL,
    emirate    text NOT NULL DEFAULT 'Ras Al Khaimah',
    latitude   numeric(9,6),
    longitude  numeric(9,6),
    outdoor    boolean NOT NULL DEFAULT true,    -- midday ban applies when true
    -- Default working hours for crews on this site. A shift may cross midnight
    -- (end < start), so there is no ordering check; Python validates the
    -- midday ban and the daily-hours cap. Supervisors are linked through
    -- user_project_access, not here.
    default_shift_start time,                    -- e.g. 06:00
    default_shift_end   time                     -- e.g. 12:30
);

CREATE TABLE manpower_requirements (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    trade_id    uuid NOT NULL REFERENCES trades(id),
    headcount   integer NOT NULL CHECK (headcount > 0),
    period      daterange NOT NULL,              -- planned window for this headcount
    notes       text
);

-- The ONLY source of project / site scope. A site supervisor gets one row per
-- site they run; a project manager gets one row per project with site_id null.
CREATE TABLE user_project_access (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    site_id    uuid REFERENCES project_sites(id), -- null = whole project
    granted_at timestamptz NOT NULL DEFAULT now()
);
-- One grant per user + project + site; null site (whole project) counts as one value.
CREATE UNIQUE INDEX user_project_access_unique
    ON user_project_access (user_id, project_id,
                            coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX user_project_access_user_idx ON user_project_access (user_id);

-- ---------------------------------------------------------------------
-- 4. ALLOCATION (4)
-- ---------------------------------------------------------------------
CREATE TABLE staffing_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_no   text NOT NULL UNIQUE,           -- 'SR-2026-0042'
    project_id   uuid NOT NULL REFERENCES projects(id),
    site_id      uuid REFERENCES project_sites(id),
    requested_by uuid NOT NULL REFERENCES users(id),
    needed_from  date NOT NULL,
    needed_until date,
    priority     smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    status       request_status NOT NULL DEFAULT 'draft',
    source_text  text,                           -- original natural-language request, if any
    is_demo      boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE staffing_request_lines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  uuid NOT NULL REFERENCES staffing_requests(id) ON DELETE CASCADE,
    trade_id    uuid NOT NULL REFERENCES trades(id),
    headcount   integer NOT NULL CHECK (headcount > 0),
    min_level   smallint CHECK (min_level BETWEEN 1 AND 5),
    filled      integer NOT NULL DEFAULT 0 CHECK (filled >= 0),
    status      line_status NOT NULL DEFAULT 'open',
    decided_by  uuid REFERENCES users(id),
    decided_at  timestamptz,
    decision_reason text,                        -- why a line was rejected (at least 10 characters)
    CHECK (filled <= headcount),
    CONSTRAINT staffing_request_lines_reject_reason_check
        CHECK (status <> 'rejected' OR length(btrim(coalesce(decision_reason, ''))) >= 10)
);

-- Who HR has chosen on a line before it is approved, and who was taken off and why. The line's
-- approved people are the assignments that carry its request_line_id.
CREATE TABLE staffing_request_picks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    line_id       uuid NOT NULL REFERENCES staffing_request_lines(id) ON DELETE CASCADE,
    employee_id   uuid NOT NULL REFERENCES employees(id),
    source        text NOT NULL DEFAULT 'hr' CHECK (source IN ('hr', 'rules', 'agent')),
    reason        text,                          -- one line on why this person
    picked_by     uuid NOT NULL REFERENCES users(id),
    removed_reason text,                         -- set = taken off the line (Restore clears it)
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (line_id, employee_id)
);
CREATE INDEX staffing_request_picks_employee_idx ON staffing_request_picks (employee_id)
    WHERE removed_reason IS NULL;

CREATE TABLE employee_assignments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id      uuid NOT NULL REFERENCES employees(id),
    project_id       uuid NOT NULL REFERENCES projects(id),
    site_id          uuid REFERENCES project_sites(id),
    request_line_id  uuid REFERENCES staffing_request_lines(id),
    -- Reserved transfer: this planned assignment needs the worker's current
    -- assignment (on another project) to end first. Watched by the
    -- transfer_dependency_broken detector.
    depends_on_assignment_id uuid REFERENCES employee_assignments(id),
    period           daterange NOT NULL,         -- '[2026-11-08,2027-02-01)'; upper null = open-ended
    -- Optional overrides of project_sites.default_shift_*; null = use the site default.
    shift_start      time,
    shift_end        time,
    arrived_at       timestamptz,                -- set by assignment:confirm_arrival
    status           assignment_status NOT NULL DEFAULT 'planned',
    recommended_by_run uuid,                     -- agent_runs.id when AI proposed it (FK below)
    approved_by      uuid REFERENCES users(id),
    approved_at      timestamptz,
    is_demo          boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    -- THE key rule: an employee can never hold two live assignments that overlap.
    CONSTRAINT employee_assignments_no_overlap
        EXCLUDE USING gist (employee_id WITH =, period WITH &&)
        WHERE (status IN ('planned', 'active'))
);
CREATE INDEX employee_assignments_project_idx ON employee_assignments (project_id, status);
CREATE INDEX employee_assignments_depends_idx ON employee_assignments (depends_on_assignment_id)
    WHERE depends_on_assignment_id IS NOT NULL;

-- Raised from the Manpower Forecast (or an upcoming_shortfall alert) when the
-- company can't cover a trade from its own people. Open requests count as
-- "covered, pending" in the forecast so the shortfall alert can resolve.
CREATE TABLE recruitment_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_no      text NOT NULL UNIQUE,        -- 'RR-2027-0003'
    project_id      uuid REFERENCES projects(id),
    trade_id        uuid NOT NULL REFERENCES trades(id),
    headcount       integer NOT NULL CHECK (headcount > 0),
    needed_by       date NOT NULL,
    reason          text NOT NULL CHECK (length(btrim(reason)) >= 10),
    status          recruitment_status NOT NULL DEFAULT 'open',
    source          recruit_source NOT NULL DEFAULT 'overseas',
    expected_arrival date,                       -- when the people are expected on site (visa permitting)
    replaces_employee_id uuid REFERENCES employees(id), -- a leaver this request replaces
    requested_by    uuid NOT NULL REFERENCES users(id),
    source_alert_id uuid,                        -- FK added after alerts exists
    is_demo         boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recruitment_requests_open_idx ON recruitment_requests (project_id, trade_id)
    WHERE status IN ('open', 'sourcing', 'offer_issued', 'visa_processing', 'arrived');

-- ---------------------------------------------------------------------
-- 5. MOBILIZATION (6)
-- ---------------------------------------------------------------------
CREATE TABLE camps (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name     text NOT NULL,
    location text,
    is_demo  boolean NOT NULL DEFAULT false
);

CREATE TABLE camp_beds (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    camp_id             uuid NOT NULL REFERENCES camps(id) ON DELETE CASCADE,
    room                text NOT NULL,
    bed                 text NOT NULL,
    current_employee_id uuid UNIQUE REFERENCES employees(id), -- one bed per person
    UNIQUE (camp_id, room, bed)
);

CREATE TABLE vehicles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_no    text NOT NULL UNIQUE,
    kind        text NOT NULL,                   -- 'bus', 'van', 'pickup'
    seats       integer NOT NULL CHECK (seats > 0),
    driver_name text,
    is_demo     boolean NOT NULL DEFAULT false
);

CREATE TABLE mobilizations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mob_no        text NOT NULL UNIQUE,          -- 'MOB-2026-0107'
    assignment_id uuid NOT NULL UNIQUE REFERENCES employee_assignments(id),
    camp_bed_id   uuid REFERENCES camp_beds(id),
    vehicle_id    uuid REFERENCES vehicles(id),
    report_on     date NOT NULL,
    status        mob_status NOT NULL DEFAULT 'draft',
    readiness     jsonb,                         -- checklist snapshot: docs, PPE, induction, bed, transport
    is_demo       boolean NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz
);

CREATE TABLE mobilization_tasks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mobilization_id uuid REFERENCES mobilizations(id) ON DELETE CASCADE,
    demobilization_id uuid,                      -- FK below; a task belongs to one or the other
    department_id   uuid NOT NULL REFERENCES departments(id),
    title           text NOT NULL,               -- 'Verify visa', 'Assign bed', 'Issue PPE'
    owner_id        uuid REFERENCES users(id),
    due_on          date,
    status          task_status NOT NULL DEFAULT 'open',
    completed_at    timestamptz
);

CREATE TABLE demobilizations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    demob_no       text NOT NULL UNIQUE,
    assignment_id  uuid NOT NULL UNIQUE REFERENCES employee_assignments(id),
    release_on     date NOT NULL,
    reason         text,                         -- 'project_complete', 'manpower_reduction', 'transfer'
    status         mob_status NOT NULL DEFAULT 'draft',
    clearance      jsonb,                        -- timesheets, PPE, bed, HR, finance flags
    next_assignment_id uuid REFERENCES employee_assignments(id),
    is_demo        boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    completed_at   timestamptz
);

ALTER TABLE mobilization_tasks
    ADD CONSTRAINT mobilization_tasks_demob_fk
        FOREIGN KEY (demobilization_id) REFERENCES demobilizations(id) ON DELETE CASCADE,
    ADD CONSTRAINT mobilization_tasks_one_parent
        CHECK (num_nonnulls(mobilization_id, demobilization_id) = 1);

-- ---------------------------------------------------------------------
-- 6. RULES & WORKFLOW (4)
-- ---------------------------------------------------------------------
-- Midday work ban and other dated rules. HR updates a row each year
-- when MoHRE announces the dates; code never hard-codes them.
CREATE TABLE work_rules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL,               -- 'midday_ban'
    year            smallint NOT NULL,
    starts_on       date NOT NULL,
    ends_on         date NOT NULL,
    blocked_from    time,                        -- 12:30
    blocked_to      time,                        -- 15:00
    max_daily_hours numeric(4,2),                -- 8
    applies_to_outdoor_only boolean NOT NULL DEFAULT true,
    -- true = HR's planning assumption until MoHRE announces the year's dates.
    -- Validators warn (not block) on provisional rules; the UI labels them.
    is_provisional  boolean NOT NULL DEFAULT false,
    source_url      text,
    updated_by      uuid REFERENCES users(id),
    UNIQUE (code, year),
    CHECK (ends_on >= starts_on),
    CHECK (blocked_to IS NULL OR blocked_from IS NULL OR blocked_to > blocked_from)
);

CREATE TABLE approval_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type text NOT NULL,                  -- 'staffing_request', 'mobilization', 'assignment', 'midday_exemption'
    subject_id   uuid NOT NULL,
    requested_by uuid NOT NULL REFERENCES users(id),
    summary      text NOT NULL,
    status       approval_status NOT NULL DEFAULT 'pending',
    created_at   timestamptz NOT NULL DEFAULT now(),
    decided_at   timestamptz
);
CREATE INDEX approval_requests_open_idx ON approval_requests (status) WHERE status = 'pending';

CREATE TABLE approval_steps (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    step_no     smallint NOT NULL,               -- 1 = HR, 2 = Operations, 3 = CEO, ...
    role_id     uuid NOT NULL REFERENCES roles(id),
    decided_by  uuid REFERENCES users(id),
    decision    approval_status NOT NULL DEFAULT 'pending',
    comment     text,
    decided_at  timestamptz,
    UNIQUE (approval_id, step_no)
);

CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES users(id),
    employee_id uuid REFERENCES employees(id),   -- for workers without a login
    channel     notify_channel NOT NULL,
    event       text NOT NULL,                   -- 'document.expiring', 'mobilization.approved'
    payload     jsonb NOT NULL DEFAULT '{}',
    sent_at     timestamptz,
    delivered   boolean,
    n8n_execution_id text,
    read_at     timestamptz,                     -- in-app read state; null = unread
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (user_id IS NOT NULL OR employee_id IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 7. AI & AUDIT (4)
-- ---------------------------------------------------------------------
CREATE TABLE agents (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code          text NOT NULL UNIQUE,          -- 'supervisor', 'workforce', 'mobilization', 'demobilization', 'document', 'import', 'narrator'
    name          text NOT NULL,
    description   text,
    model_policy  jsonb NOT NULL,                -- {"tier": "light" | "mid"}; models resolved from config
    allowed_tools text[] NOT NULL DEFAULT '{}',  -- each tool also declares its own required permission
    token_budget  integer NOT NULL DEFAULT 20000,
    is_enabled    boolean NOT NULL DEFAULT true,
    version       integer NOT NULL DEFAULT 1
);

CREATE TABLE agent_runs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_run_id  uuid REFERENCES agent_runs(id), -- supervisor -> sub-agent
    agent_id       uuid NOT NULL REFERENCES agents(id),
    user_id        uuid NOT NULL REFERENCES users(id), -- permissions are inherited from this user
    session_id     uuid,
    user_input     text,
    intent         text,
    status         run_status NOT NULL DEFAULT 'running',
    output_json    jsonb,                        -- validated structured output
    model          text,
    input_tokens   integer,
    output_tokens  integer,
    cost_usd       numeric(10,5),
    latency_ms     integer,
    error          text,
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz
);
CREATE INDEX agent_runs_user_idx ON agent_runs (user_id, started_at DESC);

ALTER TABLE employee_assignments ADD CONSTRAINT employee_assignments_run_fk
    FOREIGN KEY (recommended_by_run) REFERENCES agent_runs(id);

CREATE TABLE agent_tool_calls (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id        uuid NOT NULL REFERENCES agent_runs(id),
    tool_name     text NOT NULL,                 -- 'search_employees', 'check_availability'
    required_permission text NOT NULL,
    allowed       boolean NOT NULL,              -- false = refused by the permission layer
    args_json     jsonb,
    result_summary jsonb,                        -- counts / ids, not full personal data
    duration_ms   integer,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),
    user_id     uuid REFERENCES users(id),
    role_codes  text[],
    action      text NOT NULL,                   -- 'assignment.approve', 'document.verify'
    entity_type text NOT NULL,
    entity_id   uuid,
    before_json jsonb,
    after_json  jsonb,
    agent_run_id uuid REFERENCES agent_runs(id),
    ip          inet
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, at DESC);

-- ---------------------------------------------------------------------
-- 8. ALERTS (1) — HR Action Center. Stateful: raised and auto-resolved by
-- Python detectors; title / explanation / actions may be rewritten by the
-- narrator model from facts_json only (see docs/rules.md, ALERT_*).
-- ---------------------------------------------------------------------
CREATE TABLE alerts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type               alert_type NOT NULL,
    severity           alert_severity NOT NULL,
    status             alert_status NOT NULL DEFAULT 'open',
    project_id         uuid REFERENCES projects(id),  -- null = company-wide: visible to 'all' scope only
    subject_type       text NOT NULL,                 -- 'project', 'employee_document', 'mobilization', ...
    subject_id         uuid,
    title              text NOT NULL,                 -- template text until the narrator's version passes checks
    facts_json         jsonb NOT NULL,                -- detector output; never doc_number or phone numbers
    explanation        text,
    recommended_actions_json jsonb NOT NULL DEFAULT '[]', -- [{action, label, params}]; keys from the detector's allow-list
    narrated_by_run    uuid REFERENCES agent_runs(id),
    assigned_to        uuid REFERENCES users(id),
    due_at             timestamptz,
    snoozed_until      timestamptz,
    escalation_level   smallint NOT NULL DEFAULT 0,   -- 0 HR team, 1 HR Manager, 2 Operations
    last_escalated_at  timestamptz,
    resolved_at        timestamptz,
    resolved_by        uuid REFERENCES users(id),     -- null with resolved_at set = auto-resolved
    resolution_note    text,
    dedupe_key         text NOT NULL,                 -- e.g. 'upcoming_shortfall:RAK-07:mason:2027-02-12'
    is_demo            boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'snoozed' OR snoozed_until IS NOT NULL),
    CHECK (status <> 'dismissed' OR length(btrim(coalesce(resolution_note, ''))) >= 10),
    CHECK ((status IN ('resolved', 'dismissed')) = (resolved_at IS NOT NULL))
);
-- One live alert per condition; resolved / dismissed rows stay as history.
CREATE UNIQUE INDEX alerts_dedupe_live ON alerts (dedupe_key)
    WHERE status IN ('open', 'in_progress', 'snoozed');
CREATE INDEX alerts_inbox_idx ON alerts (severity, due_at)
    WHERE status IN ('open', 'in_progress', 'snoozed');
CREATE INDEX alerts_project_idx ON alerts (project_id, status);

ALTER TABLE recruitment_requests ADD CONSTRAINT recruitment_requests_alert_fk
    FOREIGN KEY (source_alert_id) REFERENCES alerts(id);

-- ---------------------------------------------------------------------
-- Application role: audit tables are append-only for the app.
-- ---------------------------------------------------------------------
-- Created NOLOGIN so this file holds no credentials and works on hosts that reject
-- login roles without a password (Neon). The bootstrap step enables login with a
-- password from the environment:
--     ALTER ROLE constructiq_app WITH LOGIN PASSWORD '<APP_DB_PASSWORD>';
-- Neon requires >= 60 bits of entropy; generate it, never hand-type it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'constructiq_app') THEN
        CREATE ROLE constructiq_app NOLOGIN;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO constructiq_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO constructiq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO constructiq_app;
REVOKE UPDATE, DELETE ON audit_log, agent_tool_calls FROM constructiq_app;

-- Tables and sequences created later (Alembic migrations) get the same grants.
-- Default privileges apply to objects created by the role that runs this file,
-- so migrations must run as that same owner role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO constructiq_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO constructiq_app;
-- A new append-only table must still REVOKE UPDATE, DELETE in its own migration.

-- ---------------------------------------------------------------------
-- Helper view: current documents with days left (used by expiry alerts and the HR console)
-- ---------------------------------------------------------------------
CREATE VIEW v_document_expiry AS
SELECT d.employee_id, e.full_name, d.doc_type, d.expiry_date,
       (d.expiry_date - current_date) AS days_left
FROM employee_documents d
JOIN employees e ON e.id = d.employee_id
WHERE d.is_current AND d.expiry_date IS NOT NULL;

-- ---------------------------------------------------------------------
-- Reference data: roles, permissions, 2026 midday ban
-- ---------------------------------------------------------------------
INSERT INTO roles (code, name, dashboard, default_scope) VALUES
 ('super_admin',          'Super Admin',            'admin',        'all'),
 ('ceo',                  'CEO / Managing Director', 'executive',   'all'),
 ('operations_manager',   'Operations Manager',     'operations',   'all'),
 ('hr_manager',           'HR Manager',             'hr',           'all'),
 ('hr_executive',         'HR Executive',           'hr',           'all'),
 ('project_manager',      'Project Manager',        'my_projects',  'project'),
 ('logistics_coordinator','Logistics Coordinator',  'logistics',    'all'),
 ('site_supervisor',      'Site Supervisor',        'site_today',   'site'),
 ('employee',             'Employee',               'my_profile',   'own'),
 -- Service account used by n8n. It has no dashboard and never signs in to the UI.
 ('service_n8n',          'n8n service account',    'none',         'all');

INSERT INTO permissions (code, description) VALUES
 ('employee:read',            'View employee profiles'),
 ('employee:write',           'Create and edit employees'),
 ('employee:read_sensitive',  'View passport and EID numbers'),
 ('document:verify',          'Verify or reject employee documents'),
 ('document:upload',          'Upload documents'),
 ('project:read',             'View projects'),
 ('project:write',            'Create and edit projects'),
 ('project:read_financial',   'View project contract values'),
 ('staffing:read',            'View staffing requests'),
 ('staffing:create',          'Raise staffing requests'),
 ('staffing:approve',         'Approve staffing requests'),
 ('assignment:approve',       'Approve employee assignments'),
 ('assignment:confirm_arrival','Confirm a worker has arrived on site'),
 ('mobilization:read',        'View mobilizations'),
 ('mobilization:create',      'Start mobilization or demobilization'),
 ('mobilization:approve',     'Approve mobilization'),
 ('mobilization:update',      'Tick mobilization tasks'),
 ('logistics:assign',         'Assign beds and transport'),
 ('approval:final',           'Final approval tier'),
 ('ai:use',                   'Use the AI Command Centre'),
 ('agent:admin',              'Manage agents and view execution logs'),
 ('agent:read',               'View agents and execution logs (read only)'),
 ('user:admin',               'Manage users and roles'),
 ('rules:write',              'Edit work rules such as the midday ban'),
 ('automation:run',           'Trigger a scheduled n8n workflow now ("Run now")'),
 ('forecast:read',            'View the Manpower Forecast'),
 ('recruitment:read',         'View recruitment requests'),
 ('recruitment:create',       'Raise recruitment requests'),
 ('alert:read',               'View Action Center alerts'),
 ('alert:act',                'Take, assign, snooze or dismiss alerts'),
 ('alert:detect',             'Service account: run the alert detectors'),
 ('notification:write',       'Service account: write notifications'),
 ('report:read',              'Read summary reports');

-- Role → permission mapping (scope per grant). Mirrors the RBAC table in the plan.
INSERT INTO role_permissions (role_id, permission_id, scope)
SELECT r.id, p.id, x.scope::access_scope
FROM (VALUES
 ('super_admin','employee:read','all'), ('super_admin','employee:write','all'),
 ('super_admin','employee:read_sensitive','all'), ('super_admin','project:read','all'),
 ('super_admin','project:read_financial','all'),
 ('super_admin','project:write','all'), ('super_admin','staffing:read','all'),
 ('super_admin','mobilization:read','all'), ('super_admin','ai:use','all'),
 ('super_admin','agent:admin','all'), ('super_admin','user:admin','all'),
 ('super_admin','rules:write','all'), ('super_admin','report:read','all'),
 ('super_admin','automation:run','all'),

 ('ceo','employee:read','all'), ('ceo','employee:read_sensitive','all'),
 ('ceo','project:read','all'), ('ceo','staffing:read','all'),
 ('ceo','staffing:approve','all'), ('ceo','assignment:approve','all'),
 ('ceo','mobilization:read','all'), ('ceo','mobilization:approve','all'),
 ('ceo','approval:final','all'), ('ceo','ai:use','all'), ('ceo','report:read','all'),
 ('ceo','project:read_financial','all'), ('ceo','agent:read','all'),
 ('ceo','forecast:read','all'), ('ceo','recruitment:read','all'), ('ceo','alert:read','all'),

 ('operations_manager','employee:read','all'), ('operations_manager','project:read','all'),
 ('operations_manager','project:write','all'), ('operations_manager','staffing:read','all'),
 ('operations_manager','staffing:approve','all'), ('operations_manager','assignment:approve','all'),
 ('operations_manager','mobilization:read','all'), ('operations_manager','mobilization:create','all'),
 ('operations_manager','mobilization:approve','all'), ('operations_manager','ai:use','all'),
 ('operations_manager','report:read','all'),
 ('operations_manager','forecast:read','all'), ('operations_manager','recruitment:read','all'),
 ('operations_manager','recruitment:create','all'), ('operations_manager','alert:read','all'),
 ('operations_manager','alert:act','all'),

 ('hr_manager','employee:read','all'), ('hr_manager','employee:write','all'),
 ('hr_manager','employee:read_sensitive','all'), ('hr_manager','document:verify','all'),
 ('hr_manager','document:upload','all'), ('hr_manager','project:read','all'),
 ('hr_manager','staffing:read','all'), ('hr_manager','mobilization:read','all'),
 -- HR is the primary allocation user: reviews, swaps and approves workers on the Allocation Board.
 ('hr_manager','staffing:approve','all'), ('hr_manager','assignment:approve','all'),
 ('hr_manager','forecast:read','all'), ('hr_manager','recruitment:read','all'),
 ('hr_manager','recruitment:create','all'), ('hr_manager','alert:read','all'),
 ('hr_manager','alert:act','all'),
 ('hr_manager','mobilization:create','all'), ('hr_manager','mobilization:approve','all'),
 ('hr_manager','rules:write','all'), ('hr_manager','ai:use','all'),
 -- HR plans the work: it adds new projects and their manpower requirements.
 ('hr_manager','project:write','all'),
 -- HR raises and prepares staffing requests; the HR Manager approves them (nobody approves their own).
 ('hr_manager','staffing:create','all'),
 -- HR ticks mobilization tasks and confirms arrival for every department (no Operations or Site logins in the MVP).
 ('hr_manager','mobilization:update','all'), ('hr_manager','assignment:confirm_arrival','all'),

 ('hr_executive','employee:read','all'), ('hr_executive','employee:write','all'),
 ('hr_executive','document:verify','all'), ('hr_executive','document:upload','all'),
 ('hr_executive','project:read','all'), ('hr_executive','staffing:read','all'),
 ('hr_executive','mobilization:read','all'), ('hr_executive','ai:use','all'),
 ('hr_executive','forecast:read','all'), ('hr_executive','recruitment:read','all'),
 ('hr_executive','alert:read','all'), ('hr_executive','alert:act','all'),
 ('hr_executive','project:write','all'),
 ('hr_executive','staffing:create','all'),
 ('hr_executive','mobilization:update','all'), ('hr_executive','assignment:confirm_arrival','all'),

 ('project_manager','employee:read','project'), ('project_manager','project:read','project'),
 ('project_manager','staffing:read','project'), ('project_manager','staffing:create','project'),
 ('project_manager','mobilization:read','project'), ('project_manager','mobilization:create','project'),
 ('project_manager','ai:use','project'), ('project_manager','alert:read','project'),

 ('logistics_coordinator','employee:read','all'), ('logistics_coordinator','project:read','all'),
 ('logistics_coordinator','mobilization:read','all'), ('logistics_coordinator','logistics:assign','all'),
 ('logistics_coordinator','ai:use','all'),

 ('site_supervisor','employee:read','site'), ('site_supervisor','project:read','site'),
 ('site_supervisor','staffing:read','site'), ('site_supervisor','mobilization:read','site'),
 ('site_supervisor','ai:use','site'), ('site_supervisor','assignment:confirm_arrival','site'),

 ('employee','employee:read','own'), ('employee','employee:read_sensitive','own'),
 ('employee','document:upload','own'), ('employee','mobilization:read','own'),

 ('service_n8n','notification:write','all'), ('service_n8n','report:read','all'),
 ('service_n8n','alert:detect','all')
) AS x(role_code, perm_code, scope)
JOIN roles r       ON r.code = x.role_code
JOIN permissions p ON p.code = x.perm_code;

INSERT INTO work_rules (code, year, starts_on, ends_on, blocked_from, blocked_to, max_daily_hours, source_url)
VALUES ('midday_ban', 2026, '2026-06-15', '2026-09-15', '12:30', '15:00', 8,
        'https://whatson.ae/?p=390839');

-- model_policy holds a tier only ('light' | 'mid'). Provider and model per tier come from
-- config (LLM_TIER_LIGHT_*, LLM_TIER_MID_*), never from this table. See docs/agents.md.
INSERT INTO agents (code, name, description, model_policy, allowed_tools, is_enabled) VALUES
 ('supervisor', 'Supervisor Agent', 'Classifies intent and routes to one domain agent',
  '{"tier": "light"}', ARRAY['route_to_agent'], true),
 ('workforce', 'Workforce Agent', 'Availability, skill matching, staffing recommendations',
  '{"tier": "mid"}', ARRAY['workforce_summary','forecast_availability','draft_staffing_request',
                           'search_employees','check_availability','check_documents',
                           'check_work_rules','recommend_candidates',
                           'get_employee_documents','list_expiring_documents'], true),
 ('mobilization', 'Mobilization Agent', 'Checklists, readiness, department tasks',
  '{"tier": "light"}', ARRAY['list_mobilizations','get_mobilization','check_readiness','create_mob_tasks'], true),
 ('demobilization', 'Demobilization Agent', 'Clearance tracking, reassignment suggestions',
  '{"tier": "light"}', ARRAY['get_demobilization','check_clearance','search_employees'], true),
 -- Post-MVP (docs/mvp-plan.md, "Path to production"). Document read tools moved to the Workforce Agent.
 ('document', 'Document Intelligence Agent', 'Normalises OCR / MRZ fields from uploaded documents',
  '{"tier": "light"}', ARRAY['extract_document'], false),
 -- Not a tool-using agent: one structured call that words an alert from its facts_json.
 -- Registered so its calls are logged in agent_runs like every other model call.
 ('narrator', 'Alert Narrator', 'Writes alert title, explanation and action labels from detector facts',
  '{"tier": "light"}', ARRAY[]::text[], true),
 -- Built right after the Allocation Board (Days 7–8). Manual column mapping works without it.
 ('import', 'Import Agent', 'Maps spreadsheet columns to employee fields for a bulk import',
  '{"tier": "light"}', ARRAY['read_spreadsheet','validate_mapping','preview_import'], true);
