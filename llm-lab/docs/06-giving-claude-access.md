# 06 — Giving Claude access to the cluster

## The constraint that decides everything

**A Claude Code session running on claude.ai/code (web, mobile, or a GitHub
Action) cannot reach your Proxmox cluster, and no credential changes that.**

Those sessions run in an ephemeral container on Anthropic's cloud
infrastructure. Verified from inside one:

| Test | Result |
|---|---|
| TCP to `10.0.0.1:8006` (typical Proxmox web UI) | timeout — no route |
| TCP to `192.168.1.1:8006` | timeout — no route |
| Outbound HTTPS to a public host | works, via the agent proxy |
| Arbitrary public port (non-443) | blocked |

Private ranges (`10/8`, `172.16/12`, `192.168/16`, `100.64/10`) are in the
container's `no_proxy` list, so traffic to them bypasses the proxy and is
attempted directly — and there is no route from a cloud sandbox to your LAN.
This is network topology, not permissions. Handing over a root password or an
API token to a *web* session accomplishes nothing.

Two consequences worth stating plainly:

1. The container is **ephemeral**. It is reclaimed after inactivity, and the
   repo was cloned fresh at start. Nothing survives that is not committed and
   pushed. A half-finished cluster build in a web session is lost work.
2. Anything the cluster must reach has to be reachable *from the cluster*, not
   from the session.

## The three real options

### Option A — run Claude Code locally, on the LAN (recommended)

Install the Claude Code CLI on a machine that already has access: your laptop
on the same network, or better, a small management LXC on the cluster itself.
*That* session has direct access, and it can do the whole job end to end.

```bash
# On a management box or LXC on the cluster LAN
curl -fsSL https://claude.ai/install.sh | bash
git clone <this repo> && cd AIployee/llm-lab
claude
```

Why a management LXC beats your laptop: it stays on, it is on the cluster
network permanently, it can hold SSH keys to the nodes without those keys
living on a portable device, and you can snapshot and roll it back.

### Option B — co-pilot loop (works right now, zero setup)

You run commands, paste output back, I read it and produce the next step. This
is what the kit in this repo is built for: every script prints what it did and
what to do next, precisely so this loop is short.

Slower per iteration, but no access granted at all. Good for the first pass, and
for anything touching a node that carries production traffic.

### Option C — expose the Proxmox API to the internet

Technically possible with a Cloudflare Tunnel or similar. **I would advise
against it**, and would not ask you to do it:

- Proxmox's API at `:8006` is the control plane for every VM on the cluster.
  Exposing it publicly to enable a convenience is a poor trade.
- The session that would use it is ephemeral and runs on shared
  infrastructure. Credentials pasted into it should be treated as
  short-lived and disposable, which a Proxmox root token is not.
- Option A gets you strictly more capability with strictly less exposure.

If you ever do need remote access to the cluster for your *own* use, put it
behind a VPN (WireGuard/Tailscale), not a public port — same advice as docs/05.

## What a local session can actually do

Concretely, in rough order of where it saves the most time:

**Debug the things that will definitely break.** The Proxmox scripts in this
repo are untested against a live PVE host, and `llama.cpp` renames flags
between releases. The single most likely failure is `llama-server` refusing to
start because a flag moved — a five-second fix *if* something can read the
journal, edit `models.env`, and restart. That read-fix-retry loop is the whole
value; it is what the co-pilot loop is bad at.

**Provision the six nodes.** Run the LXC creation across nodes, fix `pct`
complaints as they surface, verify the container config actually applied
(ballooning off, memlock raised, swap 0).

**Build and tune per node.** Compile `llama.cpp` with native ISA, diagnose
compile failures, run `tune.sh`, read the sweep, write the winning
`THREADS`/`CPU_AFFINITY` back, restart, confirm the gain is real. Repeat per
node, because the answer may differ between them.

**Measure and decide.** Run the bench suite, interpret TTFT vs decode, decide
the model tier from your numbers, and produce the voice verdict from measured
values instead of my estimates.

**Wire and test the gateway.** Bring up the compose stack, verify routing and
that pulling a node's plug actually fails over rather than erroring.

**Build the batch jobs against real data.** Write and validate the extraction
prompts and schemas against actual transcripts, measure the schema-failure
rate, tune quantisation if it is too high.

**Find the thermal ceiling.** Run a sustained load and watch throughput against
CPU temperature. Mini PCs throttle under hours of all-core load with no error
in any log; this needs someone watching two metrics at once for a while.

## The permission boundary I would actually recommend

Proxmox root is full control of every VM on the cluster. If anything of
AIployee's production runs there, root on the cluster is production blast
radius. So:

**Do give it root inside the inference containers.** They are disposable — the
scripts rebuild one in minutes. Nothing of value lives there but a model file
you can re-download.

**Don't hand over `root@pam` on the hosts by default.** Create a scoped user
and API token instead. Proxmox has genuinely fine-grained ACLs:

```bash
# On a PVE host, as root -- once.
pveum role add LlmLabProvision -privs \
  "VM.Allocate,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,\
VM.Config.Options,VM.PowerMgmt,VM.Console,VM.Audit,Datastore.AllocateSpace,\
Datastore.Audit,Sys.Audit"

pveum user add claude@pve --comment "llm-lab provisioning, scoped"
pveum user token add claude@pve lab --privsep 1

# Scope it to the CTIDs and storage it needs -- NOT to / :
pveum aclmod /vms/201 --users claude@pve --roles LlmLabProvision
pveum aclmod /vms/202 --users claude@pve --roles LlmLabProvision
pveum aclmod /storage/local-lvm --users claude@pve --roles LlmLabProvision
```

Note the honest caveat: **that token governs the API, not the shell.** The
scripts in `proxmox/` call `pct` and `qm`, which need root on the host. So you
get one of two shapes:

- **Scoped token + API calls** (`pvesh`, or HTTP to `:8006/api2/json`). Least
  privilege, but the provisioning scripts need porting from `pct` to `pvesh`.
  Worth doing if this becomes routine.
- **Root SSH to the hosts, supervised.** More capability, more trust. Reasonable
  for a one-off build on a lab that carries no production traffic.

Either way:

- **Snapshot or back up before a build session.** `vzdump` the containers that
  matter. Rollback should be one command.
- **Don't run a build session while production voice traffic is on the
  cluster.** Not because something will definitely go wrong, but because a
  saturated node and a dropped call are the same symptom to a caller.
- **Use a separate SSH key** for this, so revoking it costs nothing.
- **Keep secrets out of the repo.** `gateway/.env` is gitignored. Anything
  pasted into a session transcript should be considered disclosed and rotated.

## Practical first session

If you go with Option A, the useful order is:

1. Point it at one node only. Build one worker end to end and get it healthy.
2. Run `tune.sh` and `bench.py` on that node. Now you have real numbers, and
   the model-tier decision in docs/02 stops being theoretical.
3. Fix whatever broke in the scripts, commit the fixes, then fan out to the
   other nodes with a script that is now actually tested.
4. Gateway last. It is the easy part and it is useless until workers exist.

That order means the first hour produces a measured answer to "is this fast
enough for what I want", which is the question that determines whether the rest
is worth building.
