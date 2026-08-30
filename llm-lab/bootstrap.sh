#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-command setup. Run on a Proxmox host, as root.
#
#   ./bootstrap.sh --role workhorse           # detect everything, show plan, confirm
#   ./bootstrap.sh --role fast --yes          # no prompts
#   ./bootstrap.sh --role workhorse --dry-run # print the plan and stop
#
# Auto-detects: physical cores, free RAM, subnet and gateway, a free CTID, a
# free IP, storage, and hybrid P/E layout -- then sizes the container, builds
# llama.cpp for this exact CPU, fetches weights, installs the service, and
# verifies with a real completion request.
#
# Safe to re-run: it detects an existing container and resumes rather than
# clobbering it.
# ---------------------------------------------------------------------------
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"

ROLE="workhorse"
CTID=""; IPADDR=""; GATEWAY=""; BRIDGE=""; STORAGE=""; MEMORY=""; DISK=""
ASSUME_YES=0; DRY_RUN=0; SKIP_MODEL=0

C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_B=$'\033[1m'; C_0=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$C_B" "$C_0" "$*"; }
ok()   { printf '  %s+%s %s\n' "$C_OK" "$C_0" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_WARN" "$C_0" "$*"; }
die()  { printf '\n%serror:%s %s\n' "$C_ERR" "$C_0" "$*" >&2; exit 1; }

usage() { sed -n '2,18p' "$0"; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)     ROLE="$2"; shift 2 ;;
    --ctid)     CTID="$2"; shift 2 ;;
    --ip)       IPADDR="$2"; shift 2 ;;
    --gw)       GATEWAY="$2"; shift 2 ;;
    --bridge)   BRIDGE="$2"; shift 2 ;;
    --storage)  STORAGE="$2"; shift 2 ;;
    --memory)   MEMORY="$2"; shift 2 ;;
    --disk)     DISK="$2"; shift 2 ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --skip-model) SKIP_MODEL=1; shift ;;
    -h|--help)  usage ;;
    *) die "unknown argument: $1  (try --help)" ;;
  esac
done

case "$ROLE" in workhorse|fast|embed|gateway) ;; *) die "--role must be workhorse, fast, embed or gateway" ;; esac

# ---------------------------------------------------------------------------
# Helpers (pure where possible, so they can be tested off-host)
# ---------------------------------------------------------------------------

# Lowest unused ID in a range, given a newline list of used IDs.
next_free_ctid() {
  local used="$1" start="${2:-200}" end="${3:-299}" i
  for ((i=start; i<=end; i++)); do
    grep -qx "$i" <<<"$used" || { echo "$i"; return 0; }
  done
  return 1
}

# Is something alive at this address? Uses whatever signals are available:
# arping is the most reliable on a LAN (works even where ICMP is filtered),
# then ping, then an existing ARP entry.
PROBE_METHOD=""
probe_alive() {
  local ip="$1"
  case "$PROBE_METHOD" in
    arping) arping -c1 -w1 -I "$PROBE_IF" "$ip" >/dev/null 2>&1 && return 0 ;;
    ping)   ping -c1 -W1 "$ip" >/dev/null 2>&1 && return 0 ;;
  esac
  # An ARP entry with a hardware address means a real host answered recently.
  ip neigh show "$ip" 2>/dev/null | grep -q 'lladdr' && return 0
  return 1
}

# Establish that we can actually detect a live host before trusting "free".
# Without this check, a missing ping binary or a firewall that drops ICMP makes
# EVERY address look free -- and bootstrap would hand out a duplicate IP.
probe_init() {
  local known_live="$1" iface="${2:-}"
  PROBE_IF="$iface"
  if command -v arping >/dev/null 2>&1 && [[ -n "$iface" ]]; then
    PROBE_METHOD="arping"
    arping -c1 -w1 -I "$iface" "$known_live" >/dev/null 2>&1 && return 0
  fi
  if command -v ping >/dev/null 2>&1; then
    PROBE_METHOD="ping"
    ping -c1 -W1 "$known_live" >/dev/null 2>&1 && return 0
  fi
  PROBE_METHOD=""
  return 1   # caller must refuse to auto-assign
}

# First address in a range that nothing responds at. Skips the host's own
# last octet. Returns 2 if the probe method is untrustworthy.
next_free_ip() {
  local prefix="$1" self_last="$2" start="${3:-200}" end="${4:-250}" i ip
  [[ -n "$PROBE_METHOD" ]] || return 2
  for ((i=start; i<=end; i++)); do
    [[ "$i" == "$self_last" ]] && continue
    ip="${prefix}.${i}"
    probe_alive "$ip" || { echo "$ip"; return 0; }
  done
  return 1
}

