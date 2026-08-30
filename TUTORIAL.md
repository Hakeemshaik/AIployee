# Build Timy.ai on your Proxmox lab — step by step

A sequential tutorial. Follow it top to bottom. Every phase ends with a
**checkpoint** you can verify before moving on, and a **if it breaks** section
for what actually goes wrong.

**Total time:** about 4–6 hours of wall clock, but only ~90 minutes of typing.
Most of it is waiting for downloads and compiles. You can stop after any phase
and resume later.

**What you'll have at the end:** an open-weight LLM running on your own
hardware, an OpenAI-compatible gateway in front of it, and Timy.ai — a branded
assistant with your own knowledge base and a web UI — reachable from any browser
on your LAN.

---

## Before you start

### One thing to be clear about

Timy.ai will be **your product built on an open-weight base model**. The
persona, the knowledge, the UI, the brand, the behaviour — all yours. The base
weights are Qwen's. That is what "building your own LLM" means in practice for
anyone who isn't spending millions on GPUs, and it is the right architecture:
when a better base model ships in six months, you swap it in an afternoon and
keep everything you built.

Training a model from scratch on i7 mini PCs is not possible — that's a
GPU-cluster-months job. Fine-tuning is a *later* option and probably one you
won't need; see `llm-lab/docs/02-model-selection.md`.

### What you need

- [ ] Your Proxmox cluster up, nodes reachable, root SSH working
- [ ] At least **32 GB RAM free** on one node (more nodes = more throughput later)
- [ ] **~40 GB free disk** on that node
- [ ] Internet access from the nodes (to download weights and compile)
- [ ] This repo cloned somewhere you can `scp` from

### Naming used throughout

> **Your lab is on `192.168.1.x`** (your Proxmox host is `192.168.1.21`), but
> every example below uses `10.0.0.x` placeholders. Do not copy them verbatim.
> Once you've filled in the table, re-template the whole tutorial in one go:
>
> ```bash
> # Adjust the mapping to your real node addresses first, then run from the repo root
> sed -i \
>   -e 's/10\.0\.0\.201/192.168.1.201/g' \
>   -e 's/10\.0\.0\.202/192.168.1.202/g' \
>   -e 's/10\.0\.0\.203/192.168.1.203/g' \
>   -e 's/10\.0\.0\.204/192.168.1.204/g' \
>   -e 's/10\.0\.0\.205/192.168.1.205/g' \
>   -e 's/10\.0\.0\.206/192.168.1.206/g' \
>   -e 's/10\.0\.0\.1\b/192.168.1.1/g' \
>   TUTORIAL.md llm-lab/gateway/litellm-config.yaml llm-lab/gateway/prometheus.yml
> git diff --stat   # check it hit what you expected
> ```
>
> Containers need their **own free IPs** on that subnet — separate from the
> Proxmox hosts' addresses. Check what's already taken before you pick.

Substitute your real values. Write them down here before you start:

```
Gateway node        pve-1   10.0.0.201     <- your value: ____________
Worker node A       pve-2   10.0.0.202     <- your value: ____________
Worker node B       pve-3   10.0.0.203     <- your value: ____________
Worker node C       pve-4   10.0.0.204     <- your value: ____________
Fast-lane node      pve-5   10.0.0.205     <- your value: ____________
Gateway container port                4000
Timy port                             8090
```

### The one habit that saves you hours

**Do node A completely, end to end, before touching nodes B and C.** You will
find two or three things that need fixing. Fix them once on node A, commit the
fix, then fan out with scripts that actually work. Doing all four nodes in
parallel means finding the same bug four times.

---

## The fast path (if you'd rather not do it by hand)

Everything below can be done by one script. It auto-detects your hardware,
sizes the container, builds, downloads, installs and verifies:

