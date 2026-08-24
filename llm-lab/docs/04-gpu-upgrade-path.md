# 04 — GPU upgrade path

You said a GPU is coming and you'll share the spec. This doc is the decision
framework so that when you do, the choice is quick — and so you don't buy the
wrong thing.

## The problem nobody mentions: mini PCs have no x16 slot

This is the constraint that shapes everything. A desktop GPU needs a PCIe x16
slot, 250–450 W of power, and 30+ cm of physical space. A mini PC has none of
those. So "put a GPU in the lab" is really three different projects:

### Option A — OCuLink / Thunderbolt eGPU on an existing mini PC

Many recent mini PCs expose PCIe over **OCuLink** (typically x4) or
**Thunderbolt 4/USB4** (x4 equivalent, with more protocol overhead).

- ✅ Reuses a node you already own. Cheapest path to a working GPU.
- ✅ **PCIe x4 is fine for inference.** Weights are loaded once at startup; after
  that the bus carries only tokens. A model load takes maybe 20 s instead of 6 s.
  Nobody cares. (This *is* a real constraint for training, and for
  multi-GPU tensor parallelism — neither of which you're doing.)
- ⚠️ Needs an external GPU dock and its own PSU. Cabling is untidy and the
  whole assembly is fragile in a way rack gear isn't.
- ⚠️ **PCIe passthrough into a Proxmox VM over Thunderbolt is genuinely
  finicky** — hotplug semantics, IOMMU group placement, and reset behaviour all
  fight you. OCuLink behaves much better because it's plain PCIe. If your minis
  have OCuLink, use it. If they only have Thunderbolt, consider running the GPU
  workload on the bare-metal PVE host instead of in a guest, or accept a
  weekend of IOMMU debugging.
- **Check before buying:** does the specific mini PC model have OCuLink? Most
  don't. Look for it explicitly in the spec sheet.

### Option B — one dedicated tower node (recommended)

Buy or build a single tower/4U box with a real x16 slot, a 750 W+ PSU, and
airflow. Join it to the existing Proxmox cluster as node 7.

- ✅ **Correct long-term shape.** Room for a second GPU later, proper cooling,
  clean PCIe passthrough, standard everything.
- ✅ The six minis keep doing what they're genuinely good at (below), so nothing
  you build now is wasted.
- ✅ You can put a lot more RAM in it, which matters for hybrid CPU+GPU offload
  when a model doesn't quite fit in VRAM.
- ⚠️ Costs a whole machine on top of the card.

This is the recommendation. The minis are excellent at being many small
independent workers; they are bad at hosting a GPU. Don't fight the hardware.

### Option C — rent GPU time instead

Worth stating explicitly: if the GPU is for *training* or occasional heavy
batch work rather than always-on serving, rented hourly GPU time is
dramatically cheaper than owning. Own a GPU when you need it **resident and
always available** — which live voice does, and fine-tuning does not.

A reasonable split: rent for training runs, own one card for live serving.

## Choosing the card: VRAM first, everything else second

For inference, ranked by what actually determines what you can run:

1. **VRAM capacity** — this is a hard wall. A model that doesn't fit either
   spills to CPU (and runs at CPU speed, wiping out the GPU) or doesn't load.
2. **Memory bandwidth** — same physics as doc 02, just with a much bigger
   number. This sets your tokens/sec.
3. **Compute (TFLOPs)** — sets prefill speed, which is what fixes the voice
   TTFT problem from doc 03.
4. **Ecosystem** — CUDA is the path of least resistance. ROCm works and has
   improved a lot, but you'll hit more rough edges. Intel Arc via SYCL/IPEX
   works for `llama.cpp` but the ecosystem is thinner.

| VRAM | What it unlocks | Voice-viable? |
|---|---|---|
| 8–12 GB | 8B dense at Q4, or a 4B at Q8. Tight KV headroom. | Yes, single call, small model |
| **16 GB** | 14B dense at Q4 comfortably; 8B with long context and many slots | Yes, several calls |
| **24 GB** | 30B MoE at Q4 *entirely in VRAM*, or 32B dense at Q4. **The sweet spot.** | Yes, 8–16 calls |
| 32–48 GB | 70B at Q4, or 30B at Q6 with huge context | Comfortably |

**24 GB is the target.** It's the point where your Tier-1 workhorse model from
doc 02 fits entirely in VRAM — which turns your best model from a batch-only
tool into an interactive one, and makes live voice genuinely work.

Practical note on used cards: a used 24 GB card is usually far better value than
a new 16 GB one, and for inference you don't need current-generation compute —
you need capacity and bandwidth. Check that whatever you buy supports the
quantisation formats you use (anything from the last few generations does, for
Q4/Q5 GGUF and FP16).

## What the six minis do afterwards

Nothing here becomes obsolete. The role map from doc 01 barely changes:

| Node | Before GPU | After GPU |
|---|---|---|
| pve-1 | Gateway | **Gateway** — unchanged, now routes to the GPU node too |
| pve-2,3,4 | Workhorse replicas | **Batch/overflow tier** — big offline jobs, and overflow when the GPU is saturated |
| pve-5 | Fast lane + embeddings | **Embeddings, reranking, STT, TTS** — all better here than on GPU |
| pve-6 | Data/ops | **Data/ops** — unchanged |
| pve-7 (new) | — | **Live serving**: workhorse model in VRAM, voice LLM, anything interactive |

The important idea: **don't put embeddings, reranking, STT, or TTS on the GPU.**
They're small models where CPU is fast enough, and every GB of VRAM they occupy
is a GB unavailable to the model whose latency you actually care about. The minis
absorbing all the small-model work is what lets one 24 GB card behave like a
bigger one.

## Software changes

Small, because `llama.cpp` and the OpenAI-compatible API stay the same:

- Rebuild `llama.cpp` with `-DGGML_CUDA=ON` (or `GGML_HIPBLAS` / `GGML_SYCL`).
  Same server binary, same flags, same API.
- Add `-ngl 99` to offload all layers to GPU. Drop `--mlock` and the CPU thread
  tuning — irrelevant once layers live in VRAM.
- Consider **vLLM** on the GPU node instead of `llama.cpp`. vLLM's continuous
  batching and paged attention give substantially better *concurrent* throughput
  on GPU, which is exactly what live voice needs. It's the better choice for a
  GPU serving node; `llama.cpp` remains the better choice on CPU. Keep both —
  the gateway hides the difference from your applications entirely.
- Add the GPU node as another entry in `gateway/litellm-config.yaml`, with
  higher routing priority than the CPU workers. That's the whole integration.

## When you send the spec

Tell me the card (model and VRAM) and how it's attached (slot / OCuLink /
Thunderbolt) and I'll give you the concrete build flags, the passthrough
configuration for that attachment method, the model tier it unlocks, and the
revised voice budget.