# Container RAM: leave the host headroom, and cap by what the role needs.
size_memory() {
  local avail_gb="$1" role="$2" want
  case "$role" in
    workhorse) want=28 ;;
    fast)      want=12 ;;
    embed)     want=6  ;;
    gateway)   want=6  ;;
  esac
  # Never take more than available minus 4 GB of host headroom.
  local cap=$(( avail_gb - 4 ))
  (( cap < want )) && want=$cap
  (( want < 4 )) && want=0     # 0 signals "not enough RAM"
  echo $(( want * 1024 ))
}

size_disk() {
  case "$1" in
    workhorse) echo 120 ;;
    fast)      echo 60  ;;
    embed)     echo 40  ;;
    gateway)   echo 40  ;;
  esac
}

# Only run the real work if this is being executed, not sourced for tests.
[[ "${BASH_SOURCE[0]}" != "${0}" ]] && return 0

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
printf '%s=== llm-lab bootstrap (%s) ===%s\n' "$C_B" "$ROLE" "$C_0"

[[ $EUID -eq 0 ]] || die "must run as root"
command -v pct >/dev/null || die "pct not found. Run this ON the Proxmox host, not inside a container."

say "detecting hardware"
SOCKETS=$(lscpu | awk -F: '/^Socket\(s\)/ {gsub(/ /,"",$2); print $2}')
CORES_PER=$(lscpu | awk -F: '/^Core\(s\) per socket/ {gsub(/ /,"",$2); print $2}')
PHYSICAL=$(( ${SOCKETS:-1} * ${CORES_PER:-0} )); [[ $PHYSICAL -eq 0 ]] && PHYSICAL=$(nproc)
MEM_AVAIL=$(free -g | awk '/^Mem:/{print $7}')
CPU_MODEL=$(lscpu | sed -n 's/^Model name: *//p' | head -1)
grep -qw avx2 /proc/cpuinfo || warn "no AVX2 on this CPU -- inference will be very slow"
ok "${CPU_MODEL}"
ok "${PHYSICAL} physical cores, ${MEM_AVAIL} GB RAM available"

say "detecting network"
DEFAULT_IF=$(ip route | awk '/^default/ {print $5; exit}')
[[ -n "$GATEWAY" ]] || GATEWAY=$(ip route | awk '/^default/ {print $3; exit}')
[[ -n "$GATEWAY" ]] || die "could not detect the default gateway; pass --gw"
HOST_CIDR=$(ip -4 -o addr show "$DEFAULT_IF" | awk '{print $4; exit}')
HOST_IP="${HOST_CIDR%%/*}"; MASK="${HOST_CIDR##*/}"
PREFIX="${HOST_IP%.*}"; SELF_LAST="${HOST_IP##*.}"
[[ -n "$BRIDGE" ]] || BRIDGE=$(ip -o link show type bridge 2>/dev/null | awk -F': ' '{print $2; exit}')
[[ -n "$BRIDGE" ]] || BRIDGE="vmbr0"
ok "host ${HOST_CIDR} on ${DEFAULT_IF}, gateway ${GATEWAY}, bridge ${BRIDGE}"

[[ "$MASK" == "24" ]] || warn "host is /${MASK}; auto IP selection assumes /24. Pass --ip to be certain."

say "choosing identifiers"
if [[ -z "$CTID" ]]; then
  USED=$( { pct list 2>/dev/null | awk 'NR>1{print $1}'; qm list 2>/dev/null | awk 'NR>1{print $1}'; } | sort -n )
  CTID=$(next_free_ctid "$USED") || die "no free CTID in 200-299; pass --ctid"
fi
RESUMING=0
if pct status "$CTID" >/dev/null 2>&1; then
  RESUMING=1
  EXISTING_IP=$(pct config "$CTID" 2>/dev/null | sed -n 's/.*ip=\([0-9.]*\)\/.*/\1/p' | head -1)
  [[ -z "$IPADDR" && -n "$EXISTING_IP" ]] && IPADDR="${EXISTING_IP}/${MASK}"
  warn "CT ${CTID} already exists -- will resume inside it rather than recreate"
fi
if [[ -z "$IPADDR" ]]; then
  # Prove we can detect a live host before believing any address is free.
  # The gateway must answer -- if it does not, our probe is useless and
  # auto-assigning would risk a duplicate IP on your LAN.
  if ! probe_init "$GATEWAY" "$DEFAULT_IF"; then
    die "cannot verify whether an address is in use (no working arping/ping;
       the gateway ${GATEWAY} did not respond). Refusing to guess an IP --
       assigning a duplicate would break a live host.
       Pick a free address yourself and pass it:  --ip ${PREFIX}.210/${MASK}"
  fi
  say "scanning ${PREFIX}.200-250 via ${PROBE_METHOD} for a free address"
  FREE_IP=$(next_free_ip "$PREFIX" "$SELF_LAST")
  case $? in
    0) : ;;
    2) die "IP probe became unreliable mid-scan; pass --ip explicitly" ;;
    *) die "no free IP found in ${PREFIX}.200-250; pass --ip" ;;
  esac
  IPADDR="${FREE_IP}/${MASK}"
  ok "selected ${IPADDR} (nothing responded at it)"
