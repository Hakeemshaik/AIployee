# llm-lab — self-hosted LLM on a 6-node Proxmox cluster

A deployment kit for running local LLM inference on a Proxmox cluster of Intel
i7 mini PCs (6 nodes, 32 GB RAM each, CPU-only for now, GPU planned).

## Read this before you build anything

Three facts drive every design decision in this repo. If you internalise these,
the rest is mechanical.

### 1. You cannot split one model across six mini PCs. Don't try.

Tensor parallelism — the technique that lets a datacentre run one model across
many chips — needs interconnect bandwidth in the hundreds of Gbit/s
(NVLink, InfiniBand). Your cluster is on 1 GbE or 2.5 GbE. `llama.cpp` does have
an RPC backend that shards layers across hosts, and it will work, but over
Ethernet it is *slower* than running the same model on one node, because every
token pays a network round trip per shard boundary.

**So: scale out by replicas, not by splitting.** Each worker node runs a
complete copy of the model. A gateway load-balances across them. That buys you
**throughput** (more requests per second) and **redundancy**. It does not buy
you a bigger model or a faster single response. Six nodes ≠ one big GPU.

### 2. CPU inference is memory-bandwidth-bound, not compute-bound.

A dual-channel i7 mini PC has roughly 50–80 GB/s of usable memory bandwidth.
Generating one token requires reading the model's active weights from RAM. So:

```
tokens/sec  ≈  memory_bandwidth / active_bytes_per_token
```

A dense 8B model at Q4 has ~4.7 GB of weights. At 60 GB/s that ceiling is
~12 tok/s, and you'll realistically see half that. There is no flag, thread
count, or compiler option that beats this arithmetic — the only lever that
moves it by an order of magnitude is **reducing bytes read per token**.

Which is why the model recommendation in this repo is a **Mixture-of-Experts
model**: `Qwen3-30B-A3B` has 30B total parameters but activates only ~3B per
token. You get 30B-class output quality at 3B-class decode speed, because only
the active experts get read from RAM. On CPU this is not a marginal
optimisation, it is the difference between usable and unusable. See
[docs/02-model-selection.md](docs/02-model-selection.md).

### 3. Every performance number you read online is wrong for your hardware.

"i7" spans a decade of parts with 3x differences in memory bandwidth and core
counts. Rather than trusting anyone's benchmarks — including the estimates in
these docs, which are explicitly labelled as estimates — this kit ships a
benchmark harness. Run it on your actual nodes, and let the measurements decide
your model tier and your concurrency limits.

```bash
make bench            # measures TTFT, decode rate, and throughput under load
make voice-check      # tells you whether your measured numbers can hold a call
```

## What this gets you, honestly

| Workload | Verdict on CPU-only | Notes |
|---|---|---|
| Bulk data work (cleaning imports, normalising names/phones, field extraction) | **Excellent fit** | Latency-insensitive, parallelises perfectly across 4 workers. This is the strongest case for the lab. |
| Transcript analysis & call scoring | **Good fit** | Long prompts cost real time on CPU, but it's batch work — nobody's waiting. Run it overnight. |
| Prompt/agent regression testing | **Excellent fit, and underrated** | Your scenario banks can run against a local model at zero marginal cost. Iterate on prompts all day without a token bill. |
| Live voice agent brain | **Not for production. Demo-capable at 1–2 concurrent calls.** | The honest arithmetic is in [docs/03-voice-latency-reality.md](docs/03-voice-latency-reality.md). Short version: possible with a 4B model and aggressive prefix caching, but quality and concurrency will both disappoint versus a hosted model. Revisit when the GPU lands. |
| Learning / experimentation | **Excellent fit** | Obviously. |

## Layout

```
docs/       Architecture, model selection, the voice latency math, GPU upgrade
            path, giving Claude access, and Coolify / self-hosted git
proxmox/    Container/VM provisioning scripts to run on a PVE host
inference/  llama.cpp build, tuning, systemd units, model downloads
gateway/    LiteLLM proxy + load balancing across workers, observability
bench/      Benchmark harness — measure your own hardware
workloads/  Working examples of the batch patterns that suit this cluster
```

## Quick start

```bash
# 0. Read docs/01-architecture.md and decide your node role map.

# 1. On each worker node's PVE host: create an inference container.
#    (Runs on the Proxmox host itself, needs root.)
scp -r llm-lab root@pve-node2:/opt/
ssh root@pve-node2 '/opt/llm-lab/proxmox/create-lxc-inference.sh --ctid 201 --ip 10.0.0.201/24'

# 2. Inside the container: build llama.cpp tuned for this CPU, pull a model.
ssh root@10.0.0.201 '/opt/llm-lab/inference/build-llama-cpp.sh'
ssh root@10.0.0.201 '/opt/llm-lab/inference/download-models.sh workhorse'
ssh root@10.0.0.201 '/opt/llm-lab/inference/install-service.sh workhorse'

# 3. On the gateway node: bring up the proxy pointed at your workers.
cd llm-lab/gateway && cp .env.example .env && $EDITOR .env docker-compose.yml
docker compose up -d

# 4. Measure before you believe anything.
cd llm-lab && make bench GATEWAY=http://10.0.0.200:4000
```

## A note on where this fits

The AIployee production voice stack should stay on hosted models — the latency
math in doc 03 is not close, and a dropped call costs more than an API token.
Where this cluster earns its keep is everything *around* the calls: batch
transcript scoring, import cleaning, embeddings for retrieval, and free
unlimited prompt-regression runs. Those are real recurring costs today, and
they move onto this hardware cleanly.
