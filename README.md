# AIployee

## Start here: [`TUTORIAL.md`](TUTORIAL.md)

A step-by-step build of a self-hosted LLM and **Timy.ai** on a Proxmox cluster
of Intel i7 mini PCs. Sequential, with a verifiable checkpoint after every phase
and a troubleshooting section for what actually goes wrong.

## What's in here

### [`timy/`](timy/README.md) — Timy.ai
Your private assistant: persona in a git-tracked file, your documents as a
citing knowledge base, feedback capture that becomes your eval set, and a
streaming web UI with no build step and no CDN.

### [`llm-lab/`](llm-lab/README.md) — the cluster underneath
Deployment kit for CPU inference on 6 nodes: Proxmox provisioning, `llama.cpp`
build and tuning, an OpenAI-compatible gateway with failover, a benchmark
harness, and batch workload runners.

- [Architecture & Proxmox tuning](llm-lab/docs/01-architecture.md)
- [Model selection for CPU inference](llm-lab/docs/02-model-selection.md)
- [Live voice: the latency arithmetic](llm-lab/docs/03-voice-latency-reality.md)
- [GPU upgrade path](llm-lab/docs/04-gpu-upgrade-path.md)
- [Operations](llm-lab/docs/05-operations.md)
- [Giving Claude access to the cluster](llm-lab/docs/06-giving-claude-access.md)
- [Coolify and self-hosted git](llm-lab/docs/07-coolify-and-self-hosted-git.md)
- [Ways I can set this up for you](llm-lab/docs/08-ways-i-can-set-this-up.md)
- [Weekend projects](llm-lab/docs/09-weekend-projects.md)

## The three facts that shape all of it

1. **You can't split one model across six mini PCs.** Tensor parallelism needs
   hundreds of Gbit/s; on 1–2.5 GbE it's slower than one node. Scale out by
   replicas, not by sharding.
2. **CPU inference is memory-bandwidth-bound**, so a Mixture-of-Experts model
   (~30B total / ~3B active) gives 30B-class quality at 3B-class speed. It beats
   a dense 14B on quality *and* speed at once.
3. **Nobody's benchmarks transfer to your "i7."** Measure your own hardware —
   `make bench` — and let the numbers pick your model tier.
