-- =============================================================================
-- Smoke test / worked example for db/schema.sql
--
-- Inserts one realistic journey per department and checks the headline metrics
-- compute. Doubles as documentation of how the tables hang together.
--
--   psql -v ON_ERROR_STOP=1 -d <db> -f db/schema.sql -f db/smoke_test.sql
--
-- Safe to run on a throwaway database only — it writes data.
-- =============================================================================

begin;

-- --- Stage 1: organisation, access, property, people ------------------------

insert into organisation (id, name, slug)
values ('00000000-0000-0000-0000-0000000000a1', 'Mafadi Property Management', 'mafadi');

insert into app_user (id, email, full_name, is_internal)
values ('00000000-0000-0000-0000-0000000000b1', 'hakeem@aiployee.co.za', 'Hakeem Shaik', true);

insert into org_membership (organisation_id, app_user_id, role)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'owner');

insert into import_batch (id, organisation_id, filename, detected_format, rows_in, rows_clean, rows_rejected, uploaded_by)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
        'Mafadi_Arrears_28Jul2026.xlsx', 'E', 412, 398, 14,
        '00000000-0000-0000-0000-0000000000b1');

insert into import_reject (import_batch_id, row_number, reason, raw_data)
values ('00000000-0000-0000-0000-0000000000c1', 87, 'unusable phone',
        '{"contact": "n/a", "balance": "1250.00"}');

insert into building (id, organisation_id, code, name, region)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
        'HILL01', 'Hillbrow Heights', 'Johannesburg');

insert into unit (id, building_id, unit_number, door_no, unit_type, bedrooms, market_rent_cents, status)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1',
        '204', '204', 'Flat', 2, 780000, 'occupied'),
       ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1',
        '311', '311', 'Flat', 1, 620000, 'vacant');

insert into contact (id, organisation_id, full_name, phone_e164, email, whatsapp_opt_in, source_import_id)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1',
        'Thandi Nkosi', '+27821234567', 'thandi@example.co.za', true,
        '00000000-0000-0000-0000-0000000000c1'),
       ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1',
        'Sipho Dlamini', '+27837654321', null, true, null);

-- Dedup guard: the same human must not land twice (data model 1.2).
do $$
begin
    insert into contact (organisation_id, full_name, phone_e164)
    values ('00000000-0000-0000-0000-0000000000a1', 'T Nkosi', '+27821234567');
    raise exception 'FAIL: duplicate phone was accepted';
exception when unique_violation then
    raise notice 'PASS: contact dedup on phone_e164 enforced';
end $$;

-- E.164 guard: local-format numbers must never enter.
do $$
begin
    insert into contact (organisation_id, full_name, phone_e164)
    values ('00000000-0000-0000-0000-0000000000a1', 'Bad Number', '0821112222');
    raise exception 'FAIL: non-E.164 phone was accepted';
exception when check_violation then
    raise notice 'PASS: E.164 format constraint enforced';
end $$;

-- --- Stage 3: tenancy, account, arrears ------------------------------------

insert into tenancy (id, organisation_id, unit_id, primary_contact_id, start_date, end_date,
                     monthly_rent_cents, deposit_held_cents, status)
values ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1',
        '2024-09-01', '2026-08-31', 780000, 780000, 'active');

insert into account (id, organisation_id, tenancy_id, account_ref, balance_total_cents,
                     current_cents, days_30_cents, days_60_cents, months_in_arrears, as_at,
                     source_import_id)
values ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000101', 'HILL01-204', 1560000,
        780000, 780000, 0, 2, '2026-07-28', '00000000-0000-0000-0000-0000000000c1');

insert into account_snapshot (account_id, balance_total_cents, days_30_cents, as_at)
values ('00000000-0000-0000-0000-000000000111', 2340000, 780000, '2026-06-30'),
       ('00000000-0000-0000-0000-000000000111', 1560000, 780000, '2026-07-28');

-- --- Stage 2: the engagement journey, across channels ----------------------
-- WhatsApp reminder -> unanswered call -> inbound callback where the PTP lands.
-- All three are rows in ONE conversation table (data model 1.1).

insert into campaign (id, organisation_id, name, dept, campaign_type, agent_ref, status)
values ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-0000000000a1',
        'July arrears — PTP negotiation', 'collections',
        'collections_ptp_negotiation', 'jobix:siya', 'active');

insert into campaign_member (id, campaign_id, contact_id, subject_type, subject_id, state, attempts)
values ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000121',
        '00000000-0000-0000-0000-0000000000f1', 'account',
        '00000000-0000-0000-0000-000000000111', 'reached', 2);

insert into conversation (id, organisation_id, contact_id, campaign_id, campaign_member_id,
                          chan, dir, started_at, ended_at, duration_seconds,
                          external_source, external_ref, cost_cents)
