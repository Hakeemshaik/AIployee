# 09 — Weekend projects

Things worth building on this cluster, chosen for what CPU inference is
genuinely good at. The rule that sorts good ideas from bad ones here:

> **Free and patient, not fast.** Anything that can run overnight, in bulk, or
> on a folder of files is a great fit. Anything a human is waiting on is not.

Embeddings are the underrated part — a 300M-parameter encoder runs at hundreds
of items/sec on CPU, so anything search-shaped is essentially free.

---

## 1. Model arena — find out which model is actually best *for you*

**Effort: an evening. Payoff: high.**

Leaderboards rank models on other people's tasks. Run your own prompts through
three models, rate the answers **blind**, and get a win-rate table. The result
decides which model earns the RAM on your workhorse nodes — a question you
otherwise answer by vibes.

Ships in this repo: `llm-lab/workloads/arena.py`.

```bash
python3 workloads/arena.py --base-url http://192.168.1.201:4000 --api-key sk-... \
    --models workhorse,fast --prompts my-prompts.txt
```

Why it suits CPU: generation happens up front in batch, then you rate at your
own pace. Nothing is waiting on the model.

---

## 2. Semantic search over everything you own

**Effort: a weekend. Payoff: the one you'll use daily.**

Point the embedding model at your documents, emails, transcripts, notes — then
search by *meaning* instead of keywords. "That thing about the levy dispute
where they claimed they'd already paid" finds the right file.

Timy's `knowledge/` already does this for a folder; the project is widening the
net (Drive exports, mailbox archives, past reports) and adding a search box.

Why it suits CPU: embeddings are cheap and it's a one-off indexing job that can
run overnight. Re-indexing only touches changed files.

---

## 3. Local transcription pipeline

**Effort: an evening. Payoff: high, and adjacent to your day job.**

`whisper.cpp` on the fast node. Drop audio in a watched folder → get a
transcript, a summary, and action items out. Voice notes, meeting recordings,
call audio that must never leave the building.

```bash
# On the fast-lane node
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build -DGGML_NATIVE=ON && cmake --build build -j
./models/download-ggml-model.sh small
```

Then a systemd path unit watching a directory, piping the transcript into the
gateway for summarisation. Genuinely satisfying, and the POPIA story writes
itself.

---

## 4. Overnight inbox digest

**Effort: an evening. Payoff: daily.**

At 3am, summarise yesterday's mail into one briefing: what needs a reply, what's
just noise, what has a deadline. Ready before you are.

Why it suits CPU: nobody is waiting at 3am. This is the archetypal local-LLM job
— 200 emails at 8 seconds each is 27 minutes of a machine that's otherwise idle.

---

## 5. Nightly prompt regression runs

**Effort: half a day. Payoff: compounding.**

You already have scenario banks for your voice agents. Run the full suite every
night against the local model and diff it against yesterday. A prompt edit that
breaks dispute handling shows up at breakfast instead of on a live call.

Use the local model as a **filter**, not a verdict — it isn't the production
model. Cheap regression signal locally, confirmation hosted. Covered in
`docs/05-operations.md`.

---

## 6. "Ask my cluster"

**Effort: an evening. Payoff: moderate, but very satisfying.**

Give Timy read-only tools over your own infrastructure: `pct list`, node
temperatures, tokens/sec, disk usage. Then ask *"which node is running hot?"* or
*"why did throughput drop last night?"* in English.

Nicely self-referential — the cluster explaining itself — and a gentle
introduction to tool-calling without any risk, since every tool is read-only.

---

## 7. Document → structured data sandbox

**Effort: a weekend. Payoff: directly commercial.**

Drop in a PDF statement, invoice, or age-analysis sheet; get validated JSON out.
`workloads/batch_extract.py` already does the batch half with schema validation
and a retry queue — the project is a drop-zone UI and a per-document-type schema
library.

This is the closest thing here to a product feature rather than a toy.

---

## 8. A game master that remembers

**Effort: an evening. Payoff: pure fun, and a real test.**

A text adventure or D&D DM in Timy, with the world state kept in a file the
model reads and updates. Genuinely fun — and it is the best character-consistency
test you will ever run, because you notice a persona drifting far faster when
you're enjoying yourself than when you're grading extraction accuracy.

---

## 9. Screenshot and photo indexer

**Effort: a weekend. Payoff: moderate.**

A small vision model (Gemma 3 4B or Qwen2.5-VL 3B, both GGUF) captioning and
OCR-ing your screenshot folder in bulk, into the semantic index from project 2.
Slow per image on CPU — but it's a folder, and it can run all night.

---

## 10. A WhatsApp or Slack front end for Timy

**Effort: an evening. Payoff: high adoption.**

Timy already speaks a clean HTTP API. Putting it behind a chat app your team
already has open is what turns it from "a thing on a URL" into something people
actually use.

Watch the latency here — this is the one project on the list where a human *is*
waiting, so route it to the fast model, not the workhorse.

---

## Things that will disappoint you

Being straight about these saves a wasted Saturday:

- **Image generation.** Stable Diffusion on CPU is roughly a minute per image at
  low resolution. Technically possible, not fun.
- **Live voice.** The arithmetic is in `docs/03`. 1–2 concurrent calls, laggy.
  Wait for the GPU.
- **Anything with a big context window.** A 100k-token prompt is minutes of
  prefill. Chunk and map-reduce instead.
- **Fine-tuning.** Needs a GPU. And prompting plus a schema usually gets you
  there anyway — `docs/02` has the order of operations.
- **Coding assistants on the workhorse.** You'll feel every one of those 15
  tok/s against a hosted model. The 4B on the fast lane is fine for
  autocomplete-shaped work.

---

## If you only do one

**Project 1 (arena), then project 2 (semantic search).**

The arena takes an evening and settles which model deserves your RAM — every
later project inherits that decision. Semantic search is the one you'll open
every day, and it runs on the part of the cluster that's practically free.