```bash
git clone https://github.com/Hakeemshaik/AIployee /opt/AIployee
cd /opt/AIployee/llm-lab
git checkout claude/llm-proxmox-i7-lab-b03rc3

./preflight.sh                            # read-only inventory, changes nothing
./bootstrap.sh --role workhorse --dry-run # show the plan
./bootstrap.sh --role workhorse           # build it
```

Then skip to **Phase 2** to tune and benchmark. The manual phases below are
still worth reading — they explain *why* each setting is what it is, and
they're what you'll fall back to when the script stops and asks you something.
Other ways to get this set up are in `llm-lab/docs/08-ways-i-can-set-this-up.md`.

---

## Phase 0 — Inventory your cluster (15 min)

You said nodes are already running, so start by writing down what you actually
have. Every later decision depends on these numbers.

**On each Proxmox host:**

```bash
# Identity and memory
hostname; pvecm status 2>/dev/null | head -5
free -g

# CPU: physical cores matter, not threads
lscpu | grep -E '^(Model name|Socket|Core\(s\) per socket|Thread|CPU\(s\)):'

# Hybrid P-core/E-core CPU? Different max frequencies means yes.
lscpu --extended | awk '{print $1, $4, $8}' | sort -u -k3 | head

# Free disk on local storage
df -h / /var/lib/vz 2>/dev/null

# Existing guests, so you pick free CTIDs
pct list; qm list
```

Record it:

| Node | IP | Cores (phys) | RAM free | Disk free | Hybrid? | Free CTID |
|---|---|---|---|---|---|---|
| pve-1 | | | | | | |
| pve-2 | | | | | | |
| pve-3 | | | | | | |
| pve-4 | | | | | | |
| pve-5 | | | | | | |
| pve-6 | | | | | | |

**Also do these two host-level fixes now, on every node that will run
inference:**

```bash
# 1. Disable KSM. It scans RAM for duplicate pages, finds almost nothing in
#    high-entropy model weights, and burns memory bandwidth -- the exact
#    resource CPU inference is short of.
systemctl disable --now ksmtuned 2>/dev/null || echo "ksmtuned not present, fine"

# 2. Transparent huge pages: fewer TLB misses when walking GB of weights.
echo always > /sys/kernel/mm/transparent_hugepage/enabled
cat /sys/kernel/mm/transparent_hugepage/enabled   # expect [always]
```

To make THP survive a reboot, add `transparent_hugepage=always` to the kernel
command line (`/etc/kernel/cmdline` then `proxmox-boot-tool refresh`, or
`/etc/default/grub` then `update-grub`).

> **Checkpoint 0.** You have a filled-in table above, and `ksmtuned` is off.

---

## Phase 1 — First worker, end to end (60–90 min)

Pick your best node — most RAM free, most cores. This is node A.

### 1.1 Get the repo onto the Proxmox host

```bash
# From your workstation
scp -r /path/to/AIployee root@10.0.0.202:/opt/
```

### 1.2 Create the inference container

```bash
ssh root@10.0.0.202
cd /opt/AIployee/llm-lab

./proxmox/create-lxc-inference.sh \
    --ctid 202 \
    --ip 10.0.0.202/24 \
    --gw 10.0.0.1 \
    --role workhorse
```

