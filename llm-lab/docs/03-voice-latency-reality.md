# 03 — Live voice on CPU: the honest arithmetic

You asked for a live voice agent brain on this cluster. Here is the real
budget, so you can make the call with numbers instead of vibes.

## The target

Human conversation tolerates roughly **800 ms** between "caller stops talking"
and "agent starts talking". Past ~1.2 s people start talking over the agent or
assume the line dropped. On collections calls — where the caller is already
inclined to hang up — the tolerance is at the tight end of that range.

That 800 ms has to cover **four** stages, and they are serial:

```
caller stops ──▶ [1] end-of-turn detection
                     └─▶ [2] STT finalise
                             └─▶ [3] LLM time-to-first-token
                                     └─▶ [4] TTS time-to-first-audio ──▶ audio out
```

## Stage-by-stage budget, CPU-only i7

Estimates, to be replaced by your own measurements — `make voice-check` does
this against real timings from `make bench`.

| Stage | Realistic on CPU | Notes |
|---|---|---|
| 1. End-of-turn detection | **150–300 ms** | Silero VAD is cheap. But a fixed silence threshold this short causes false triggers mid-sentence; semantic turn detection is better and costs more. This is a floor you cannot optimise away — it's waiting, by design. |
| 2. STT finalise | **150–400 ms** | Streaming `whisper.cpp` (small/distil) or Parakeet transcribes as the caller speaks, so only the tail needs finalising. Multi-threaded, and it competes with the LLM for the same cores. |
| 3. LLM TTFT | **300 ms – 40 s** ⚠️ | The entire problem. See below. |
| 4. TTS first audio | **80–200 ms** | Piper is genuinely fast on CPU (real-time factor well under 0.1) and streams. Kokoro sounds better and costs a bit more. This stage is fine. |

Stages 1, 2 and 4 sum to roughly **400–900 ms** before the LLM does anything at
all. Which means **the LLM's entire budget is 0–400 ms**, and on a bad day
there is no budget left.

## Why stage 3 spans two orders of magnitude

Two different costs, and people conflate them constantly:

**Prefill (prompt processing)** — reading the input. Compute-bound, parallelises
well across cores. Call it 100–400 tok/s for a small model on an i7.

**Decode (generation)** — producing output. Memory-bandwidth-bound, does not
parallelise. This is the `tokens/sec` from doc 02.

TTFT is dominated by *prefill*. And a voice agent's prompt is not small — a
collections agent carries a system prompt with policy, tone rules, dispute
handling, payment-arrangement rules, plus the debtor's account context and the
conversation so far. Call it **2,000 tokens on turn one, growing every turn**.

At 200 tok/s prefill, 2,000 tokens is **10 seconds**. The call is already lost.

### Prefix caching is what makes it possible at all

The saving grace: that 2,000-token prefix is **identical on every turn**.
`llama-server` can keep the KV cache for a prefix and reuse it, so turn two only
prefills the tokens that are actually new — the caller's last utterance, maybe
40 tokens.

40 tokens at 200 tok/s = **200 ms**. Suddenly it fits.

This requires, non-negotiably:
- `--slot-save-path` and a dedicated slot per active call, so the cache survives
  between turns.
- `--cache-reuse N` so partial prefix matches are exploited.
- A **stable prompt prefix**. Put anything that changes — timestamps, the
  conversation transcript, retrieved context — at the *end* of the prompt. One
  varying token near the start invalidates the entire cache behind it and you're
  back to a 10-second prefill.
- Enough RAM to hold one full KV cache per concurrent call, simultaneously.

That last constraint is what caps concurrency, and it's why the answer is
"1–2 calls per node" rather than "as many as you like".

### And the first turn is always slow

Cache reuse can't help turn one — there's nothing cached yet. So the agent's
opening line takes the full prefill hit. Mitigation: **pre-warm** the slot with
the static system prompt before the call connects (while it's ringing), and
hard-code the greeting rather than generating it. Both are in the checklist
below.

## Verdict

**Best case, tuned, 4B model, warm cache, one call per node:**
`250 (VAD) + 250 (STT) + 300 (LLM) + 120 (TTS)` ≈ **920 ms**. Marginal — noticeably
slow but survivable.

**Realistic case:** 1.2–2.0 s per turn, degrading as the conversation grows.
That reads as a laggy agent, and on collections calls lag costs you contact
outcomes.

**Workhorse (30B MoE) instead of 4B:** add 1–3 s. Not viable for live calls.

So, plainly:

- ❌ **Don't move production collections calls onto CPU inference.** The latency
  isn't there, concurrency is 1–2 calls per node against a hosted model's
  effectively unlimited, and the quality drop from a 4B model on a nuanced
  collections conversation is the kind that loses payment arrangements. The
  economics don't work either: 4 nodes to maybe 6 concurrent calls, versus an
  API bill that's small relative to the outcome value of a single call.

- ✅ **Do build the fully-local voice pipeline anyway**, capped at 1–2 calls, for:
  - Learning where the real bottlenecks are — the measurements will surprise you.
  - Demos where "no audio ever leaves your building" is the selling point. This
    is a genuine commercial differentiator for POPIA-sensitive prospects, and
    worth having a working demo of.
  - A fallback path if a hosted provider has an outage.
  - Being ready the day the GPU arrives, because then this becomes viable and
    everything except the model server is already built and tuned.

- ✅ **Do move the non-live voice work onto the cluster now.** Post-call
  transcript analysis, outcome verification, PTP scoring, redial-list
  construction — all batch, all latency-insensitive, all currently costing you
  hosted tokens. That's the win available today.

## If you build it: the checklist

1. **Model:** Tier 2 only. 4B maximum, and test 1.7B — on a tightly scripted
   collections flow the quality gap may be smaller than the latency gap matters.
2. **Dedicate the node.** One `llama-server` per voice node, `-np` equal to your
   max concurrent calls, nothing else running on it. STT and TTS on a *different*
   node, or you'll have three processes fighting for the same memory bandwidth
   at exactly the moment latency matters.
3. **Pin cores.** STT/TTS and the LLM must not share cores. Explicit
   `CPUAffinity` in both systemd units.
4. **Engineer the prompt for cache stability.** Static policy first, dynamic
   context last. Treat the prefix as an API — changing it mid-deployment costs
   you every warm cache.
5. **Pre-warm on ring.** Load the system prompt into a slot when the call starts
   ringing, not when it connects.
6. **Hard-code the greeting.** Never generate turn one.
7. **Cap output length.** `max_tokens` around 60–80. Long agent turns are bad
   conversation design anyway, and on CPU every token is ~40–80 ms of wall clock.
8. **Stream into TTS sentence-by-sentence.** Don't wait for the full completion —
   send the first sentence to Piper the moment it's complete. This hides most of
   the decode time and is the single biggest perceived-latency win available.
9. **Measure with `make voice-check`, on real prompts,** including turn 5 and
   turn 10 — not just turn one, where everything looks fine.
10. **Keep a hosted fallback wired in** at the gateway, with a hard timeout. If
    local TTFT exceeds ~400 ms, fail over mid-call. Better a cloud token than
    dead air.

## What changes with a GPU

Everything, for this specific workload. Prefill goes to thousands of tok/s, so
even a cold 2,000-token prompt is ~200 ms. Decode on a 24 GB card runs an 8B
model at 60–100 tok/s. TTFT lands comfortably under 200 ms and concurrency goes
to 8–16 calls on one card.

Live voice on your own hardware is a **GPU project**, not a CPU project. The CPU
cluster's job is to be the thing around it — see doc 04.
