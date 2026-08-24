# 07 — Coolify and self-hosted git

## First: Coolify is not a GitHub replacement

These are different jobs and it's worth being precise, because picking the wrong
tool for the wrong layer is the mistake this doc exists to prevent.

| Tool | What it actually is | Replaces |
|---|---|---|
| **GitHub** | Git hosting + code review + CI + issues | — |
| **Gitea / Forgejo** | Self-hosted git hosting, PRs, issues, Actions-compatible CI | **GitHub** |
| **Coolify** | Self-hosted PaaS: builds and deploys apps, reverse proxy, TLS, env vars, logs | **Vercel / Heroku / Render / Dokku** |

Coolify *connects to* a git provider — GitHub, GitLab, Bitbucket, or a
self-hosted Gitea — and deploys what it finds there. It doesn't store your code
as the source of truth. So "Coolify instead of GitHub" isn't a swap; it's adding
a deployment layer.

If the actual goal is **"get everything off GitHub and into my lab"**, the answer
is two tools: **Gitea (or Forgejo) for the code, Coolify for the deploys.** Both
run on the cluster, and together they give you a fully local
commit → build → deploy loop with nothing leaving the building.

## Where Coolify fits in this cluster — and where it must not

This is the part that matters technically.

| Layer | Run it under | Why |
|---|---|---|
| **Timy.ai** | ✅ **Coolify** | A web app. Containerises cleanly, benefits from auto-deploy on push, managed TLS, env-var handling and log aggregation. Strictly nicer than the systemd installer. |
| **Gateway stack** (LiteLLM + Postgres + Redis + Prometheus + Grafana) | ✅ **Coolify** | Already a `docker-compose.yml`. Coolify manages compose stacks natively and gives you restarts and log access for free. |
| **Gitea / Forgejo** | ✅ **Coolify** | Just another compose stack. |
| **Batch workload runners** | ⚠️ Either | Cron jobs in Coolify work fine. Plain systemd timers are simpler. Pick by taste. |
| **`llama.cpp` inference workers** | ❌ **Keep on LXC + systemd** | See below. This one is not a taste call. |

### Why the inference workers must stay off Docker

Every performance decision in `docs/01-architecture.md` is something Docker
either blocks or makes awkward:

- **`--mlock`** needs an unlimited memlock rlimit. Doable in Docker
  (`--ulimit memlock=-1`), but it's an extra thing to get wrong, and getting it
  wrong silently costs you the guarantee that an 18 GB model stays resident.
- **Native-ISA builds.** The whole point of `build-llama-cpp.sh` is compiling
  with `-march=native` for *that node's* CPU. Docker's model is one portable
  image across hosts, which is exactly the opposite. You'd end up building a
  per-node image, at which point the container has bought you nothing.
- **CPU pinning to P-cores.** `cpuset` through Docker is possible but clumsier
  than `CPUAffinity=` in a systemd unit, and this matters — see the E-core
  barrier-stall problem in `docs/01`.
- **18 GB of weights.** These become a bind mount, so the image isn't
  self-contained anyway. The container gains you nothing and costs you a layer.
- **Redeploy semantics are wrong.** Coolify recreates containers on deploy. An
  inference container takes 1–3 minutes to fault 18 GB of weights into page
  cache. You do not want a PaaS deciding to restart that.
- **Memory-bandwidth sensitivity.** LXC shares the host kernel with no memory
  virtualization layer. Docker's overhead here is small but non-zero, and this
  workload is bandwidth-bound by definition.

So the shape is: **Coolify runs the app tier, LXC + systemd runs the inference
tier.** That split isn't a compromise — each layer gets the tool that suits it.

## Hosting Coolify on Proxmox

**Use a VM, not an LXC.** Coolify's installer assumes a normal Ubuntu/Debian
host with Docker. Docker inside an unprivileged LXC does work (`nesting=1` plus
`keyctl=1`), and people run it, but you will hit friction around cgroups,
overlayfs and systemd-in-container that has nothing to do with your actual goal.
A VM is the low-drama choice for the one service whose job is managing other
services.

```bash
# On a Proxmox host -- a spare node, or pve-6 (data/ops). NOT an inference node.
qm create 210 --name coolify --cores 4 --cpu host --memory 8192 --balloon 0 \
  --net0 virtio,bridge=vmbr0 --scsihw virtio-scsi-single \
  --scsi0 local-lvm:80,discard=on,ssd=1 --ostype l26 --agent enabled=1 --onboot 1
# Install Ubuntu 24.04 LTS, then inside the VM:
#   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
# (check coolify.io/docs for the current installer command before running it)
```

Budget **~4 GB RAM and 40+ GB disk** for Coolify itself: it runs its own
Postgres, Redis and Traefik alongside your apps. Build caches grow, so give the
disk room.

Put it on pve-6 or a spare node. Never on pve-2/3/4 — a build job compiling
something at full tilt will steal exactly the memory bandwidth your inference
workers need, and you'll spend an afternoon confused about why tokens/sec
halved.

## The fully local loop

```
   you commit
       │
       ▼
  ┌──────────────┐   webhook    ┌──────────────┐   docker    ┌──────────────┐
  │  Gitea       │─────────────▶│  Coolify     │────────────▶│  Timy.ai     │
  │  (pve-6)     │              │  (VM 210)    │             │  Gateway     │
  │  code+PRs+CI │              │  build/TLS   │             │  Gitea itself│
  └──────────────┘              └──────────────┘             └──────────────┘
                                                                    │
                                                              calls │
                                                                    ▼
                                                        ┌────────────────────┐
                                                        │ llama.cpp workers  │
                                                        │ LXC + systemd      │
                                                        │ (NOT under Coolify)│
                                                        └────────────────────┘
```

