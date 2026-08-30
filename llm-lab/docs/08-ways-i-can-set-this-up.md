# 08 — Ways I can actually set this up for you

Ranked by how much of the work happens without you at the keyboard.

The constraint behind all of them (measured, not assumed — see `docs/06`): a
Claude session on claude.ai/code runs in an ephemeral cloud container with no
route to `192.168.1.x`. Browsers don't help — any browser I drive runs *in that
container*, so it sits exactly where `curl` sits. Nothing bridges that gap
except code that runs on your side.

---

## A. One-command bootstrap — I wrote it, it does the build

**You do:** paste one line per node.
**It does:** everything else.

```bash
# On each Proxmox host, as root
git clone https://github.com/Hakeemshaik/AIployee /opt/AIployee
cd /opt/AIployee/llm-lab

./preflight.sh                  # read-only. changes nothing. read the verdict.
./bootstrap.sh --role workhorse --dry-run   # see the plan
./bootstrap.sh --role workhorse             # do it
```

`bootstrap.sh` auto-detects physical cores, free RAM, your subnet and gateway,
a free CTID, a free IP, and the best storage — then sizes the container, builds
`llama.cpp` for that exact CPU, downloads the weights, installs the systemd
service, and **verifies with a real completion request**, not just a health
check. It prints a plan and waits for confirmation first, and it's safe to
re-run: an existing container is resumed, not clobbered.

Roles: `workhorse` (30B MoE), `fast` (4B), `embed` (bge-m3), `gateway`
(Docker + LiteLLM, with secrets generated for you).

**What it can't do:** decide things only you can see. It stops and asks when
RAM is too tight for the role, when it cannot prove an IP is actually free, or
when a llama.cpp flag has been renamed. Those messages tell you the exact
command to run next.

**Honest status:** the helper logic is unit-tested (`make test`, 22 assertions
covering CTID selection, memory sizing and IP probing). The Proxmox path is
untested against live hardware — I have no cluster to run it on. Treat the
first run as a supervised one, which is why `--dry-run` exists.

---

## B. Claude Code on the LAN — I do it, live

**Best capability.** This is the only option where I read the error and fix it
myself, in the loop, rather than handing you a script and hoping.

```bash
# On a management LXC on the cluster, or your laptop on the same network
curl -fsSL https://claude.ai/install.sh | bash
git clone https://github.com/Hakeemshaik/AIployee && cd AIployee
git checkout claude/llm-proxmox-i7-lab-b03rc3
claude
```

Then: *"run preflight on all six nodes and set up the first worker."*

A management LXC beats your laptop: it stays on, it's on the cluster network
permanently, it can hold SSH keys without them living on a portable device, and
you can snapshot and roll it back.

This is where the read-fix-retry loop lives — diagnosing a renamed flag,
reading `journalctl`, re-running `tune.sh` and acting on the numbers. Option A
scripts the happy path; option B handles the unhappy one.

---

## C. Self-hosted GitHub Actions runner — I work asynchronously in your lab

Worth knowing about, because it's the only way to get *me* working in your lab
while you're not there.

A runner inside your lab polls GitHub **outbound** — no inbound ports, no
exposed Proxmox, nothing to firewall. You open an issue, a workflow starts
Claude Code on that runner with access to your cluster, and it pushes the result
back as a PR.

```bash
# In an LXC on the cluster
mkdir actions-runner && cd actions-runner
# Fetch the runner tarball from your repo's Settings -> Actions -> Runners,
# which also gives you the registration token.
./config.sh --url https://github.com/Hakeemshaik/AIployee --token <TOKEN> --labels lab
sudo ./svc.sh install && sudo ./svc.sh start
```

Then a workflow pinned to `runs-on: [self-hosted, lab]` can run cluster commands.

**Be deliberate about this one.** A self-hosted runner executes code from your
repo on a machine inside your network. Restrict it to a private repo, never let
it run workflows from forks, and give it its own LXC rather than a Proxmox host.
Good for scheduled work (nightly benchmark, batch transcript runs); overkill for
the initial build.

---

## D. Co-pilot loop — you paste, I direct

Zero setup, works right now, no access granted. Slower per iteration, but every
script in this repo prints what it did and what to run next precisely so this
loop stays short.

Start with `./preflight.sh --paste` on each node — it emits a markdown table
built for exactly this.

---

## Not recommended

**Tunnelling this cloud session into your lab** (Tailscale, Cloudflare Tunnel,
port-forwarding `:8006`). It would need your Proxmox control plane reachable
from shared, ephemeral infrastructure, to save some round trips. Option B gives
strictly more capability with strictly less exposure. If you want remote access
to your own cluster, put it behind a VPN for *you* — not for a sandbox.

---

## What I'd actually do

1. **`./preflight.sh --paste` on all six nodes**, paste the tables back. Costs
   you five minutes, changes nothing, and tells me your real cores, RAM, hybrid
   layout, free IDs and storage — which is most of what "set it up based on my
   lab" means.
2. **`./bootstrap.sh --role workhorse` on your best node.** One node, end to
   end. Expect one or two things to need fixing; that's why it's one node.
3. **Install Claude Code locally when something breaks** — that's the moment
   option B pays for itself.
4. Then `bootstrap.sh` the rest, which by then is a tested script.
