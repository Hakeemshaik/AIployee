# 01 — Architecture

Target hardware: 6× Intel i7 mini PC, 32 GB RAM each, Proxmox VE cluster,
CPU-only (GPU to follow).

Aggregate: ~192 GB RAM, ~48–96 threads, ~300–450 GB/s of *aggregate* memory
bandwidth — but that bandwidth is only usable in 6 separate 50–75 GB/s pools.
The architecture below is shaped entirely by that fact.

## Node role map

Don't run everything everywhere. Inference nodes should do nothing but
inference, because anything else steals memory bandwidth from the thing you
care about.

| Node | Role | Services | RAM used |
|---|---|---|---|
| pve-1 | **Gateway / control** | LiteLLM proxy, Redis, Postgres (request logs), Prometheus, Grafana, Caddy | ~6 GB |
| pve-2 | **Inference worker A** | `llama-server` (workhorse model) | ~26 GB |
| pve-3 | **Inference worker B** | `llama-server` (workhorse model) | ~26 GB |
| pve-4 | **Inference worker C** | `llama-server` (workhorse model) | ~26 GB |
| pve-5 | **Fast-lane worker** | `llama-server` (small model, high `-np`) + embeddings server | ~12 GB |
| pve-6 | **Data / ops** | Qdrant (vectors), MinIO (model + artifact store), batch job runner, NFS export | ~16 GB |

Rationale for the split:

- **Three identical workhorse replicas** give you ~3x batch throughput and let
  you take one node down for maintenance without an outage. Identical models
  mean the gateway can round-robin without caring which node serves a request.
- **One fast-lane node** runs a small model (1.7B–4B) with a high parallel-slot
  count. Small models are cheap enough that one node can serve many concurrent
  short requests — classification, routing, field extraction, guardrails. Most
  of your bulk work belongs here, not on the workhorse.
- **Embeddings share the fast-lane node** because embedding models are tiny and
  the workload is bursty. They also stay on CPU permanently even after you buy a
  GPU — no reason to spend GPU RAM on a 300M-parameter encoder.
- **Gateway is deliberately separate** from every worker. If the proxy competes
  for cores with an inference process, your tail latency becomes unpredictable
  and you will waste a day chasing it.

## LXC, not VM

Run inference in an **unprivileged LXC container**, not a VM.

- LXC shares the host kernel and has no memory virtualization layer. Since CPU
  inference is memory-bandwidth-bound (see README), the ~2–5% that hardware
  virtualization costs on memory access is worth avoiding for free.
- LXC sees the host's real CPU flags, so AVX2/AVX-512/AMX are available with no
  configuration. In a VM you **must** set CPU type to `host` or you will
  silently lose AVX-512 and roughly half your prompt-processing speed.
- Snapshots, backups, and migration all still work.

Use a VM only for the future GPU node, where PCIe passthrough makes a VM the
cleaner option. `proxmox/create-vm-gpu-ready.sh` prepares that.

## Critical Proxmox settings for inference guests

These are the settings that actually matter. `proxmox/create-lxc-inference.sh`
applies them; this is why.

**Memory ballooning: OFF.** Ballooning lets the host reclaim guest RAM. For an
inference guest that has `mlock`ed a 18 GB model into RAM, reclaim either fails
or forces the model out of page cache — and re-faulting it in mid-request turns
a 2-second response into a 40-second one. Set memory fixed, no balloon.

**Swap: 0.** If any part of the model reaches swap, throughput collapses by
1–2 orders of magnitude. A hard OOM is a better failure mode than a node that
appears alive but serves at 0.2 tok/s. Set container swap to 0 and
`vm.swappiness=0` inside.