fi
CT_IP="${IPADDR%%/*}"

[[ -n "$MEMORY" ]] || MEMORY=$(size_memory "$MEM_AVAIL" "$ROLE")
[[ "$MEMORY" -eq 0 ]] && die "only ${MEM_AVAIL} GB RAM available -- not enough for role '${ROLE}'"
[[ -n "$DISK" ]] || DISK=$(size_disk "$ROLE")

if [[ -z "$STORAGE" ]]; then
  # Prefer a storage that can hold container rootfs, with the most space free.
  STORAGE=$(pvesm status -content rootdir 2>/dev/null \
            | awk 'NR>1 && $3=="active" {print $6, $1}' | sort -rn | awk '{print $2; exit}')
  [[ -n "$STORAGE" ]] || STORAGE="local-lvm"
fi

DISK_AVAIL=$(pvesm status 2>/dev/null | awk -v s="$STORAGE" '$1==s {printf "%.0f", $6/1024/1024}')
if [[ -n "$DISK_AVAIL" && "$DISK_AVAIL" -lt "$DISK" ]]; then
  warn "storage '${STORAGE}' has ${DISK_AVAIL} GB free but the plan wants ${DISK} GB"
fi

case "$ROLE" in
  workhorse) PORT=8080; MODEL_NOTE="Qwen3-30B-A3B MoE, ~18 GB download" ;;
  fast)      PORT=8081; MODEL_NOTE="Qwen3-4B, ~3 GB download" ;;
  embed)     PORT=8082; MODEL_NOTE="bge-m3 embeddings, ~1 GB download" ;;
  gateway)   PORT=4000; MODEL_NOTE="no model -- Docker + LiteLLM stack" ;;
esac

# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------
cat <<PLAN

${C_B}PLAN${C_0}
  role            ${ROLE}
  container       CT ${CTID} $( [[ $RESUMING -eq 1 ]] && echo "(exists -- resuming)" || echo "(will be created)" )
  address         ${IPADDR}   gateway ${GATEWAY}   bridge ${BRIDGE}
  resources       $((MEMORY/1024)) GB RAM, ${PHYSICAL} cores, ${DISK} GB on ${STORAGE}
  model           ${MODEL_NOTE}
  service         http://${CT_IP}:${PORT}

  Steps: create container -> copy repo -> build llama.cpp (native ISA)
         -> download weights -> install systemd service -> verify a completion

  Time: 30-60 min, mostly the download and the compile.
PLAN

if [[ $DRY_RUN -eq 1 ]]; then
  echo; say "dry run -- nothing changed"; exit 0
fi

if [[ $ASSUME_YES -eq 0 ]]; then
  read -r -p "Proceed? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "aborted"; exit 0; }
fi

START=$(date +%s)
step() { printf '\n%s[%s]%s %s\n' "$C_B" "$(date +%H:%M:%S)" "$C_0" "$*"; }

# ---------------------------------------------------------------------------
# Host tuning (idempotent)
# ---------------------------------------------------------------------------
step "host tuning"
if systemctl is-active --quiet ksmtuned 2>/dev/null; then
  systemctl disable --now ksmtuned && ok "disabled ksmtuned (was burning memory bandwidth)"
else
  ok "ksmtuned already off"
fi
if [[ -w /sys/kernel/mm/transparent_hugepage/enabled ]]; then
  echo always > /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null && ok "transparent hugepages: always"
  grep -q transparent_hugepage /etc/kernel/cmdline 2>/dev/null || \
    warn "add 'transparent_hugepage=always' to the kernel cmdline to persist this across reboots"
fi

# ---------------------------------------------------------------------------
# Container
# ---------------------------------------------------------------------------
if [[ $RESUMING -eq 0 ]]; then
  step "creating container ${CTID}"
  "${HERE}/proxmox/create-lxc-inference.sh" \
      --ctid "$CTID" --ip "$IPADDR" --gw "$GATEWAY" --bridge "$BRIDGE" \
      --storage "$STORAGE" --memory "$MEMORY" --disk "$DISK" \
      --cores "$PHYSICAL" --role "$ROLE" \
    || die "container creation failed (see output above)"
else
  pct status "$CTID" | grep -q running || { say "starting CT ${CTID}"; pct start "$CTID"; sleep 5; }
fi

