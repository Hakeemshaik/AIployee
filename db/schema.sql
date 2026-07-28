-- =============================================================================
-- AIployee Platform — PostgreSQL schema
--
-- Companion to docs/dashboard-data-model.md. Stages match section 5 of that
-- document; each stage is independently deployable.
--
-- Target: PostgreSQL 15+ (Supabase). Requires pgcrypto for gen_random_uuid().
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- Enumerated types (stable sets only; evolving lists use text + check)
-- =============================================================================

create type department       as enum ('leasing', 'collections', 'operations');
create type channel          as enum ('voice_out', 'voice_in', 'whatsapp', 'sms', 'email');
create type direction        as enum ('inbound', 'outbound');
create type unit_status      as enum ('occupied', 'vacant', 'on_notice');
create type tenancy_status   as enum ('pending', 'active', 'expired', 'terminated');
create type ptp_status       as enum ('open', 'kept', 'partial', 'broken', 'cancelled');
create type job_priority     as enum ('emergency', 'urgent', 'routine');
create type org_role         as enum ('owner', 'admin', 'manager', 'viewer');


-- =============================================================================
-- STAGE 1 — Tenancy, access, property, people, import lineage
-- =============================================================================

create table organisation (
    id          uuid primary key default gen_random_uuid(),
    name        text        not null,
    slug        text        not null unique,
    timezone    text        not null default 'Africa/Johannesburg',
    active      boolean     not null default true,
    created_at  timestamptz not null default now()
);

create table app_user (
    id           uuid primary key default gen_random_uuid(),
    email        text        not null,
    full_name    text        not null,
    is_internal  boolean     not null default false,  -- AIployee staff vs client
    created_at   timestamptz not null default now()
);
create unique index app_user_email_key on app_user (lower(email));

create table org_membership (
    id               uuid primary key default gen_random_uuid(),
    organisation_id  uuid        not null references organisation (id) on delete cascade,
    app_user_id      uuid        not null references app_user (id) on delete cascade,
    role             org_role    not null default 'viewer',
    -- empty array = all departments
    departments      department[] not null default '{}',
    created_at       timestamptz not null default now(),
    unique (organisation_id, app_user_id)
);

create table import_batch (
    id               uuid primary key default gen_random_uuid(),
    organisation_id  uuid        not null references organisation (id) on delete cascade,
    filename         text        not null,
    detected_format  text,                 -- Mafadi source layouts A-G, or 'ripple_age_analysis'
    rows_in          integer     not null default 0,
    rows_clean       integer     not null default 0,
    rows_rejected    integer     not null default 0,
    uploaded_by      uuid        references app_user (id),
    notes            text,
    created_at       timestamptz not null default now()
);

create table import_reject (
    id               uuid primary key default gen_random_uuid(),
    import_batch_id  uuid        not null references import_batch (id) on delete cascade,
    row_number       integer     not null,
    reason           text        not null,   -- e.g. 'unusable phone', 'no balance', 'duplicate'
    raw_data         jsonb,
    created_at       timestamptz not null default now()
);
create index import_reject_batch_idx on import_reject (import_batch_id);

create table building (
    id               uuid primary key default gen_random_uuid(),
    organisation_id  uuid        not null references organisation (id) on delete cascade,
    code             text,                  -- "Prop" column in source files
    name             text        not null,
    address          text,
    region           text,
    portfolio        text,
    created_at       timestamptz not null default now(),
    unique (organisation_id, code)
);

create table unit (
    id           uuid primary key default gen_random_uuid(),
    building_id  uuid        not null references building (id) on delete cascade,
    unit_number  text        not null,
    door_no      text,
    unit_ref     text,                      -- external reference from source system
    unit_type    text,
    bedrooms     smallint,
    market_rent_cents  bigint,
    status       unit_status  not null default 'occupied',
    vacant_since date,
    created_at   timestamptz not null default now(),
    unique (building_id, unit_number)
);
create index unit_status_idx on unit (status) where status <> 'occupied';