**KSM (kernel same-page merging): disabled on inference nodes.** KSM scans
memory looking for duplicate pages to deduplicate. Model weights are
high-entropy, so it finds almost nothing, while the scanning itself consumes
exactly the resource you're short of — memory bandwidth. `systemctl disable
--now ksmtuned` on the PVE host.

**CPU pinning on hybrid (P-core/E-core) CPUs.** 12th-gen Intel and later mix
fast P-cores with slow E-cores. `llama.cpp` splits work into equal chunks across
threads and then waits at a barrier for all of them — so an E-core running at
60% of P-core speed makes *every* thread wait. Pinning to P-cores only is
frequently **faster** than using all cores, despite using fewer. Measure both;
`inference/tune.sh` does this for you.

**Cores allocated = physical cores, not threads.** Hyperthreading gives two
logical cores that share one set of execution units and one L1/L2 path. For a
bandwidth-bound workload the second thread adds contention, not throughput.
Start at physical-core count and only go higher if measurement says so.

**Transparent huge pages: `always` or `madvise`.** Fewer TLB misses when walking
gigabytes of weights per token. Small win, free.

## Storage: model weights must be on local disk

`llama.cpp` memory-maps the GGUF file and relies on the OS page cache to keep it
resident. That works beautifully on local NVMe and badly over NFS, where cache
coherency semantics force re-reads and a cache miss costs a network round trip
instead of a microsecond.

So:

- **Distribution:** keep the canonical model library in MinIO or an NFS export
  on pve-6. That's your source of truth and how you avoid re-downloading 18 GB
  per node.
- **Serving:** each worker `rsync`s or pulls the model to its **own local
  NVMe** before starting. `inference/download-models.sh` handles both paths.
- **Never** point `llama-server --model` at an NFS path.

Also: don't use Ceph here. Ceph wants a dedicated fast network and at least 3
dedicated OSD nodes; on 1–2.5 GbE with 6 nodes that are also computing, it will
cost you more in latency and CPU than it returns. Local ZFS per node plus
Proxmox Backup Server or scheduled `vzdump` to pve-6 is the right shape for this
cluster.

## Network

```
                    ┌──────────────────────────────┐
   clients ────────▶│  pve-1  Caddy → LiteLLM      │
   (your apps,      │         :4000 OpenAI-compat   │
    n8n, scripts)   └───────┬──────────────────────┘
                            │ round-robin + health checks
          ┌─────────────────┼─────────────────┬──────────────┐
          ▼                 ▼                 ▼              ▼
   ┌────────────┐    ┌────────────┐    ┌────────────┐  ┌──────────────┐
   │  pve-2     │    │  pve-3     │    │  pve-4     │  │  pve-5       │
   │ workhorse  │    │ workhorse  │    │ workhorse  │  │ fast lane +  │
   │ :8080      │    │ :8080      │    │ :8080      │  │ embeddings   │
   └────────────┘    └────────────┘    └────────────┘  └──────────────┘
                                                              │
                                                       ┌──────▼───────┐
                                                       │  pve-6       │
                                                       │ Qdrant/MinIO │
                                                       │ batch runner │
                                                       └──────────────┘
```

- One flat VLAN for the cluster is fine. Inference traffic is small — a request
  and a token stream, measured in kilobytes. You are not bandwidth-constrained
  on the *serving* path.
- The place bandwidth matters is **model distribution** (18 GB × 4 nodes). If
  your minis have 2.5 GbE, use it for that. Bonding two 1 GbE links helps here
  and nowhere else.
- Bind `llama-server` to the cluster network only, never to a public interface.
  It has no authentication. Authentication belongs at the gateway.

## Request flow and why the gateway exists

Everything speaks the OpenAI chat-completions API, so the gateway can be
transparent. LiteLLM on pve-1 gives you:

- **One endpoint** for all your apps, so you can move models between nodes
  without touching client code.
- **Load balancing with health checks** across the three workhorse replicas.
- **Model aliases** — your code asks for `workhorse` or `fast`, and the routing
  decision lives in config, not in your application.
- **Fallbacks**, including to a hosted API. This matters more than it sounds:
  it means you can point production at the local cluster and have it degrade to
  a cloud model instead of failing when a node is down or overloaded.
- **Request logging and cost accounting**, which is how you find out whether the
  cluster is actually saving you money.

## Sizing: what fits in 32 GB

Per worker node, budget:

```
  32 GB total
-  1.5 GB  host/LXC overhead + OS
-  2.0 GB  page cache headroom, logs, monitoring agent
= 28.5 GB  available to the inference process
```

Of that, the model file and the KV cache compete:

```
  KV cache bytes ≈ 2 (K and V)
                 × n_layers × n_kv_heads × head_dim
                 × bytes_per_element
                 × context_length
                 × parallel_slots
```

For `Qwen3-30B-A3B` at 32k context with 4 slots and `q8_0` KV cache, that's
roughly 4–6 GB. So an 18 GB model plus 6 GB of KV leaves ~4 GB of margin —
comfortable. Push context to 128k or slots to 16 and you will OOM. `bench/`
reports actual resident size so you can size this from measurement rather than
from my arithmetic.

Rule of thumb: **keep model file ≤ 20 GB on a 32 GB node.** Above that, KV cache
and page cache start fighting and you lose more to eviction than you gained from
the bigger model.

## What changes when the GPU arrives

Covered in [04-gpu-upgrade-path.md](04-gpu-upgrade-path.md), but the headline is
that mini PCs usually have no x16 slot, so the realistic move is one new tower
node for the GPU while the minis keep the roles they're good at: gateway,
embeddings, STT/TTS, batch orchestration, and vector search. Nothing in this
architecture gets thrown away.