step "copying repo into the container"
pct exec "$CTID" -- mkdir -p /opt || die "cannot exec in CT ${CTID}"
tar -C "$(dirname "$REPO_ROOT")" -cf - "$(basename "$REPO_ROOT")" \
  | pct exec "$CTID" -- tar -C /opt -xf - || die "copying the repo failed"
IN_CT="/opt/$(basename "$REPO_ROOT")/llm-lab"
ok "repo at ${IN_CT} inside CT ${CTID}"

# ---------------------------------------------------------------------------
# Gateway role diverges here: Docker, not llama.cpp
# ---------------------------------------------------------------------------
if [[ "$ROLE" == "gateway" ]]; then
  step "installing Docker"
  pct exec "$CTID" -- bash -c 'command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh' \
    || die "Docker install failed"
  step "generating gateway secrets"
  pct exec "$CTID" -- bash -c "cd ${IN_CT}/gateway && [ -f .env ] || {
      echo \"LITELLM_MASTER_KEY=sk-\$(openssl rand -hex 24)\" >  .env
      echo \"POSTGRES_PASSWORD=\$(openssl rand -hex 16)\"     >> .env
      echo \"GRAFANA_PASSWORD=\$(openssl rand -hex 12)\"      >> .env
    }"
  KEY=$(pct exec "$CTID" -- bash -c "grep LITELLM_MASTER_KEY ${IN_CT}/gateway/.env | cut -d= -f2")
  cat <<EOF

${C_B}Gateway container is ready, but NOT started yet.${C_0}
Point it at your workers first -- it cannot guess their addresses:

  pct enter ${CTID}
  cd ${IN_CT}/gateway
  nano litellm-config.yaml     # replace the 10.0.0.20x addresses
  nano prometheus.yml          # same
  docker compose up -d

Your gateway API key (save this -- Timy needs it):
  ${KEY}
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Inference roles
# ---------------------------------------------------------------------------
step "building llama.cpp for this CPU (5-15 min)"
pct exec "$CTID" -- "${IN_CT}/inference/build-llama-cpp.sh" \
  || die "build failed. Retry with fewer jobs:  pct exec ${CTID} -- env JOBS=2 ${IN_CT}/inference/build-llama-cpp.sh"

if [[ $SKIP_MODEL -eq 0 ]]; then
  step "downloading weights (${MODEL_NOTE})"
  pct exec "$CTID" -- "${IN_CT}/inference/download-models.sh" "$ROLE" \
    || die "model download failed. If it 404'd, the HF repo moved -- update inference/models.env"
fi

step "installing and starting the service"
pct exec "$CTID" -- "${IN_CT}/inference/install-service.sh" "$ROLE" --bind "$CT_IP" \
  || die "service failed to start. Most likely a renamed llama.cpp flag.
       Check:  pct exec ${CTID} -- journalctl -u llama-${ROLE} -n 60 --no-pager
       Then compare against:  pct exec ${CTID} -- llama-server --help"

# ---------------------------------------------------------------------------
# Verify with a real request, not just a health check
# ---------------------------------------------------------------------------
step "verifying with a real completion"
RESP=$(curl -sS -m 180 "http://${CT_IP}:${PORT}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${ROLE}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: BOOTSTRAP OK\"}],\"max_tokens\":16,\"temperature\":0}" 2>&1)

if grep -q '"content"' <<<"$RESP"; then
  TEXT=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["choices"][0]["message"]["content"].strip())' <<<"$RESP" 2>/dev/null)
  ok "model replied: ${TEXT:-<empty>}"
else
  die "the service is up but did not return a completion. Response was:
${RESP:0:400}"
fi

RSS=$(pct exec "$CTID" -- bash -c "ps -o rss= -C llama-server 2>/dev/null | awk '{s+=\$1} END {printf \"%.1f\", s/1024/1024}'")
ELAPSED=$(( ($(date +%s) - START) / 60 ))

cat <<DONE

${C_OK}${C_B}=== ${ROLE} node ready in ${ELAPSED} min ===${C_0}

  endpoint    http://${CT_IP}:${PORT}
  container   CT ${CTID} on $(hostname)
  resident    ${RSS:-?} GB

Next:
  1. Tune this node from measurement (thread count, P-core pinning):
       pct exec ${CTID} -- ${IN_CT}/inference/tune.sh
     Paste the values it prints into ${IN_CT}/inference/models.env, then re-run:
       pct exec ${CTID} -- ${IN_CT}/inference/install-service.sh ${ROLE} --bind ${CT_IP}

  2. Benchmark, and let the numbers pick your model tier:
       python3 ${IN_CT}/bench/bench.py --base-url http://${CT_IP}:${PORT} --model ${ROLE}

  3. Repeat on the other nodes, then bring up the gateway:
       ./bootstrap.sh --role gateway

  Record this address -- the gateway config needs it: ${CT_IP}:${PORT}
DONE