-- Deduplicated on phone. See data model 1.2 — one human, one row, all departments.
create table contact (
    id                 uuid primary key default gen_random_uuid(),
    organisation_id    uuid        not null references organisation (id) on delete cascade,
    full_name          text        not null,
    phone_e164         text        not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    phone_alt_e164     text        check (phone_alt_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    email              text,
    preferred_language text        default 'en',
    whatsapp_opt_in    boolean     not null default false,
    do_not_contact     boolean     not null default false,
    source_import_id   uuid        references import_batch (id),
    deleted_at         timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (organisation_id, phone_e164)
);
create index contact_org_name_idx on contact (organisation_id, full_name);


-- =============================================================================
-- STAGE 2 — Engagement core. Department-agnostic; everything writes here.
-- =============================================================================

create table campaign (
    id               uuid primary key default gen_random_uuid(),
    organisation_id  uuid        not null references organisation (id) on delete cascade,
    name             text        not null,
    dept             department  not null,
    campaign_type    text        not null,   -- see docs section 3, Layer 3
    agent_ref        text,                   -- Jobix agent / flow identifier
    script_version   text,
    schedule_cron    text,                   -- null for inbound handlers
    status           text        not null default 'draft'
                     check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
    created_at       timestamptz not null default now()
);
create index campaign_org_status_idx on campaign (organisation_id, status);

create table campaign_member (
    id               uuid primary key default gen_random_uuid(),
    campaign_id      uuid        not null references campaign (id) on delete cascade,
    contact_id       uuid        not null references contact (id) on delete cascade,
    -- polymorphic subject: which account / tenancy / lead / job this targets
    subject_type     text        check (subject_type in ('account', 'tenancy', 'lead', 'job', 'application')),
    subject_id       uuid,
    state            text        not null default 'queued'
                     check (state in ('queued', 'in_progress', 'reached', 'exhausted',
                                      'suppressed', 'completed', 'failed')),
    attempts         smallint    not null default 0,
    next_attempt_at  timestamptz,
    created_at       timestamptz not null default now(),
    unique (campaign_id, contact_id, subject_id)
);
create index campaign_member_due_idx on campaign_member (next_attempt_at)
    where state in ('queued', 'in_progress');

-- One row per interaction, ANY channel. See data model 1.1.
create table conversation (
    id                  uuid primary key default gen_random_uuid(),
    organisation_id     uuid        not null references organisation (id) on delete cascade,
    contact_id          uuid        not null references contact (id) on delete cascade,
    campaign_id         uuid        references campaign (id) on delete set null,
    campaign_member_id  uuid        references campaign_member (id) on delete set null,
    chan                channel     not null,
    dir                 direction   not null,
    started_at          timestamptz not null default now(),
    ended_at            timestamptz,
    duration_seconds    integer,
    external_ref        text,                  -- Jobix call id / Meta conversation id
    external_source     text,                  -- 'jobix', 'meta_whatsapp', ...
    recording_url       text,
    transcript          text,                  -- move to object storage once long
    cost_cents          integer     not null default 0,
    created_at          timestamptz not null default now(),
    unique (external_source, external_ref)
);
create index conversation_contact_idx  on conversation (contact_id, started_at desc);
create index conversation_campaign_idx on conversation (campaign_id, started_at desc);
create index conversation_org_time_idx on conversation (organisation_id, started_at desc);

create table whatsapp_template (
    id                uuid primary key default gen_random_uuid(),
    organisation_id   uuid        not null references organisation (id) on delete cascade,
    name              text        not null,
    meta_template_id  text,
    category          text,                    -- UTILITY / MARKETING / AUTHENTICATION
    language          text        not null default 'en',
    body              text        not null,
    approval_status   text        not null default 'pending'
                      check (approval_status in ('pending', 'approved', 'rejected', 'paused')),
    created_at        timestamptz not null default now(),
    unique (organisation_id, name, language)
);

create table message (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid        not null references conversation (id) on delete cascade,
    dir              direction   not null,
    body             text,
    media_url        text,
    media_type       text,
    template_id      uuid        references whatsapp_template (id),
    external_ref     text,                   -- wa message id; idempotency for webhook replay
    status           text        not null default 'queued'
                     check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
    sent_at          timestamptz,
    delivered_at     timestamptz,
    read_at          timestamptz,
    failure_reason   text,
    created_at       timestamptz not null default now(),
    unique (external_ref)
);
create index message_conversation_idx on message (conversation_id, created_at);

-- Structured interpretation, separate from the transcript. See data model 1.5.
create table outcome (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid        not null references conversation (id) on delete cascade,
    outcome_code     text        not null
                     check (outcome_code in (
                        'reached', 'no_answer', 'voicemail', 'wrong_number', 'invalid_number',
                        'refused', 'promised_to_pay', 'already_paid', 'disputed',
                        'callback_requested', 'hung_up', 'language_barrier',
                        'renewal_accepted', 'renewal_declined', 'vacating',
                        'viewing_booked', 'not_interested',
                        'fault_logged', 'contractor_confirmed', 'issue_unresolved',
                        'escalate_human', 'other')),
    sentiment        text        check (sentiment in ('positive', 'neutral', 'negative')),
    confidence       numeric(3,2) check (confidence between 0 and 1),
    summary          text,
    src              text        not null default 'analyser'
                     check (src in ('analyser', 'platform', 'human')),
    analyser_version text,
    created_at       timestamptz not null default now()
);
create index outcome_conversation_idx on outcome (conversation_id);
create index outcome_code_idx on outcome (outcome_code, created_at desc);

create table follow_up_task (
    id               uuid primary key default gen_random_uuid(),
    organisation_id  uuid        not null references organisation (id) on delete cascade,
    conversation_id  uuid        references conversation (id) on delete set null,
    dept             department  not null,
    assigned_to      uuid        references app_user (id),
    reason           text        not null,
    priority         smallint    not null default 3 check (priority between 1 and 5),
    due_at           timestamptz,
    status           text        not null default 'open'
                     check (status in ('open', 'in_progress', 'done', 'cancelled')),
    created_at       timestamptz not null default now()
);
create index follow_up_open_idx on follow_up_task (organisation_id, dept, due_at)
    where status in ('open', 'in_progress');


-- =============================================================================
-- STAGE 3 — Tenancy financials and promises to pay
-- =============================================================================

create table tenancy (
    id                  uuid primary key default gen_random_uuid(),
    organisation_id     uuid        not null references organisation (id) on delete cascade,
    unit_id             uuid        not null references unit (id) on delete cascade,
    primary_contact_id  uuid        not null references contact (id),
    start_date          date        not null,
    end_date            date,
    monthly_rent_cents  bigint,
    deposit_held_cents  bigint,
    status              tenancy_status not null default 'active',
    external_ref        text,
    created_at          timestamptz not null default now()
);
create index tenancy_expiry_idx on tenancy (end_date) where status = 'active';
create index tenancy_contact_idx on tenancy (primary_contact_id);

create table account (
    id                    uuid primary key default gen_random_uuid(),
    organisation_id       uuid        not null references organisation (id) on delete cascade,
    tenancy_id            uuid        not null references tenancy (id) on delete cascade,
    account_ref           text,
    balance_total_cents   bigint      not null default 0,
    current_cents         bigint      not null default 0,
    days_30_cents         bigint      not null default 0,
    days_60_cents         bigint      not null default 0,
    days_90_cents         bigint      not null default 0,
    days_120_plus_cents   bigint      not null default 0,
    last_payment_date     date,
    last_payment_cents    bigint,
    months_in_arrears     smallint,
    as_at                 date        not null,
    source_import_id      uuid        references import_batch (id),
    updated_at            timestamptz not null default now(),
    unique (tenancy_id)
);
create index account_arrears_idx on account (organisation_id, balance_total_cents desc);

-- History, so arrears movement over time survives the next import.
create table account_snapshot (
    id                   uuid primary key default gen_random_uuid(),
    account_id           uuid        not null references account (id) on delete cascade,
    balance_total_cents  bigint      not null,
    current_cents        bigint      not null default 0,
    days_30_cents        bigint      not null default 0,
    days_60_cents        bigint      not null default 0,
    days_90_cents        bigint      not null default 0,
    days_120_plus_cents  bigint      not null default 0,
    as_at                date        not null,
    source_import_id     uuid        references import_batch (id),
    created_at           timestamptz not null default now(),
    unique (account_id, as_at)
);

create table payment (
    id           uuid primary key default gen_random_uuid(),
    account_id   uuid        not null references account (id) on delete cascade,
    amount_cents bigint      not null check (amount_cents > 0),
    paid_on      date        not null,
    reference    text,
    src          text        not null default 'import'
                 check (src in ('import', 'bank_feed', 'manual', 'payment_link')),
    external_ref text,
    created_at   timestamptz not null default now(),
    unique (external_ref)
);
create index payment_account_idx on payment (account_id, paid_on desc);

-- The money table. A promise, and whether it held. See data model 1.4.
create table ptp (
    id                    uuid primary key default gen_random_uuid(),
    organisation_id       uuid        not null references organisation (id) on delete cascade,
    account_id            uuid        not null references account (id) on delete cascade,
    conversation_id       uuid        references conversation (id) on delete set null,
    promised_amount_cents bigint      not null check (promised_amount_cents > 0),
    promised_date         date        not null,
    payment_method        text        check (payment_method in ('eft', 'debit_order', 'cash',
                                                               'card', 'payment_link', 'other')),
    status                ptp_status  not null default 'open',
    amount_received_cents bigint      not null default 0,
    verified_at           timestamptz,
    verified_payment_id   uuid        references payment (id),
    notes                 text,
    created_at            timestamptz not null default now()
);
create index ptp_due_idx on ptp (promised_date) where status = 'open';
create index ptp_account_idx on ptp (account_id, created_at desc);

create table arrangement (
    id                     uuid primary key default gen_random_uuid(),
    account_id             uuid        not null references account (id) on delete cascade,
    conversation_id        uuid        references conversation (id) on delete set null,
    instalment_amount_cents bigint     not null check (instalment_amount_cents > 0),
    instalment_count       smallint    not null check (instalment_count > 0),
    frequency              text        not null default 'monthly'
                           check (frequency in ('weekly', 'fortnightly', 'monthly')),
    first_due              date        not null,
    status                 text        not null default 'active'
                           check (status in ('active', 'completed', 'defaulted', 'cancelled')),
    created_at             timestamptz not null default now()
);

create table dispute (
    id          uuid primary key default gen_random_uuid(),
    account_id  uuid        not null references account (id) on delete cascade,
    raised_on   date        not null default current_date,
    reason      text,
    status      text        not null default 'open'
                check (status in ('open', 'investigating', 'upheld', 'rejected', 'resolved')),
    resolved_on date,
    created_at  timestamptz not null default now()
);
create index dispute_open_idx on dispute (account_id) where status <> 'resolved';


-- =============================================================================
-- STAGE 4 — Consent, suppression, webhook plumbing (prerequisites for WhatsApp)
-- =============================================================================

-- Append-only. POPIA evidence of consent basis per channel.
create table consent_log (
    id           uuid primary key default gen_random_uuid(),
    contact_id   uuid        not null references contact (id) on delete cascade,
    chan         channel     not null,
    action       text        not null check (action in ('opt_in', 'opt_out')),
    basis        text        check (basis in ('contract', 'legitimate_interest',
                                             'explicit_consent', 'legal_obligation')),
    src          text,                       -- 'form', 'voice_call', 'whatsapp_reply', 'manual'
    evidence_ref text,                       -- conversation or submission id
    occurred_at  timestamptz not null default now()
);
create index consent_contact_idx on consent_log (contact_id, chan, occurred_at desc);

-- Checked immediately before every dispatch, never at list-build time. See 1.3.
create table suppression (
    id           uuid primary key default gen_random_uuid(),
    contact_id   uuid        not null references contact (id) on delete cascade,
    reason       text        not null
                 check (reason in ('opted_out', 'handed_to_legal', 'disputed', 'deceased',
                                   'frequency_cap', 'manual_hold', 'invalid_number')),
    dept         department,                 -- null = all departments
    active_from  timestamptz not null default now(),
    active_until timestamptz,                -- null = indefinite
    created_by   uuid        references app_user (id),
    notes        text,
    created_at   timestamptz not null default now()
);
-- No partial predicate here: now() is not IMMUTABLE, so it cannot appear in an
-- index predicate. Callers filter on (active_until is null or active_until > now()).
create index suppression_active_idx on suppression (contact_id, active_until);

create table webhook_event (
    id               uuid primary key default gen_random_uuid(),
    src              text        not null,   -- 'jobix', 'meta_whatsapp', 'speed_to_lead'
    event_type       text,
    idempotency_key  text        not null,
    payload          jsonb       not null,
    received_at      timestamptz not null default now(),
    processed_at     timestamptz,
    process_error    text,
    unique (src, idempotency_key)
);
create index webhook_unprocessed_idx on webhook_event (received_at) where processed_at is null;

create table audit_log (
    id            uuid primary key default gen_random_uuid(),
    actor_user_id uuid        references app_user (id),
    entity_type   text        not null,
    entity_id     uuid,
    action        text        not null,
    before        jsonb,
    after         jsonb,
    occurred_at   timestamptz not null default now()
);
create index audit_entity_idx on audit_log (entity_type, entity_id, occurred_at desc);


-- =============================================================================
-- STAGE 5 — Leasing
-- =============================================================================

create table lead (
    id               uuid primary key default gen_random_uuid(),
    organisation_id  uuid        not null references organisation (id) on delete cascade,
    contact_id       uuid        not null references contact (id) on delete cascade,
    src              text        not null
                     check (src in ('property24', 'private_property', 'website', 'walk_in',
                                    'whatsapp', 'referral', 'phone', 'other')),
    unit_interest_id uuid        references unit (id),
    building_interest_id uuid    references building (id),
    budget_max_cents bigint,
    move_in_date     date,
    bedrooms_wanted  smallint,
    status           text        not null default 'new'
                     check (status in ('new', 'contacted', 'qualified', 'viewing_booked',
                                       'applied', 'approved', 'leased', 'lost', 'unreachable')),
    lost_reason      text,
    received_at      timestamptz not null default now(),
    first_contact_at timestamptz,             -- speed-to-lead numerator; see docs 4
    assigned_to      uuid        references app_user (id),
    created_at       timestamptz not null default now()
);
create index lead_uncontacted_idx on lead (received_at) where first_contact_at is null;
create index lead_org_status_idx on lead (organisation_id, status);

create table viewing (
    id            uuid primary key default gen_random_uuid(),
    lead_id       uuid        not null references lead (id) on delete cascade,
    unit_id       uuid        not null references unit (id) on delete cascade,
    scheduled_at  timestamptz not null,
    attended      boolean,
    outcome       text        check (outcome in ('interested', 'not_interested',
                                                 'applied', 'no_show', 'cancelled')),
    agent_user_id uuid        references app_user (id),
    created_at    timestamptz not null default now()
);
create index viewing_upcoming_idx on viewing (scheduled_at) where attended is null;

create table application (
    id                     uuid primary key default gen_random_uuid(),
    lead_id                uuid        not null references lead (id) on delete cascade,
    unit_id                uuid        not null references unit (id),
    status                 text        not null default 'submitted'
                           check (status in ('submitted', 'awaiting_documents', 'under_review',
                                            'approved', 'declined', 'withdrawn')),
    credit_check_status    text        check (credit_check_status in ('pending', 'pass', 'fail', 'referred')),
    affordability_verified boolean     not null default false,
    decision               text,
    decided_on             date,
    created_at             timestamptz not null default now()
);
create index application_awaiting_idx on application (status) where status = 'awaiting_documents';

-- Drives the WhatsApp document chase.
create table document_request (
    id             uuid primary key default gen_random_uuid(),
    application_id uuid        references application (id) on delete cascade,
    tenancy_id     uuid        references tenancy (id) on delete cascade,
    doc_type       text        not null
                   check (doc_type in ('fica_id', 'payslip_1', 'payslip_2', 'payslip_3',
                                       'bank_statement', 'proof_of_address',
                                       'employment_letter', 'prev_landlord_ref', 'other')),
    status         text        not null default 'requested'
                   check (status in ('requested', 'received', 'rejected', 'waived')),
    requested_at   timestamptz not null default now(),
    received_at    timestamptz,
    media_url      text,
    chase_count    smallint    not null default 0,
    last_chased_at timestamptz,
    reject_reason  text,
    check (application_id is not null or tenancy_id is not null)
);
create index doc_request_outstanding_idx on document_request (requested_at) where status = 'requested';

create table renewal (
    id              uuid primary key default gen_random_uuid(),
    tenancy_id      uuid        not null references tenancy (id) on delete cascade,
    expiry_date     date        not null,
    offer_rent_cents bigint,
    escalation_pct  numeric(5,2),
    status          text        not null default 'not_started'
                    check (status in ('not_started', 'contacted', 'negotiating', 'accepted',
                                      'declined', 'vacating', 'no_response')),
    decided_on      date,
    new_tenancy_id  uuid        references tenancy (id),
    created_at      timestamptz not null default now(),
    unique (tenancy_id, expiry_date)
);
create index renewal_pipeline_idx on renewal (expiry_date) where status <> 'accepted';


-- =============================================================================
-- STAGE 6 — Operations and maintenance
-- =============================================================================

create table contractor (
    id               uuid primary key default gen_random_uuid(),
    organisation_id  uuid        not null references organisation (id) on delete cascade,
    name             text        not null,
    trades           text[]      not null default '{}',
    phone_e164       text        check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    email            text,
    rating           numeric(2,1) check (rating between 1 and 5),
    active           boolean     not null default true,
    created_at       timestamptz not null default now()
);

create table job (
    id                    uuid primary key default gen_random_uuid(),
    organisation_id       uuid        not null references organisation (id) on delete cascade,
    unit_id               uuid        references unit (id) on delete set null,
    building_id           uuid        references building (id) on delete set null,
    reported_by_contact_id uuid       references contact (id) on delete set null,
    logged_conversation_id uuid       references conversation (id) on delete set null,
    category              text        not null
                          check (category in ('plumbing', 'electrical', 'geyser', 'roof_leak',
                                              'appliance', 'locks_keys', 'common_area', 'pest',
                                              'gate_intercom', 'other')),
    priority              job_priority not null default 'routine',
    description           text        not null,
    status                text        not null default 'logged'
                          check (status in ('logged', 'assigned', 'in_progress', 'awaiting_parts',
                                            'completed', 'verified', 'closed', 'cancelled')),
    logged_at             timestamptz not null default now(),
    sla_due_at            timestamptz,
    closed_at             timestamptz,
    check (unit_id is not null or building_id is not null)
);
create index job_open_idx on job (organisation_id, priority, logged_at)
    where status not in ('closed', 'cancelled');
create index job_unit_category_idx on job (unit_id, category, logged_at desc);

create table job_media (
    id                uuid primary key default gen_random_uuid(),
    job_id            uuid        not null references job (id) on delete cascade,
    media_url         text        not null,
    media_type        text,
    source_message_id uuid        references message (id),
    created_at        timestamptz not null default now()
);

create table job_assignment (
    id            uuid primary key default gen_random_uuid(),
    job_id        uuid        not null references job (id) on delete cascade,
    contractor_id uuid        not null references contractor (id),
    dispatched_at timestamptz not null default now(),
    accepted_at   timestamptz,
    declined_at   timestamptz,
    scheduled_for timestamptz,
    arrived_at    timestamptz,
    completed_at  timestamptz,
    cost_cents    bigint,
    created_at    timestamptz not null default now()
);
create index job_assignment_job_idx on job_assignment (job_id, dispatched_at desc);

create table job_verification (
    id                 uuid primary key default gen_random_uuid(),
    job_id             uuid        not null references job (id) on delete cascade,
    conversation_id    uuid        references conversation (id) on delete set null,
    contractor_arrived boolean,
    issue_resolved     boolean,
    satisfaction_score smallint    check (satisfaction_score between 1 and 5),
    comment            text,
    created_at         timestamptz not null default now()
);

create table compliance_item (
    id                        uuid primary key default gen_random_uuid(),
    building_id               uuid        not null references building (id) on delete cascade,
    item_type                 text        not null
                              check (item_type in ('electrical_coc', 'gas_coc', 'fire_equipment',
                                                   'gate_motor', 'lift', 'water_certificate',
                                                   'beetle_certificate', 'other')),
    last_completed            date,
    next_due                  date        not null,
    responsible_contractor_id uuid        references contractor (id),
    notes                     text,
    created_at                timestamptz not null default now()
);
create index compliance_due_idx on compliance_item (next_due);


-- =============================================================================
-- STAGE 7 — Integration state
-- =============================================================================

create table integration_sync (
    id               uuid primary key default gen_random_uuid(),
    organisation_id  uuid        not null references organisation (id) on delete cascade,
    system           text        not null,   -- 'mda' | 'payprop' | 'mri' | 'weconnectu' | 'property24'
    entity           text        not null,   -- 'age_analysis' | 'lease_expiry' | 'jobs' | 'leads'
    last_synced_at   timestamptz,
    cursor           text,
    last_error       text,
    unique (organisation_id, system, entity)
);


-- =============================================================================
-- Row-level security
--
-- Enable on every organisation-scoped table from day one. Retrofitting after
-- two clients' data are mixed is a migration nobody wants (docs section 6).
-- The policy below assumes Supabase auth: auth.uid() maps to app_user.id.
-- =============================================================================

-- Example for one table; replicate for every table carrying organisation_id.
alter table contact enable row level security;

create policy contact_org_isolation on contact
    using (
        organisation_id in (
            select m.organisation_id
            from org_membership m
            join app_user u on u.id = m.app_user_id
            where u.id = auth.uid()
        )
    );


-- =============================================================================
-- Dashboard metric views
--
-- Materialised; refresh on a schedule. Do not aggregate live over conversation
-- (it grows fastest and the dashboard must stay quick).
-- =============================================================================

-- Collections headline: PTP kept percentage, the number nobody else measures.
create materialized view mv_collections_ptp as
select
    p.organisation_id,
    date_trunc('month', p.created_at)                          as period,
    count(*)                                                   as ptps_created,
    count(*) filter (where p.promised_date < current_date)     as ptps_due,
    count(*) filter (where p.status = 'kept')                  as ptps_kept,
    count(*) filter (where p.status = 'broken')                as ptps_broken,
    round(100.0 * count(*) filter (where p.status = 'kept')
          / nullif(count(*) filter (where p.promised_date < current_date), 0), 1)
                                                               as ptp_kept_pct,
    sum(p.promised_amount_cents)                               as promised_cents,
    sum(p.amount_received_cents)                               as recovered_cents
from ptp p
group by 1, 2;

-- Leasing headline: speed to lead.
create materialized view mv_leasing_speed as
select
    l.organisation_id,
    date_trunc('week', l.received_at)                          as period,
    l.src,
    count(*)                                                   as leads,
    count(*) filter (where l.first_contact_at is not null)     as contacted,
    percentile_cont(0.5) within group (
        order by extract(epoch from (l.first_contact_at - l.received_at))
    )                                                          as median_seconds_to_contact,
    count(*) filter (where l.status = 'viewing_booked')        as viewings_booked,
    count(*) filter (where l.status = 'leased')                as leased
from lead l
group by 1, 2, 3;

-- Operations headline: open job ageing and emergencies.
create materialized view mv_ops_open_jobs as
select
    j.organisation_id,
    j.building_id,
    count(*)                                                    as open_jobs,
    count(*) filter (where j.priority = 'emergency')            as emergencies,
    count(*) filter (where now() - j.logged_at <= interval '1 day')   as age_0_1_days,
    count(*) filter (where now() - j.logged_at >  interval '1 day'
                       and now() - j.logged_at <= interval '3 days')  as age_2_3_days,
    count(*) filter (where now() - j.logged_at >  interval '3 days'
                       and now() - j.logged_at <= interval '7 days')  as age_4_7_days,
    count(*) filter (where now() - j.logged_at >  interval '7 days')  as age_8_plus_days
from job j
where j.status not in ('closed', 'cancelled')
group by 1, 2;
