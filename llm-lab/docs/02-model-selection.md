# 02 — Model selection for a 32 GB CPU node

> **Model availability moves fast.** The reasoning in this document is durable;
> the specific model names have a shelf life of months. Before you download,
> check what's current — but check it against the *criteria* below, not against
> a leaderboard, because leaderboards rank quality and you are optimising a
> quality-per-byte-read ratio that almost nobody publishes.

## The one metric that matters: active bytes per token

From the README: `tokens/sec ≈ memory_bandwidth / active_bytes_per_token`.

On a GPU, everyone optimises for total VRAM footprint. On CPU, what you care
about is how many bytes must be read from RAM to produce **one token**. For a
dense model that's the whole weight file. For a Mixture-of-Experts (MoE) model
it's only the shared layers plus the handful of experts the router selects —
often a fifth or a tenth of the total.

This changes the answer completely:

| Model shape | Total params | Active/token | Q4 file | Bytes read/token | Est. decode @60 GB/s |
|---|---|---|---|---|---|
| Dense 8B | 8B | 8B | ~4.7 GB | ~4.7 GB | ~13 tok/s ceiling |
| Dense 14B | 14B | 14B | ~8.5 GB | ~8.5 GB | ~7 tok/s ceiling |
| Dense 24B | 24B | 24B | ~14 GB | ~14 GB | ~4 tok/s ceiling |
| Dense 32B | 32B | 32B | ~19 GB | ~19 GB | ~3 tok/s ceiling |
| **MoE 30B-A3B** | **30B** | **~3B** | **~18 GB** | **~2 GB** | **~30 tok/s ceiling** |
| **MoE 20B-A3.6B** | **21B** | **~3.6B** | **~12 GB** | **~2.4 GB** | **~25 tok/s ceiling** |

Those are theoretical ceilings — real throughput lands at roughly 40–60% of
them once you account for attention, sampling, and the fact that MoE routing is
not perfectly cache-friendly. But the *ratio* holds, and it's the whole game:
**an MoE model gives you the quality of its total parameter count at the speed
of its active parameter count.** A 30B MoE beats a dense 14B on both quality
*and* speed simultaneously. That is not a trade-off you normally get to make.

The catch: MoE needs the **full** weight file resident in RAM, because the
router can pick any expert on any token. You can't page it. So 32 GB of RAM is
what buys you the right to run a 30B MoE at all.

## Recommended tiers

Install two tiers and route between them at the gateway. Most requests don't
need your best model, and the ones that do can afford to wait.

### Tier 1 — "workhorse": MoE, ~30B total / ~3B active, Q4_K_M

Runs on pve-2/3/4 (three replicas). ~18 GB file, ~26 GB resident with KV cache.

Current best candidates:
- **`Qwen3-30B-A3B`** (`Qwen/Qwen3-30B-A3B-Instruct` GGUF, Q4_K_M) — the
  strongest CPU-inference pick available. Strong instruction following, good
  structured/JSON output, 32k+ native context, and hybrid reasoning you can
  toggle per-request.
- **`gpt-oss-20b`** — OpenAI's open-weight MoE, ~3.6B active. Ships natively in
  MXFP4 at ~12 GB, so it's lighter and leaves more KV headroom. Good tool-calling.

Use for: transcript analysis and scoring, anything needing judgement, summaries
that a human will read, and as the reference model when you're evaluating
whether a smaller model is good enough.

### Tier 2 — "fast": dense 1.7B–4B, Q4_K_M or Q5_K_M

Runs on pve-5 with a high parallel-slot count (`-np 8` or more). ~2–3 GB file,
so many concurrent slots fit easily.

Current candidates: **`Qwen3-4B-Instruct`**, **`Gemma 3 4B`**,
**`Llama 3.2 3B`**, **`Qwen3-1.7B`** (when you need it even faster).

Use for: classification, routing, yes/no decisions, name and phone
normalisation, single-field extraction, guardrail checks — the bulk work. This
tier will do 80% of your request volume at 10x the speed of the workhorse.
It is also the only tier with any chance at live voice (see doc 03).

### Tier 3 — embeddings and reranking (CPU forever)

- Embeddings: **`bge-m3`** (multilingual, good for mixed English/Afrikaans),
  or `all-MiniLM-L6-v2` when speed beats quality.
- Reranker: **`bge-reranker-v2-m3`**.

These are 300M–600M parameters, run at hundreds of items/sec on CPU, and should
never be given GPU RAM. Keep them on pve-5 permanently.

## Quantisation: pick Q4_K_M, and know when not to

