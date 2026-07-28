# Departmental Automation Programme — Leasing, Collections, Operations

**Prepared for:** Mafadi Property Management
**Prepared by:** AIployee
**Date:** 28 July 2026
**Status:** Proposal for discussion

---

## 1. Where we are today

The collections voice agent is live. It calls tenants in arrears, negotiates and
captures promises to pay, and every campaign is followed by a call-analysis
report showing what was said, what was agreed, and where the book stands.

Mafadi has asked whether the same approach can be applied to the other
departments — leasing, collections beyond the first call, and operations — with
automation, voice, WhatsApp and dashboards across all of them.

It can. This document sets out what that means concretely, in what order, and
what Mafadi needs to supply for each stage to work.

---

## 2. What the four capabilities actually mean

To avoid ambiguity later, here is how we use these four words throughout this
document.

| Capability | What it means in practice |
| --- | --- |
| **Automation** | The work between conversations. Pull the list from Mafadi's system, decide who should be contacted and when, log every outcome, trigger the next step. Today this is done manually per campaign; it becomes scheduled and rule-driven. |
| **Voice** | AI voice agents on the phone, in both directions. Today we run **outbound** only. **Inbound** — a number tenants and prospects can call and get handled without waiting for a human — is a significant part of what follows. |
| **WhatsApp** | The channel that reaches the 60–70% of people who do not answer a phone call, and the only practical way to move **documents and photographs**. FICA paperwork, payslips, proof of payment, photographs of a leaking geyser. |
| **Dashboards** | Mafadi's managers logging in and seeing live numbers for their own department, rather than waiting for a report from us. |

Every workflow below is one of two shapes: an **outbound campaign** (we have a
list, we contact it, we record outcomes) or an **inbound intake** (something
arrives, we respond within seconds and capture it properly). The collections
agent already proves the first shape works.

---

## 3. Department by department

### 3.1 Collections — deepen what already exists

The current campaign is a single pass: call the arrears list, capture a promise
to pay, report. The value left on the table is in everything that happens
*after* that promise.

**The contact ladder**

| Stage | Timing | Channel | Purpose |
| --- | --- | --- | --- |
| Pre-due reminder | 3 days before due date | WhatsApp | Prevent the arrear entirely |
| Soft reminder | Day 1–3 overdue | WhatsApp, voice on no-read | Assume oversight, not distress |
| First call | Day 7 | Voice | Establish contact, understand the reason |
| PTP negotiation | Day 15 | Voice | Agree amount, date and method |
| **PTP verification** | **On the promised date** | **Voice / WhatsApp** | **Did the payment arrive? If not, why?** |
| Pre-legal notice | Day 45–60 | Voice + email | Final warning before handover |

The **PTP verification** step is the single biggest gap in most collections
operations, including this one. A promise that is never checked is not a
collection. Once every promise is automatically verified against the payment
data, Mafadi gets a number almost nobody in the industry measures: **PTP kept
percentage** — the true predictor of which arrears will actually be recovered
and which need to go legal.

**Inbound settlement line.** A tenant who received a call and wants to settle
currently has to reach a human during office hours. An inbound agent lets them
call back at any time, hear their balance, agree a payment arrangement and
receive the banking details or a payment link by WhatsApp immediately.

**Also in scope:** deposit refunds and final accounts on vacate, which generate
a predictable volume of queries that are almost entirely scripted.

### 3.2 Leasing — the highest-value department

Leasing is where automation moves revenue rather than recovers it. Two flows.

**Inbound: speed to lead.** A prospect enquires on Property24, Private Property
or the Mafadi website. The agent calls them back **within sixty seconds**,
qualifies them on budget, move-in date, unit type and affordability, and books
a viewing into the letting agent's diary. In residential rentals the first
agency to make contact wins the tenant far more often than the one with the
better unit. Response time is the product.

The form-to-callback mechanism for this is already built and running on our
Speed to Lead platform — it needs the property portals feeding into it.

**Outbound campaigns.**

| Campaign | Trigger | Why it matters |
| --- | --- | --- |
| **Lease renewals** | 90, 60 and 30 days before expiry | A renewed lease costs a fraction of a new tenant. Same campaign shape as collections — different script, different list. |
| **Document chasing** | Application submitted, documents outstanding | FICA identity documents, three months' payslips, bank statements, proof of address. This is the real bottleneck between an approved applicant and a signed lease, and it is almost entirely WhatsApp work. |
| **Viewing no-show follow-up** | Viewing time passes unattended | Recovers prospects who would otherwise be written off. |
| **Vacancy waitlist activation** | Unit becomes available | Contacts previously qualified prospects who wanted that building or unit type. |

**Where the value shows up:** days-to-let per unit, renewal rate, and the
proportion of applications that stall waiting on paperwork.

### 3.3 Operations and maintenance — inbound first

Operations is where tenant satisfaction is won or lost, and where the work is
mostly reactive.

**Inbound fault logging.** A tenant reports a problem by phone or WhatsApp. The
agent triages it — genuine emergency (burst pipe, no electricity, security
failure) versus routine — captures the unit, the description and a photograph,
logs the job, and dispatches to the right contractor by trade. Photographs are
the reason WhatsApp is not optional here: a burst geyser cannot be described
accurately over the phone, but a picture settles it in one message.

**The follow-ups nobody has time for.**

- Contractor dispatch and acceptance confirmation
- *Did the contractor actually arrive?* — verification call to the tenant on the scheduled day
- *Is it fixed?* — satisfaction check before the job is closed
- Compliance scheduling: electrical certificates of compliance, fire equipment
  servicing, gate motors, lifts