Nothing in that loop touches the internet except pulling base images and model
weights.

## The consequence you need to decide about

**A Claude Code session on claude.ai/code can reach GitHub. It cannot reach a
Gitea on your LAN.**

That follows directly from `docs/06`: web sessions run in an ephemeral cloud
container with no route to private addresses. GitHub works because it's a public
service the session can reach through its proxy. A LAN-only Gitea is invisible
to it — same as your Proxmox API.

So moving the source of truth to Gitea means:

- ❌ No remote Claude sessions reading or pushing to the repo
- ❌ No GitHub-hosted CI
- ❌ No PR review from a phone, or from anywhere off the LAN
- ✅ Nothing leaves your building
- ✅ Local Claude Code (running on the LAN) works exactly as before

### The setup that keeps both: Gitea as primary, GitHub as a mirror

You don't have to choose. Keep Gitea authoritative for deploys and push to
GitHub as a mirror:

```bash
# Add both remotes; git will push to each in turn on `git push origin`
git remote set-url origin ssh://git@10.0.0.206:2222/hakeem/aiployee.git
git remote set-url --add --push origin ssh://git@10.0.0.206:2222/hakeem/aiployee.git
git remote set-url --add --push origin git@github.com:Hakeemshaik/AIployee.git

git remote -v      # verify: one fetch URL, two push URLs
git push origin main
```

Or let Gitea do it server-side — **Settings → Mirror Settings → Push Mirror** on
the repo, with a GitHub token. That way a `git push` to Gitea propagates without
your local config having to know.

Either way: Coolify deploys from Gitea (fast, local, private), while GitHub stays
a readable mirror for remote Claude sessions, CI, and off-LAN review.

**One caution on mirroring:** the private repo is now in two places, so it's two
places to get access control right, and a secret committed by mistake reaches
GitHub too. If some content must never leave the building, that content belongs
in a Gitea-only repo, not in the mirrored one.

## What you give up leaving GitHub

Worth being clear-eyed, because Gitea is good but it is not a drop-in equal:

- **CI runners.** Gitea Actions is largely GitHub-Actions-compatible, but you
  host the runners and maintain them. For this project CI is light, so that's
  fine.
- **Ecosystem integrations.** Dependabot-style updates, third-party apps, and
  security scanning are thinner or absent.
- **Review UX.** Perfectly usable, less polished.
- **Durability.** GitHub is someone else's backup problem. A self-hosted Gitea is
  *yours* — if pve-6's disk dies and you had no backup, the history is gone.
  Back up Gitea's data volume and its database, and verify a restore once. This
  is the risk people actually get hurt by.

## What you gain with Coolify, concretely

Regardless of where the git lives, Coolify is a real improvement for the app
tier:

- **Push to deploy.** Commit a `persona.md` change, Timy redeploys. That
  shortens the persona-iteration loop from Phase 5 of the tutorial, which is
  where most of the product value gets made.
- **TLS and routing handled**, so `https://timy.yourdomain` instead of
  `http://10.0.0.201:8090`.
- **Env vars and secrets in one UI**, instead of `/etc/timy.env` on a box you
  have to SSH into.
- **Logs and rollback** without `journalctl` over SSH — and one-click rollback to
  the previous deploy is genuinely valuable when a persona edit makes Timy worse.
- **Scheduled jobs** for the batch workloads, with output you can actually read.

### TLS on a LAN

Let's Encrypt needs a publicly resolvable name. On a LAN-only setup you have
three options, in order of preference:

1. **Real domain, DNS-01 challenge, internal A records.** Own
   `timy.aiployee.co.za`, point it at `10.0.0.x` in your internal DNS, and let
   Coolify issue certs via DNS-01 (no inbound ports needed). Best answer.
2. **Internal CA.** Real certs, but every device needs your root cert installed.
3. **Plain HTTP on the LAN.** Fine for a trusted network. Just never combine it
   with exposing Coolify's own dashboard beyond the LAN.

## Ready-made in this repo

- `timy/Dockerfile` — builds Timy; unprivileged user, health check Coolify reads.
- `timy/docker-compose.coolify.yml` — point Coolify at this file. Uses
  `SERVICE_FQDN_TIMY_8090` so Coolify assigns a domain and terminates TLS, and
  puts `data/` on a named volume so **the feedback log survives redeploys** —
  that file is your eval set, and losing it on a deploy is the worst kind of
  quiet data loss.
- `llm-lab/gateway/docker-compose.yml` — already Coolify-compatible. Add it as a
  Docker Compose resource; set the env vars from `.env.example` in Coolify's UI
  rather than committing a `.env`.

## Recommendation

For where you are right now:

1. **Finish the tutorial as written first.** systemd and `docker compose` get you
   to a working cluster with the fewest moving parts. Debug one new thing at a
   time — adding a PaaS while you're still finding llama.cpp flag renames means
   two unfamiliar failure modes at once.
2. **Then add Coolify** for Timy and the gateway stack. Push-to-deploy on
   `persona.md` is a genuine quality-of-life win, and rollback is worth having.
3. **Add Gitea when you actually want off GitHub** — and set up the push mirror
   at the same time, so you keep remote access and CI. Do the backup-and-restore
   test the same day you set it up, not "later".
4. **Never move the inference workers.** They stay LXC + systemd. That's the one
   hard line in this document.
