# 10 — Automation ideas

Ideas oriented around your actual business — voice agents, collections, imports,
reports — rather than generic homelab fun. That's `docs/09`.

## What a 16 GB node changes

The 30B MoE is an 18 GB file and does not fit. `models.env` now carries a 16 GB
tier (auto-selected when a node has under 24 GB), defaulting to **Qwen3-8B at
Q4_K_M** — about 5 GB, comfortable, plenty of KV room. `gpt-oss-20b` in MXFP4
(~12 GB, MoE with ~3.6B active) is the more ambitious option and keeps the MoE
speed advantage, but it's tight: short context, few slots, and watch resident
size under load. Both are in `models.env`; benchmark before committing.

The strategic consequence matters more than the model name:

> **On 16 GB, stop thinking "can it write me an essay" and start thinking
> "can it classify, extract, validate, and route."**

That's a happy accident, because those small-model tasks are where the actual
ROI lives. Nobody's business is bottlenecked on prose generation. Plenty are
bottlenecked on someone manually checking a spreadsheet.

---

## Tier 1 — pays for the hardware

### 1. Import data-quality watchdog

**The best idea on this page.** Before a campaign runs, scan the import for the
problems that waste calls: malformed or impossible phone numbers, duplicate
debtors under slightly different names, amounts that can't be right (negative
arrears, arrears exceeding total balance), missing unit references, dead email
domains.

Every bad row is a call that costs money and returns nothing. Catching 30 bad
rows in a 500-row import before dialling is direct, measurable savings — and
most of the checks are deterministic Python, with the model only handling the
fuzzy parts (is "J Smith" and "John Smith" at unit 12B the same person?).

Ships in this repo: `llm-lab/workloads/import_audit.py`.

### 2. Watched-folder import builder

You already run the Mafadi and Ripple import skills by hand. Automate the
mechanical half: a client drops a raw age-analysis file in a folder, and a
cleaned, validated import file comes out the other side with an audit report
attached.

Keep a human approving the *output*, not doing the *work*. That's the right
division for anything that ends in a phone call to a real person.

### 3. Nightly transcript scoring

Cron the batch runner over yesterday's calls: outcome, reached-debtor,
PTP amount and date, dispute reason, claims-paid. Overnight, free, and the
figures are on your desk before anyone asks.

`workloads/batch_extract.py` with `examples/score_call.txt` already does this.
The automation is a systemd timer and somewhere to put the results.

### 4. Speed-to-Lead first response

A form submission is the one place where *speed* is the product. Route it to the
4B fast model: classify intent, pull the matching context, draft a first
response in seconds. A human sends it; the model just removes the blank page.

This is the one automation on the list where latency matters, so it belongs on
the fast lane, never the workhorse.

---

## Tier 2 — real time savings

### 5. Daily ops digest

One message each morning: campaigns run, contact and PTP rates, failed jobs,
node temperatures and tokens/sec, disks filling up. Assembled from data you
already have, written into a paragraph a human can read in ten seconds.

### 6. Email triage with drafted replies

Classify incoming mail (needs reply / FYI / invoice / dispute / noise), and for
the ones needing a reply, draft it. Nothing sends automatically. The win is
eliminating "I'll deal with that later", not writing the email.

### 7. Weekly client report first drafts

Your Mafadi report format is well-defined and the figures come from data. Let
the model assemble the first draft overnight; you edit and verify. Verifying a
draft is a different, much smaller job than writing one.

### 8. Prompt regression watchdog

Run the scenario bank nightly against a pinned prompt, diff against yesterday,
and alert only on changes. A prompt edit that quietly breaks dispute handling
surfaces at breakfast rather than on a live call.

### 9. Document QA for staff

Point Timy at your SOPs, policies and scripts, put it in WhatsApp or Slack, and
let agents ask "what's our policy when they claim they already paid?" instead of
interrupting someone. Retrieval plus a small model handles this well — it's a
lookup task, not a reasoning task.

---

## Tier 3 — worth doing once things are stable

### 10. Lease and contract clause extraction

Body-corporate documents into structured fields: levy escalation dates, penalty
clauses, notice periods. Slow per document, but it's a folder and it can run all
weekend.

### 11. Auto-updating knowledge base

New SOP lands in a folder → embedded and available to Timy within the hour, no
manual reload.

### 12. Log anomaly summariser

Nightly pass over the cluster's logs: "what's different about today?" Small
model, tiny prompts, catches the slow degradation that no threshold alert is
configured for.

---

## The pattern that makes these safe

Every automation above follows the same shape, and it's worth being explicit
because it's what keeps a small local model from causing damage:

1. **Deterministic code does the deterministic work.** Phone formatting, date
   parsing, arithmetic, deduplication by exact key. Never ask a model to do
   something `str.replace` can do correctly every time.
2. **The model handles only the genuinely fuzzy part** — is this a dispute or a
   refusal, are these two names the same person, what is this document about.
3. **Every model output is schema-validated**, and failures go to a queue rather
   than into your data.
4. **A human approves anything that reaches a customer.** Draft, don't send.
   Flag, don't delete. Suggest, don't dial.

A 4B model that classifies 500 rows and flags 30 for review is worth far more
than a 30B model that writes beautiful prose nobody reads.

---

## Where to start

**Idea 1**, this week. It's built, it runs on a 16 GB node comfortably, and
unlike everything else on this page it saves money on the very first run
rather than after you've integrated it into a workflow.
