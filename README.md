# AIployee

## llm-lab

Deployment kit for self-hosted LLM inference on a 6-node Proxmox cluster of
Intel i7 mini PCs (32 GB RAM each, CPU-only, GPU planned).

Start at [`llm-lab/README.md`](llm-lab/README.md) — it opens with the three
hardware facts that determine every design decision, and an honest table of
which workloads this cluster is and is not suited to.

- [Architecture & Proxmox tuning](llm-lab/docs/01-architecture.md)
- [Model selection for CPU inference](llm-lab/docs/02-model-selection.md)
- [Live voice: the latency arithmetic](llm-lab/docs/03-voice-latency-reality.md)
- [GPU upgrade path](llm-lab/docs/04-gpu-upgrade-path.md)
- [Operations](llm-lab/docs/05-operations.md)