- Meter reading reminders

**Where the value shows up:** open jobs by age, emergencies outstanding,
contractor SLA compliance, and repeat faults per unit — which is how you find
the building that needs capital expenditure rather than another call-out.

---

## 4. Delivery plan

### Phase 1 — Use what already exists (4–6 weeks)

No new technology. Existing voice platform, existing data pipeline, existing
reporting.

- Collections contact ladder built out, including PTP verification
- Lease renewal campaign live
- Inbound maintenance logging live on a dedicated number
- Inbound settlement line for collections
- Reporting per department, delivered as it is today

**Deliverable at the end of Phase 1:** three departments running live
campaigns, with outcomes recorded per contact.

### Phase 2 — WhatsApp across all three (4 weeks)

- WhatsApp Business number, verification and message template approval
- No-answer fallback: every unanswered call is followed by a WhatsApp message
- Document collection for leasing applications and renewals
- Photograph intake for maintenance jobs
- Payment links and banking details for collections
- Appointment confirmations and reminders for viewings and contractor visits

**Note on lead time:** Meta business verification and WhatsApp template approval
take between several days and several weeks and are outside our control. We
will begin this application at the start of Phase 1 so it does not delay
delivery.

### Phase 3 — Unified dashboard (6–8 weeks)

One platform, one login, three departmental views. Every call, message,
promise, lead and job written to a single database, with live metrics per
department:

- **Collections:** book value, contact rate, PTP rate, PTP kept percentage, rand promised, rand recovered, cost per rand recovered
- **Leasing:** leads by source, median time to first contact, viewings booked and attended, application completion rate, days vacant
- **Operations:** open jobs by age, emergencies outstanding, contractor SLA, repeat faults per building

Managers see their own numbers in real time. Reporting stops being a document
that arrives after the fact.

---

## 5. What we need from Mafadi

These are prerequisites, not preferences. Each one blocks the work it sits next to.

| # | Requirement | Why | Needed by |
| --- | --- | --- | --- |
| 1 | **Confirmation of the property management system in use** (MDA, MRI, Payprop, WeConnectU, Red Rabbit or other) | Determines whether data can be scheduled or must be exported by hand | Before Phase 1 |
| 2 | **Scheduled data exports** — arrears age analysis, lease expiry schedule, applicant pipeline, maintenance job register | Every campaign needs a list. Collections has one; leasing and operations must have one too | Phase 1 start |
| 3 | **Payment data** — daily or weekly receipts per account | PTP verification must check against actual payments, not self-reported promises | Phase 1, week 2 |
| 4 | **One named process owner per department** | Someone to approve scripts, receive escalations and make decisions. Three departments with no owners will stall | Before Phase 1 |
| 5 | **Decision on telephone numbers** — whose numbers are used for inbound and outbound, and the WhatsApp number | Numbers must be provisioned and verified before anything can go live | Before Phase 1 |
| 6 | **Property portal access or lead forwarding** | Speed-to-lead only works if portal enquiries reach us in seconds | Phase 1, leasing |
| 7 | **Contractor list with trades and contact numbers** | Required for maintenance dispatch | Phase 1, operations |
| 8 | **POPIA position confirmed** — consent basis for contacting tenants by voice and WhatsApp, and call recording disclosure | Compliance sits with Mafadi as the responsible party; we build to whatever position is confirmed | Before Phase 1 |

**A frank note on requirement 2.** If a department's working list lives in
individual agents' heads, spreadsheets on desktops, or an email inbox, that
department cannot be automated yet. It is better to establish this in week one
than in month two. Where a list does not exist, the first piece of work is
creating it, and we will say so.

---

## 6. Scope discipline

We recommend against starting all three departments at full breadth
simultaneously. For each department, Phase 1 begins with **one workflow carrying
one measurable number**:

| Department | First workflow | The number |
| --- | --- | --- |
| Collections | PTP verification and recovery | PTP kept percentage, rand recovered |
| Leasing | Lease renewal campaign | Renewal rate, cost per renewal versus cost per new let |
| Operations | Inbound fault logging and arrival verification | Time to log, contractor SLA compliance |

Once each is demonstrably working, breadth is added inside that department. This
keeps every phase independently measurable and independently valuable — if
Mafadi chooses to stop after any phase, what has been delivered still stands on
its own.

---

## 7. Commercial

> **To be completed before issue.** Structure below; figures to be inserted.

| Item | Basis | Amount |
| --- | --- | --- |
| Phase 1 — build and launch | Once-off | *TBC* |
| Phase 2 — WhatsApp integration | Once-off | *TBC* |
| Phase 3 — dashboard platform | Once-off | *TBC* |
| Ongoing platform and management | Monthly retainer | *TBC* |
| Voice minutes and WhatsApp messages | Usage, at cost | *TBC* |

Usage costs are passed through at cost and shown transparently on the dashboard,
so Mafadi can see cost per rand recovered and cost per lead contacted directly
against the results.

---

## 8. Recommended next step

A ninety-minute working session with one representative from each of the three
departments, to:

1. Confirm the property management system and what can be exported from it
2. Choose the first workflow per department from section 6
3. Name the process owner per department
4. Agree the numbers to be used and start the WhatsApp verification application

Phase 1 can begin within a week of that session, because it requires no
technology that is not already in place.

---

*AIployee — hakeem@aiployee.co.za*