Adjust `--ctid` to a free ID and `--ip` to a free address (the container gets
its *own* IP, separate from the host's). The script uses LXC rather than a VM
deliberately — no memory virtualization layer, and AVX-512 is visible with no
configuration. It also sets ballooning off, swap to 0, and raises the memlock
limit, all of which matter. `llm-lab/docs/01-architecture.md` explains why.

**If it breaks:**
- `CTID already exists` → pick another number, check `pct list`.
- `no debian-12 template found` → `pveam update`, then
  `pveam available --section system | grep debian`, and pass `--template`.
- `storage does not exist` → `pvesm status`, then pass `--storage <name>`
  (often `local-lvm` or `local-zfs`).

### 1.3 Copy the repo into the container and build llama.cpp

```bash
# On the host
pct exec 202 -- mkdir -p /opt
tar -C /opt -cf - AIployee | pct exec 202 -- tar -C /opt -xf -

# Build, tuned for this exact CPU
pct exec 202 -- /opt/AIployee/llm-lab/inference/build-llama-cpp.sh
```

This takes 5–15 minutes. It compiles with `-march=native` so the binary uses
this CPU's AVX2/AVX-512 — worth roughly double the prompt-processing speed of a
generic build, at the cost of not being portable to a different CPU generation.
That's fine; you build per node.

**If it breaks:**
- Out of memory during compile → `JOBS=2 ./build-llama-cpp.sh`.
- `cmake: not found` → the container's package install didn't finish; re-run
  `apt-get update && apt-get install -y build-essential cmake git curl libcurl4-openssl-dev`.
- A `-DGGML_*` flag is rejected → llama.cpp renamed it. Check
  `cmake -B build -LAH | grep GGML` and adjust; this happens occasionally.

### 1.4 Download the model

```bash
pct exec 202 -- /opt/AIployee/llm-lab/inference/download-models.sh workhorse
```

~18 GB. Go make coffee.

**Why this model.** `Qwen3-30B-A3B` is a Mixture-of-Experts model: 30B total
parameters but only ~3B active per token. Since CPU inference speed is
`bandwidth / bytes-read-per-token`, you get 30B-class quality at 3B-class speed.
A dense 14B model would be both slower *and* worse. On CPU this is the single
most important choice you make.

**If it breaks:**
- `MODEL_DIR is on nfs` → the script is refusing on purpose. `llama.cpp` mmaps
  the weights and NFS page-cache behaviour destroys throughput. Point
  `MODEL_DIR` at local disk.
- 404 from Hugging Face → the repo or filename moved. Search HF for
  `Qwen3-30B-A3B GGUF`, then update `WORKHORSE_REPO`/`WORKHORSE_FILE` in
  `inference/models.env`.
- Runs out of disk → `df -h`; you need ~20 GB free. Grow the container disk with
  `pct resize 202 rootfs +20G`.

### 1.5 Start the model server

```bash
pct exec 202 -- /opt/AIployee/llm-lab/inference/install-service.sh \
    workhorse --bind 10.0.0.202
```

First start reads 18 GB from disk, so allow a couple of minutes. The script
waits for the health endpoint and prints the resident memory size.

> **Checkpoint 1.** This returns a sentence of generated text:
>
> ```bash
> curl -s http://10.0.0.202:8080/v1/chat/completions \
>   -H 'Content-Type: application/json' \
>   -d '{"model":"workhorse","messages":[{"role":"user","content":"Say hello in one sentence."}],"max_tokens":40}' \
>   | python3 -m json.tool
> ```
>
> **You now have an LLM running on your own hardware.** Everything after this is
> making it fast, reliable, and pleasant to use.

**If it breaks:**
- Not healthy after 10 minutes → `pct exec 202 -- journalctl -u llama-workhorse -n 60 --no-pager`.
- `unknown argument: --flash-attn` (or similar) → **this is the most likely
  failure in the whole tutorial.** llama.cpp renamed a flag. Run
  `pct exec 202 -- llama-server --help | less`, find the current name, and fix
  it in `inference/install-service.sh`, then re-run.
- Killed / OOM → lower `WORKHORSE_CTX` to `8192` in `models.env` and re-run.
  Context and slots both scale KV cache linearly.

---

## Phase 2 — Measure, then decide (30 min)

Do not skip this. Every performance claim you'll read online — including the
estimates in these docs — was measured on different hardware. "i7" spans a
decade of parts with 3x differences in memory bandwidth.

### 2.1 Find the best thread count and CPU affinity

```bash
pct exec 202 -- /opt/AIployee/llm-lab/inference/download-models.sh fast
pct exec 202 -- /opt/AIployee/llm-lab/inference/tune.sh
```

This sweeps thread counts and, on hybrid CPUs, compares all-cores against
P-cores-only. Two results usually surprise people:

- **More threads is often worse.** Decode is memory-bandwidth-bound; threads
  past the bandwidth ceiling only add synchronisation overhead.
- **Fewer, faster cores often beat more mixed cores.** llama.cpp waits at a
  barrier for every thread, so one slow E-core stalls all the P-cores.

The script prints values to paste into `inference/models.env`. Do that, then:

```bash
pct exec 202 -- /opt/AIployee/llm-lab/inference/install-service.sh \
    workhorse --bind 10.0.0.202
```

### 2.2 Benchmark it

```bash
# From your workstation or the host
python3 llm-lab/bench/bench.py \
    --base-url http://10.0.0.202:8080 \
    --model workhorse \
    --prompt-tokens 512 --concurrency 1,2,4
```

Read the "WHAT THIS MEANS" section it prints. Write down:

```
decode tok/s (single stream)  : __________
prefill tok/s (implied)       : __________
throughput at concurrency 4   : __________
```

### 2.3 The decision point

| If decode is… | Then… |
|---|---|
| **> 10 tok/s** | Excellent. Keep the 30B MoE as your workhorse. Proceed. |
| **5–10 tok/s** | Usable for batch and for chat you're patient with. Consider making the 4B model your default for interactive use and the MoE for hard questions. |
| **< 5 tok/s** | Something is wrong, or this node is weaker than expected. Check: is it swapping (`free -g`)? Thermally throttling (run the bench twice — is the second run slower)? Did `--mlock` actually apply? If genuinely that slow, make the 4B your workhorse. |

Also check the concurrency scaling line. If throughput stops rising by
concurrency 4, you've hit the memory-bandwidth ceiling — that's your signal that
more throughput needs **more nodes**, not more slots.

> **Checkpoint 2.** You have real numbers for your hardware, and you've decided
> which model is your default.

---

## Phase 3 — Fan out to the other workers (30 min)

Now that node A works and the scripts are fixed, repeat. This part is boring,
which is the point.

For each of pve-3, pve-4 (workhorse replicas):

```bash
scp -r /path/to/AIployee root@10.0.0.203:/opt/
ssh root@10.0.0.203 '
  cd /opt/AIployee/llm-lab
  ./proxmox/create-lxc-inference.sh --ctid 203 --ip 10.0.0.203/24 --role workhorse
  pct exec 203 -- mkdir -p /opt
  tar -C /opt -cf - AIployee | pct exec 203 -- tar -C /opt -xf -
  pct exec 203 -- /opt/AIployee/llm-lab/inference/build-llama-cpp.sh
  pct exec 203 -- /opt/AIployee/llm-lab/inference/download-models.sh workhorse
  pct exec 203 -- /opt/AIployee/llm-lab/inference/install-service.sh workhorse --bind 10.0.0.203
'
```

**Save the 18 GB download per node.** Set up one node as a mirror and pull from
it over your LAN instead of the internet:

```bash
# On the node that already has the model
apt-get install -y rsync
# then on each new node, before download-models.sh:
export MODEL_MIRROR=rsync://10.0.0.202/models
```
(or simply `rsync -h --progress root@10.0.0.202:/var/lib/llm/models/*.gguf /var/lib/llm/models/`)

For **pve-5**, the fast lane — small model, many slots:

```bash
./proxmox/create-lxc-inference.sh --ctid 205 --ip 10.0.0.205/24 --role fast --memory 12288
pct exec 205 -- /opt/AIployee/llm-lab/inference/download-models.sh fast
pct exec 205 -- /opt/AIployee/llm-lab/inference/install-service.sh fast --bind 10.0.0.205

# Embeddings live here too -- they're tiny, and Timy needs them for its
# knowledge base. Keep them on CPU permanently, even after you buy a GPU.
pct exec 205 -- /opt/AIployee/llm-lab/inference/download-models.sh embed
pct exec 205 -- /opt/AIployee/llm-lab/inference/install-service.sh embed --bind 10.0.0.205
```

> **Checkpoint 3.** All of these return healthy:
> ```bash
> for ip in 10.0.0.202:8080 10.0.0.203:8080 10.0.0.204:8080 10.0.0.205:8081 10.0.0.205:8082; do
>   printf '%s -> ' "$ip"; curl -s -m 5 "http://$ip/health" || echo UNREACHABLE
>   echo
> done
> ```

---

## Phase 4 — The gateway (20 min)

One endpoint for everything, so your apps never learn which node served them.

### 4.1 Install Docker in a container on pve-1

```bash
ssh root@10.0.0.201
# A gateway container needs nesting for Docker; create it if you don't have one:
cd /opt/AIployee/llm-lab
./proxmox/create-lxc-inference.sh --ctid 201 --ip 10.0.0.201/24 \
    --role gateway --memory 6144 --disk 40

pct exec 201 -- bash -c 'curl -fsSL https://get.docker.com | sh'
```

### 4.2 Configure and start

```bash
pct enter 201
cd /opt/AIployee/llm-lab/gateway

cp .env.example .env
# Generate a real key -- you'll paste this into Timy later
echo "LITELLM_MASTER_KEY=sk-$(openssl rand -hex 24)" > .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
echo "GRAFANA_PASSWORD=$(openssl rand -hex 12)" >> .env
cat .env      # <-- WRITE DOWN THE LITELLM_MASTER_KEY

# Point it at your real worker IPs
nano litellm-config.yaml      # replace every 10.0.0.20x
nano prometheus.yml           # same

docker compose up -d
docker compose ps
```

> **Checkpoint 4.**
> ```bash
> KEY=sk-your-master-key
> curl -s http://10.0.0.201:4000/v1/models -H "Authorization: Bearer $KEY" | python3 -m json.tool
>
> curl -s http://10.0.0.201:4000/v1/chat/completions \
>   -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
>   -d '{"model":"workhorse","messages":[{"role":"user","content":"Which node are you on?"}],"max_tokens":30}'
> ```
> Run the second one several times — LiteLLM is spreading requests across your
> replicas. Then pull the plug on one worker (`pct stop 203`) and confirm
> requests still succeed. **That's your failover working.**

**If it breaks:**
- `connection refused` from the gateway to a worker → the worker is bound to the
  wrong interface. Check `--bind` used the container's LAN IP, not `127.0.0.1`.
- Postgres unhealthy → `docker compose logs postgres`; usually a stale volume
  from a previous password. `docker compose down -v` and up again.
- 401 → you're using the wrong key, or missing the `Bearer ` prefix.

---

## Phase 5 — Timy.ai (30 min)

This is the part that turns a model endpoint into your product.

### 5.1 Install

Timy lives on the gateway node — it's a lightweight web app, and keeping it off
the inference nodes means it never competes for their memory bandwidth.

```bash
pct enter 201
cd /opt/AIployee/timy

sudo ./install.sh \
    --upstream http://10.0.0.201:4000 \
    --api-key sk-your-master-key \
    --port 8090
```

Open `http://10.0.0.201:8090` in a browser on your LAN.

> **Checkpoint 5.** The sidebar shows a green dot and "cluster online". Ask it
> something and watch tokens stream in, with real timings under the answer.

**If it breaks:**
- Green dot but "cluster unreachable" → Timy is running, the gateway isn't
  reachable. Check `--upstream` and `curl` the gateway from inside container 201.
- `knowledge: off (embedding model unreachable)` → expected until Phase 5.3.
  Timy works fine without it.
- 502/blank page → `journalctl -u timy -n 40 --no-pager`.

### 5.2 Make Timy yours

This is the actual product work, and it's a text file:

```bash
nano /opt/AIployee/timy/persona.md
systemctl restart timy
```

`persona.md` is Timy's character, tone, rules, and boundaries. Editing it *is*
how you change Timy — no retraining, no fine-tuning. Keep it in git so you can
diff a personality change and roll it back like any other code change.

Start from the shipped version and adjust:
- **Voice** — how formal? How long are answers by default?
- **Domain** — what is Timy for? A narrower brief produces better answers than a
  general one, especially on a smaller model.
- **Refusals** — what should it decline, and how?
- **Honesty rules** — the shipped persona tells Timy to say "I don't know"
  plainly. Keep something like that; it is the single highest-value instruction
  for a smaller model.

Iterate: edit, restart, ask five questions you care about, repeat. Twenty
minutes here is worth more than any amount of model tuning.

### 5.3 Give Timy your knowledge

```bash
cp ~/your-docs/*.md /opt/AIployee/timy/knowledge/
curl -X POST http://localhost:8090/api/knowledge/reload
```

Timy embeds them with the model on pve-5, retrieves the relevant chunks per
question, and cites the source filename. This is what makes it *yours* rather
than a generic chatbot.

Good candidates: internal handbooks, process docs, FAQ content, policy
documents, product notes. Markdown with clear `##` headings works best — the
chunker splits on headings, and a chunk that knows what section it's from
produces far better citations.

**Check retrieval before blaming the model.** If Timy cites the wrong document:

```bash
curl -sX POST http://localhost:8090/api/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"a real question you care about"}' | python3 -m json.tool
```

Right document with a low score → lower `TIMY_KNOWLEDGE_MIN_SCORE` in
`/etc/timy.env`. Wrong document with a high score → your chunks are too big or
your documents overlap; reduce `TIMY_CHUNK_CHARS` and add clearer headings.

### 5.4 Start collecting your eval set

Use Timy for real work for a week, and press thumbs-up/down on answers. Those
land in `/opt/AIployee/timy/data/feedback.jsonl`.

That file is the most valuable thing this whole build produces. Real questions
from real users with a judgement attached is an eval set you cannot buy, and
it's the only honest way to tell whether a persona edit or a model swap actually
helped rather than just felt different. **Back it up.** It's worth more than the
model weights, which you can re-download.

> **Checkpoint 5 (complete).** Timy answers from your documents, with citations,
> in your voice, on your hardware. That's the product.

---

## Phase 6 — Make it durable (20 min)

Everything works. Now make sure it survives a reboot and you notice when it
doesn't.

### 6.1 Reboot test

The honest test. Reboot a worker node and confirm everything comes back with no
intervention:

```bash
pct reboot 202
sleep 180
curl -s http://10.0.0.202:8080/health && echo " <- came back clean"
```

`onboot 1` and the systemd units should handle it. If not, fix it now rather
than discovering it during a power cut.

### 6.2 Watch the three numbers that matter

Grafana is at `http://10.0.0.201:3000` (admin / the password in `.env`).
Dashboards are fun; alert on these three:

1. **Tokens/sec per node, trending.** A node dropping from 20 to 4 tok/s is
   swapping or thermally throttling. The most useful metric on the cluster.
2. **Queue depth at the gateway.** Rising = under-provisioned. Your scale-out
   signal.
3. **Resident memory vs node RAM.** Early warning for OOM. Should be flat;
   growth over hours means a KV cache problem.

### 6.3 Find your thermal ceiling before it finds you

Mini PCs were not designed for hours of all-core load. They throttle — often
30–40% — with **no error in any log**. Symptoms: throughput fine for ten
minutes, poor for the next two hours.

```bash
# Run a sustained load and watch both numbers
python3 llm-lab/bench/bench.py --base-url http://10.0.0.201:4000 \
    --api-key sk-... --model workhorse --concurrency 4 --requests 200 &
watch -n 10 'sensors 2>/dev/null | grep -i core; cat /sys/class/thermal/thermal_zone*/temp'
```

If throughput falls as temperature rises, that's your answer. Fixes that work:
space the units out instead of stacking them, improve ambient airflow, and
consider capping threads slightly *below* physical cores — 6 threads at full
clock often beats 8 throttled.

### 6.4 Back up the things that matter

```bash
# Configs and prompts: small, irreplaceable
cd /opt/AIployee && git add -A && git commit -m "working cluster config" && git push

# Feedback / eval data: irreplaceable
rsync -a /opt/AIployee/timy/data/ backup-host:/backups/timy-data/

# Containers: cheap snapshots. EXCLUDE the model directory or your backups
# become enormous for no benefit -- weights are re-downloadable.
vzdump 201 --storage local --mode snapshot --exclude-path /var/lib/llm/models
```

> **Checkpoint 6.** A node reboot recovers unattended, you can see tokens/sec in
> Grafana, and your configs and feedback data are backed up.

---

## Phase 6b — Optional: Coolify for the app tier (40 min)

Skip this on your first pass. Come back once Phases 1–6 are working — debugging
a PaaS and a llama.cpp flag rename at the same time is two unfamiliar failure
modes at once.

**What Coolify gives you here:** push-to-deploy on `persona.md` (which shortens
the loop where most of Timy's value gets made), managed TLS so it's
`https://timy.yourdomain` not `http://10.0.0.201:8090`, secrets in a UI instead
of `/etc/timy.env`, readable logs, and one-click rollback when a persona edit
makes Timy worse.

**What it must not touch:** the `llama.cpp` workers. They stay LXC + systemd.
Docker fights `--mlock`, native-ISA builds, and P-core pinning, and Coolify's
"recreate the container on deploy" behaviour is wrong for a process that takes
minutes to fault 18 GB into page cache. Full reasoning in
`llm-lab/docs/07-coolify-and-self-hosted-git.md`.

### 6b.1 Host it in a VM, not an LXC

Coolify's installer assumes a normal Ubuntu host with Docker. Docker-in-LXC
works but you'll fight cgroups and overlayfs for no benefit.

```bash
# On pve-6 or a spare node -- NEVER on an inference worker: a build job at full
# tilt steals exactly the memory bandwidth your workers need.
qm create 210 --name coolify --cores 4 --cpu host --memory 8192 --balloon 0 \
  --net0 virtio,bridge=vmbr0 --scsihw virtio-scsi-single \
  --scsi0 local-lvm:80,discard=on,ssd=1 --ostype l26 --agent enabled=1 --onboot 1
```

Install Ubuntu 24.04 LTS, then run Coolify's installer — check
`coolify.io/docs` for the current command rather than trusting one pasted here.

### 6b.2 Deploy Timy through Coolify

In the Coolify UI: **New Resource → Docker Compose**, point it at your repo and
`timy/docker-compose.coolify.yml`. Then set these env vars in Coolify:

```
UPSTREAM_BASE_URL=http://10.0.0.201:4000
UPSTREAM_API_KEY=sk-your-gateway-key
```

The compose file declares `SERVICE_FQDN_TIMY_8090`, so Coolify assigns a domain
and terminates TLS for it. It also puts `data/` on a named volume — **that's
deliberate: your feedback log is your eval set, and losing it on a redeploy is
the worst kind of quiet data loss.**

Once it's up, stop the systemd copy so they don't both bind the port:

```bash
pct exec 201 -- systemctl disable --now timy
```

### 6b.3 Optional: get off GitHub entirely

Coolify is *not* a GitHub replacement — it deploys, it doesn't host code. The
GitHub replacement is **Gitea** or **Forgejo**, which you can also run as a
Coolify compose stack. That gives you a fully local
commit → build → deploy loop.

**Before you do this, know the trade-off:** a Claude Code session on
claude.ai/code can reach GitHub but *cannot* reach a Gitea on your LAN — same
network reason as `llm-lab/docs/06`. So going Gitea-only means no remote Claude
sessions on the repo, no GitHub CI, no review from your phone.

The setup that keeps both — Gitea authoritative, GitHub as a push mirror:

```bash
git remote set-url origin ssh://git@10.0.0.206:2222/hakeem/aiployee.git
git remote set-url --add --push origin ssh://git@10.0.0.206:2222/hakeem/aiployee.git
git remote set-url --add --push origin git@github.com:Hakeemshaik/AIployee.git
git remote -v      # one fetch URL, two push URLs
```

Or configure it server-side in Gitea: **Settings → Mirror Settings → Push
Mirror**.

**Then back Gitea up and test a restore the same day.** GitHub is someone else's
backup problem; a self-hosted Gitea is yours, and a dead disk with no verified
restore means the history is gone.

> **Checkpoint 6b.** A commit to `persona.md` triggers a redeploy, Timy comes
> back on its domain over HTTPS, and `data/feedback.jsonl` still has your
> earlier feedback in it.

---

## Phase 7 — What to do next

In the order that pays best:

1. **Move batch work onto the cluster.** Transcript scoring, import cleaning,
   field extraction — latency-insensitive, parallel, and currently costing you
   hosted tokens every month. `llm-lab/workloads/batch_extract.py` is a working,
   schema-validated, resumable runner. This is the fastest payback available.

2. **Run your prompt regression suites locally.** Free unlimited inference
   changes the economics of testing: run the full scenario bank on every prompt
   change instead of once before shipping. Filter locally, confirm hosted —
   `llm-lab/docs/05-operations.md` explains why that split is honest.

3. **Leave live voice alone for now.** Run `make voice-check` to see your real
   numbers, but the arithmetic in `llm-lab/docs/03-voice-latency-reality.md`
   says CPU-only is marginal — roughly 1–2 concurrent calls at 1.2–2.0 s per
   turn. Build the local pipeline as a POPIA demo, keep production hosted, and
   revisit when the GPU lands.

4. **When the GPU arrives**, read `llm-lab/docs/04-gpu-upgrade-path.md` first.
   The short version: mini PCs have no x16 slot, so plan on one tower node, aim
   for 24 GB VRAM, and keep embeddings and STT/TTS on the minis. Send me the
   spec and I'll give you the build flags and the revised voice budget.

---

## Quick reference

```bash
# Health of everything
for ip in 10.0.0.202:8080 10.0.0.203:8080 10.0.0.204:8080 10.0.0.205:8081 10.0.0.205:8082; do
  printf '%-22s ' "$ip"; curl -s -m 5 "http://$ip/health" && echo || echo UNREACHABLE
done
curl -s http://10.0.0.201:4000/health/liveliness; echo
curl -s http://10.0.0.201:8090/api/health | python3 -m json.tool

# Logs
pct exec 202 -- journalctl -u llama-workhorse -f
pct exec 201 -- journalctl -u timy -f
pct exec 201 -- bash -c 'cd /opt/AIployee/llm-lab/gateway && docker compose logs -f litellm'

# Restart a model server after changing models.env
pct exec 202 -- /opt/AIployee/llm-lab/inference/install-service.sh workhorse --bind 10.0.0.202

# Reload Timy after editing persona.md or knowledge/
pct exec 201 -- systemctl restart timy
pct exec 201 -- curl -sX POST http://localhost:8090/api/knowledge/reload

# Re-measure after any change
python3 llm-lab/bench/bench.py --base-url http://10.0.0.201:4000 --api-key sk-... --model workhorse
```

## The five things most likely to go wrong

1. **A renamed llama.cpp flag** stops `llama-server` starting. Check
   `llama-server --help`, fix `inference/install-service.sh`. Most likely
   failure in this entire tutorial.
2. **A moved Hugging Face repo/filename** 404s the download. Search HF, update
   `inference/models.env`.
3. **`--bind 127.0.0.1`** makes a worker invisible to the gateway. Always bind
   the container's LAN IP.
4. **OOM under load, hours later**, once all slots fill. Lower `*_CTX` or
   `*_SLOTS`; both scale KV cache linearly.
5. **Thermal throttling** looks exactly like "the software got slower". Check
   temperature before you debug anything else.