values -- touch 1: WhatsApp reminder, read but not answered
       ('00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000121',
        '00000000-0000-0000-0000-000000000131', 'whatsapp', 'outbound',
        '2026-07-20 08:00+02', '2026-07-20 08:00+02', null, 'meta_whatsapp', 'wamid.AAA1', 12),
       -- touch 2: outbound call, no answer
       ('00000000-0000-0000-0000-000000000142', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000121',
        '00000000-0000-0000-0000-000000000131', 'voice_out', 'outbound',
        '2026-07-22 10:15+02', '2026-07-22 10:15:28+02', 28, 'jobix', 'call_7f31a', 95),
       -- touch 3: tenant calls back, PTP agreed
       ('00000000-0000-0000-0000-000000000143', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000121',
        '00000000-0000-0000-0000-000000000131', 'voice_in', 'inbound',
        '2026-07-22 16:40+02', '2026-07-22 16:44:10+02', 250, 'jobix', 'call_7f42b', 410);

insert into message (conversation_id, dir, body, external_ref, status, sent_at, read_at)
values ('00000000-0000-0000-0000-000000000141', 'outbound',
        'Good day Thandi, your Hillbrow Heights account is R15 600 in arrears. Reply to arrange payment.',
        'wamid.AAA1', 'read', '2026-07-20 08:00+02', '2026-07-20 09:12+02');

insert into outcome (conversation_id, outcome_code, sentiment, confidence, summary, src, analyser_version)
values ('00000000-0000-0000-0000-000000000142', 'no_answer', null, 0.99,
        'Rang out, no voicemail.', 'platform', null),
       ('00000000-0000-0000-0000-000000000143', 'reached', 'neutral', 0.94,
        'Tenant confirmed short payment due to reduced hours; agreed R7 800 on 2026-07-25.',
        'analyser', 'v2.1'),
       ('00000000-0000-0000-0000-000000000143', 'promised_to_pay', 'neutral', 0.91,
        'PTP captured: R7 800 by EFT on 2026-07-25.', 'analyser', 'v2.1');

-- --- Stage 3: the promise, and verification against a real payment ---------

insert into ptp (id, organisation_id, account_id, conversation_id, promised_amount_cents,
                 promised_date, payment_method, status)
values ('00000000-0000-0000-0000-000000000151', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000143',
        780000, '2026-07-25', 'eft', 'open'),
       -- a second promise that was never honoured
       ('00000000-0000-0000-0000-000000000152', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-000000000111', null,
        390000, '2026-07-10', 'eft', 'broken');

insert into payment (id, account_id, amount_cents, paid_on, reference, src, external_ref)
values ('00000000-0000-0000-0000-000000000161', '00000000-0000-0000-0000-000000000111',
        780000, '2026-07-25', 'HILL01-204 JUL', 'bank_feed', 'bnk_99201');

-- Verification is a data operation, never a self-report (data model 1.4).
update ptp p
set status                = 'kept',
    amount_received_cents = pay.amount_cents,
    verified_at           = now(),
    verified_payment_id   = pay.id
from payment pay
where p.id = '00000000-0000-0000-0000-000000000151'
  and pay.account_id = p.account_id
  and pay.paid_on between p.promised_date - interval '2 days' and p.promised_date + interval '3 days'
  and pay.amount_cents >= p.promised_amount_cents;

-- --- Stage 4: consent and suppression -------------------------------------

insert into consent_log (contact_id, chan, action, basis, src, evidence_ref)
values ('00000000-0000-0000-0000-0000000000f1', 'whatsapp', 'opt_in', 'contract',
        'form', '00000000-0000-0000-0000-000000000143');

insert into suppression (contact_id, reason, dept, active_until, notes)
values ('00000000-0000-0000-0000-0000000000f2', 'handed_to_legal', 'collections', null,
        'Handed to attorneys 2026-07-15 — no collections contact.');

insert into webhook_event (src, event_type, idempotency_key, payload)
values ('jobix', 'call.completed', 'call_7f42b', '{"call_id": "call_7f42b", "duration": 250}');

-- Webhook replay must be a no-op, not a duplicate (data model section 6).
do $$
begin
    insert into webhook_event (src, event_type, idempotency_key, payload)
    values ('jobix', 'call.completed', 'call_7f42b', '{"call_id": "call_7f42b"}');
    raise exception 'FAIL: duplicate webhook was accepted';
exception when unique_violation then
    raise notice 'PASS: webhook idempotency enforced';
end $$;

-- --- Stage 5: leasing ------------------------------------------------------

insert into lead (id, organisation_id, contact_id, src, unit_interest_id, budget_max_cents,
                  move_in_date, bedrooms_wanted, status, received_at, first_contact_at)
values ('00000000-0000-0000-0000-000000000171', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000f2', 'property24',
        '00000000-0000-0000-0000-0000000000e2', 650000, '2026-09-01', 1, 'viewing_booked',
        '2026-07-27 09:00:00+02', '2026-07-27 09:00:47+02');  -- 47 seconds to first contact

insert into viewing (lead_id, unit_id, scheduled_at, attended, outcome)
values ('00000000-0000-0000-0000-000000000171', '00000000-0000-0000-0000-0000000000e2',
        '2026-07-29 15:00+02', null, null);

