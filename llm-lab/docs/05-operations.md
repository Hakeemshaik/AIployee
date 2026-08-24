# 05 — Operations: making the cluster earn its keep

## The highest-value workload: free prompt regression testing

This deserves its own section because it's the use case that pays for the
cluster fastest and it's the one people don't think of.

You already run scenario banks against voice agent prompts. Today every
iteration costs hosted tokens, which means there's an implicit budget on how
often you re-run the full suite — so in practice it gets run at ship time and
not much in between.

With local inference, marginal cost is electricity. That changes the workflow:

- Run the **full** scenario bank on every prompt change, not just before ship.
- Run each scenario **N times** to measure variance, instead of once and hoping.
- Keep a permanent regression suite and run it nightly, so a prompt edit that
  breaks dispute handling shows up the next morning rather than on a live call.
- Use the Tier-1 workhorse as an **LLM judge** for scoring the simulated
  conversations. Judging is batch work with no latency requirement — a perfect
  fit for this hardware.

One honest caveat: a local 30B MoE is not the model that runs in production, so
a scenario passing locally isn't proof it passes on the production model. Treat
local runs as a **regression filter** — cheap, catches the obvious breakage,
run constantly — and keep a smaller confirmation pass against the production
model before shipping. Filter locally, confirm hosted. That's the split that
saves real money without lying to you.

## The second-highest: batch transcript work

Post-call analysis, outcome verification against transcripts, PTP extraction,
contact-rate computation, redial-list construction. All of it is:

- Latency-insensitive — it runs after the calls, overnight if you like.
- Embarrassingly parallel — one transcript per request, three replicas.
- Currently costing hosted tokens on a recurring basis.

`workloads/` has working examples of the pattern. The key design point is
**always validate structured output against a schema and route failures to a
retry queue** — a local Q4 model will occasionally emit malformed JSON, and a
batch job that silently drops 2% of records is worse than one that fails loudly.

## Monitoring: three numbers that matter

Grafana dashboards are satisfying and mostly decorative. Alert on these:

1. **Tokens/sec per node, trending.** A node that quietly drops from 20 to
   4 tok/s is almost always swapping or thermally throttling. This is the single
   most useful metric on the cluster.
2. **Queue depth at the gateway.** Rising queue depth means you're
   under-provisioned for current load. This is your scale-out signal.
3. **Resident set size vs. node RAM.** Your early-warning for OOM. Should be
   stable; growth over hours means a KV cache leak or slot mismanagement.

Also worth watching but not alerting on: TTFT p95 (drifts up as prompts grow),
and schema-validation failure rate on batch jobs (drifts up if you change quant
or model).

### Thermal throttling is the sneaky one

Mini PCs have small heatsinks and were not designed for sustained 100% CPU
across all cores for hours. A long batch run will heat-soak the chassis and the
CPU will downclock — often by 30–40% — without any error anywhere in your logs.
Symptoms: throughput that's fine for ten minutes and poor for the next two hours.

- Watch `sensors` / `/sys/class/thermal` alongside your throughput metric. If
  they're inversely correlated, that's your answer.
- Fixes that work: raise the ambient airflow, space the units out rather than
  stacking them, and consider deliberately capping threads slightly below
  physical cores. Running 6 threads at full clock often beats 8 threads
  throttled.
- This is a genuine argument for *distributing* batch work across all four
  workers rather than saturating one — spread heat, sustain clocks.

## Keeping RAM honest

- `--mlock` pins the model in RAM. Requires raising `memlock` limits in the
  systemd unit (`LimitMEMLOCK=infinity`); the units in `inference/` do this.
- Set `vm.swappiness=0` in the container and swap to 0 in the LXC config. As
  doc 01 says, a clean OOM beats a node serving at 0.2 tok/s.
- After changing `-c` or `-np`, re-check resident size. Both scale KV cache
  linearly and it is very easy to configure an OOM that only fires under load,
  hours later, when all slots finally fill.

## Updates

`llama.cpp` moves fast — performance improvements land weekly, and so do
occasional regressions and flag renames.

- Pin a known-good commit in `inference/models.env`. Don't track `master` on
  every node at once.
- Upgrade **one worker at a time**, benchmark it against the others, promote the
  change only if it wins. Three identical replicas make this a genuinely safe
  operation, which is a nice side benefit of the replica architecture.
- Flag names do get renamed. If the server fails to start after an upgrade,
  check `llama-server --help` before assuming anything is broken — that's why
  every flag in this kit lives in one env file.

## Backups

What's worth backing up, in order:

1. **This repo and your configs** — the actual intellectual content. It's in git.
2. **Prompts, eval sets, and eval results** — irreplaceable, and small. Back
   these up properly.
3. **Model weights** — large but re-downloadable. Keep one copy in MinIO/NFS on
   pve-6 so a node rebuild doesn't mean re-pulling from the internet; don't
   include them in `vzdump` runs or your backups become enormous for no benefit.
4. **Container root filesystems** — cheap `vzdump` snapshots are fine, and with
   the provisioning scripts a rebuild is faster than a restore anyway.

Exclude model directories from backup jobs explicitly. Four 18 GB models in a
nightly backup rotation will fill anything you point it at.

## Security

`llama-server` has **no authentication whatsoever**. Anyone who can reach the
port can use the model and read anything in flight.

- Bind workers to the cluster network only (`--host 10.0.0.x`, never `0.0.0.0`).
- All authentication at the gateway: LiteLLM virtual keys per application.
- Firewall the worker ports to the gateway's address at the Proxmox level.
- Never expose the gateway to the internet directly. If remote access is needed,
  put it behind a VPN (WireGuard/Tailscale) rather than a public port.
- **POPIA note:** the point of local inference is that debtor data and call
  audio never leave your premises — but request logging can undo that quietly.
  If the gateway logs full prompts to Postgres, you now hold a database of
  personal financial information with a retention policy of "forever". Decide
  deliberately: log metadata and timings always, log prompt/response bodies only
  when you need them for debugging, and set a retention window. This is
  configured in `gateway/litellm-config.yaml`.