| Quant | Bits/weight | Quality vs FP16 | Verdict |
|---|---|---|---|
| Q8_0 | 8.5 | Essentially lossless | Wasteful — 2x the bytes read for no visible gain |
| Q6_K | 6.6 | Very close | Use if you have RAM to burn and quality is critical |
| **Q5_K_M** | 5.7 | Slight, rarely noticeable | Good choice for the small fast model where the file is tiny anyway |
| **Q4_K_M** | 4.8 | Small but real degradation | **Default. Best quality-per-byte on CPU.** |
| Q3_K_M | 3.9 | Noticeable | Avoid for structured output — see below |
| Q2_K | 3.4 | Severe | Don't |

The failure mode that catches people out: at Q3 and below, models start
**breaking JSON schema adherence** and drifting on instruction following long
before they start producing obviously bad prose. So a quick "does it still sound
fine?" test passes while your extraction pipeline silently starts emitting
malformed records. If your workload is structured extraction — and most of the
bulk work here is — stay at Q4_K_M or above, and validate with a schema check on
every response regardless.

Also prefer **`-K_M` variants over legacy `Q4_0`/`Q4_1`**: the K-quants place
more bits where the model is sensitive, and are strictly better at the same size.
If you see `IQ` quants (importance-matrix), those are better still at equal size
but need a matching imatrix file — a fine optimisation once the basics work.

## Context length: shorter than you think

Long context is *expensive twice* on CPU: KV cache eats RAM, and prefill is
compute-bound so a long prompt costs real seconds before the first token appears.

- Set `-c` to what you actually need, not to the model's maximum. A 32k context
  when your prompts are 4k wastes GB of KV allocation.
- For transcript work, measure your real transcripts. A 10-minute collections
  call is roughly 1,500–2,500 tokens. 8k of context handles it with room for
  instructions and few-shot examples.
- Use `--cache-type-k q8_0 --cache-type-v q8_0` to halve KV cache memory at
  negligible quality cost. This is one of the highest-value flags on CPU.
- If you need to process a 100k-token document, chunk it and map-reduce rather
  than buying context. On CPU, ten 10k prefills are cheaper and more parallel
  than one 100k prefill.

## Speculative decoding: a free ~1.5–2x, sometimes

`llama.cpp` supports a draft model: a tiny model proposes several tokens, the
big model verifies them in one batched pass. When the draft is right you get
multiple tokens for roughly the cost of one.

Pair a model with a much smaller sibling from the same family and tokeniser:
`Qwen3-30B-A3B` drafted by `Qwen3-0.6B`, for instance. Enable with `-md
<draft.gguf> --draft-max 16 --draft-min 4`.

Two caveats. It only helps for **predictable** text — boilerplate, structured
output, code — where the draft's guesses land. On genuinely uncertain
generation, acceptance rates fall and you pay for the draft without the benefit.
And it costs RAM for the second model. Benchmark it on your actual prompts:
`bench/run-suite.sh --spec` runs the comparison.

## Fine-tuning: probably don't, and here's the cheaper thing to do first

The instinct with a home cluster is to fine-tune a small model on your own data.
Resist it for now:

- **You cannot train on these nodes.** Even a LoRA on a 4B model wants a GPU
  with 16–24 GB VRAM. CPU fine-tuning is technically possible and practically
  useless — days per run. Training happens on rented GPU time or after you buy
  one; the cluster is for *inference*.
- **The gains you want are usually available without it.** Most "the model
  doesn't do what I want" problems are prompt problems, few-shot problems, or
  schema-enforcement problems. Grammar-constrained decoding (`--grammar` or a
  JSON schema in the request) forces valid structured output far more reliably
  than fine-tuning does.
- **A fine-tune freezes your model choice.** Base models improve every few
  months. A tuned 4B from six months ago is often worse than today's untuned 4B.

The order of operations that actually pays: constrain output with a schema →
add few-shot examples from your real data → build an eval set and measure →
only then consider a LoRA, and only on the specific narrow task where
measurement shows prompting has plateaued.

Building that eval set is where this cluster shines — see doc 05. Free unlimited
inference is exactly what a good eval loop needs.

## Where to get weights

GGUF files for `llama.cpp` come from Hugging Face. Prefer the model author's own
GGUF repo where one exists; otherwise the well-known community quantisers
(`unsloth`, `bartowski`, `ggml-org`) are reliable and publish the full quant
range per model.

`inference/models.env` is the registry — one place to change a model ID or quant
so every node and script stays in sync. Edit that file, not the scripts.