insert into application (id, lead_id, unit_id, status)
values ('00000000-0000-0000-0000-000000000181', '00000000-0000-0000-0000-000000000171',
        '00000000-0000-0000-0000-0000000000e2', 'awaiting_documents');

insert into document_request (application_id, doc_type, status, received_at, chase_count)
values ('00000000-0000-0000-0000-000000000181', 'fica_id',        'received', now(), 0),
       ('00000000-0000-0000-0000-000000000181', 'payslip_1',      'received', now(), 1),
       ('00000000-0000-0000-0000-000000000181', 'bank_statement', 'requested', null, 2),
       ('00000000-0000-0000-0000-000000000181', 'proof_of_address','requested', null, 1);

insert into renewal (tenancy_id, expiry_date, offer_rent_cents, escalation_pct, status)
values ('00000000-0000-0000-0000-000000000101', '2026-08-31', 826800, 6.00, 'contacted');

-- A document request must belong to an application or a tenancy, not neither.
do $$
begin
    insert into document_request (doc_type, status) values ('fica_id', 'requested');
    raise exception 'FAIL: orphan document_request was accepted';
exception when check_violation then
    raise notice 'PASS: document_request parent constraint enforced';
end $$;

-- --- Stage 6: operations ---------------------------------------------------

insert into contractor (id, organisation_id, name, trades, phone_e164, rating)
values ('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-0000000000a1',
        'Ace Plumbing CC', '{plumbing,geyser}', '+27825550001', 4.2);

insert into job (id, organisation_id, unit_id, building_id, reported_by_contact_id,
                 logged_conversation_id, category, priority, description, status,
                 logged_at, sla_due_at)
values ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000f1', null,
        'geyser', 'emergency', 'Geyser burst, water through ceiling of unit below.',
        'assigned', now() - interval '5 hours', now() + interval '1 hour');

insert into job_assignment (job_id, contractor_id, dispatched_at, accepted_at, scheduled_for, arrived_at)
values ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000191',
        now() - interval '4 hours', now() - interval '3 hours',
        now() - interval '1 hour', now() - interval '50 minutes');

insert into job_verification (job_id, contractor_arrived, issue_resolved, satisfaction_score, comment)
values ('00000000-0000-0000-0000-0000000001a1', true, false, 4,
        'Contractor on site, awaiting replacement geyser.');

insert into compliance_item (building_id, item_type, last_completed, next_due, responsible_contractor_id)
values ('00000000-0000-0000-0000-0000000000d1', 'fire_equipment', '2025-09-01', '2026-09-01', null),
       ('00000000-0000-0000-0000-0000000000d1', 'electrical_coc', '2024-03-15', '2026-03-15',
        '00000000-0000-0000-0000-000000000191');

-- --- Metrics ---------------------------------------------------------------

refresh materialized view mv_collections_ptp;
refresh materialized view mv_leasing_speed;
refresh materialized view mv_ops_open_jobs;

\echo ''
\echo '=== Collections: PTP kept % ==='
select period::date, ptps_created, ptps_due, ptps_kept, ptps_broken, ptp_kept_pct,
       promised_cents / 100 as promised_rand, recovered_cents / 100 as recovered_rand
from mv_collections_ptp;

\echo ''
\echo '=== Leasing: speed to lead ==='
select period::date, src, leads, contacted,
       round(median_seconds_to_contact) as median_secs_to_contact, viewings_booked
from mv_leasing_speed;

\echo ''
\echo '=== Operations: open jobs ==='
select open_jobs, emergencies, age_0_1_days, age_2_3_days, age_4_7_days, age_8_plus_days
from mv_ops_open_jobs;

\echo ''
\echo '=== Cross-channel journey for one contact (the point of one conversation table) ==='
select c.started_at, c.chan, c.dir, c.duration_seconds, c.cost_cents,
       string_agg(o.outcome_code, ', ' order by o.outcome_code) as outcomes
from conversation c
left join outcome o on o.conversation_id = c.id
where c.contact_id = '00000000-0000-0000-0000-0000000000f1'
group by c.id, c.started_at, c.chan, c.dir, c.duration_seconds, c.cost_cents
order by c.started_at;

\echo ''
\echo '=== Documents outstanding (drives the WhatsApp chase) ==='
select doc_type, status, chase_count
from document_request
where status = 'requested'
order by chase_count desc;

\echo ''
\echo '=== Dispatch-time suppression check (run before EVERY contact) ==='
select ct.full_name,
       ct.phone_e164,
       coalesce(s.reason, 'clear') as status
from contact ct
left join suppression s
       on s.contact_id = ct.id
      and (s.dept = 'collections' or s.dept is null)
      and s.active_from <= now()
      and (s.active_until is null or s.active_until > now())
where ct.organisation_id = '00000000-0000-0000-0000-0000000000a1'
  and ct.do_not_contact = false
  and ct.deleted_at is null
order by ct.full_name;

rollback;  -- smoke test leaves no data behind
