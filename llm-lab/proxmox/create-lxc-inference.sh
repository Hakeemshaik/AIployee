#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Create an unprivileged LXC container tuned for CPU LLM inference.
# RUN ON THE PROXMOX HOST (needs root and the `pct` command).
#
# Why LXC and not a VM, and why each of these settings: docs/01-architecture.md
#
#   ./create-lxc-inference.sh --ctid 201 --ip 10.0.0.201/24 --gw 10.0.0.1
# ---------------------------------------------------------------------------
set -euo pipefail

CTID=""; IPADDR=""; GATEWAY=""; CT_HOSTNAME=""
BRIDGE="vmbr0"
MEMORY=28672          # 28 GB. Leaves ~3.5 GB for the PVE host itself.
DISK=120              # GB. Two model files + logs + headroom.
CORES=0               # 0 = autodetect physical cores
STORAGE="local-lvm"
TEMPLATE=""
ROLE="workhorse"      # workhorse | fast | embed

die() { echo "error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid)     CTID="$2"; shift 2 ;;
    --ip)       IPADDR="$2"; shift 2 ;;
    --gw)       GATEWAY="$2"; shift 2 ;;
    --hostname) CT_HOSTNAME="$2"; shift 2 ;;
    --bridge)   BRIDGE="$2"; shift 2 ;;
    --memory)   MEMORY="$2"; shift 2 ;;
    --disk)     DISK="$2"; shift 2 ;;
    --cores)    CORES="$2"; shift 2 ;;
    --storage)  STORAGE="$2"; shift 2 ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --role)     ROLE="$2"; shift 2 ;;
    -h|--help)  sed -n '2,10p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ -n "$CTID"   ]] || die "--ctid is required"
[[ -n "$IPADDR" ]] || die "--ip is required (e.g. 10.0.0.201/24)"
command -v pct >/dev/null || die "pct not found -- run this on the Proxmox host, not inside a container"
[[ $EUID -eq 0 ]] || die "must run as root"
pct status "$CTID" >/dev/null 2>&1 && die "CTID $CTID already exists"

CT_HOSTNAME="${CT_HOSTNAME:-llm-${ROLE}-${CTID}}"
GATEWAY="${GATEWAY:-$(ip route | awk '/^default/ {print $3; exit}')}"
[[ -n "$GATEWAY" ]] || die "could not autodetect gateway; pass --gw"

# --- Physical core detection ----------------------------------------------
# Physical, not logical: hyperthreads share execution units and add contention
# on a memory-bandwidth-bound workload rather than throughput.
if [[ "$CORES" -eq 0 ]]; then
  sockets=$(lscpu | awk -F: '/^Socket\(s\)/ {gsub(/ /,"",$2); print $2}')
  per_socket=$(lscpu | awk -F: '/^Core\(s\) per socket/ {gsub(/ /,"",$2); print $2}')
  CORES=$(( ${sockets:-1} * ${per_socket:-4} ))
fi
echo "==> allocating $CORES cores, ${MEMORY} MiB RAM to CT $CTID ($CT_HOSTNAME)"

# --- Template -------------------------------------------------------------
if [[ -z "$TEMPLATE" ]]; then
  echo "==> refreshing template list"
  pveam update >/dev/null 2>&1 || true
  tmpl=$(pveam available --section system \
    | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)
  [[ -n "$tmpl" ]] || die "no debian-12 template found; pass --template"
  if ! pveam list local | grep -q "$tmpl"; then
    echo "==> downloading $tmpl"
    pveam download local "$tmpl"
  fi
  TEMPLATE="local:vztmpl/${tmpl}"
fi

# --- Create ---------------------------------------------------------------
# Deliberate choices (see docs/01-architecture.md):
#   unprivileged=1 : nothing here needs privilege
#   swap=0         : swapping a model file collapses throughput ~100x. A clean
#                    OOM beats a node that is alive but serving at 0.2 tok/s.
#   onboot=1       : inference should return after a host reboot
echo "==> creating container"
pct create "$CTID" "$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap 0 \
  --rootfs "${STORAGE}:${DISK}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=${IPADDR},gw=${GATEWAY}" \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --tags "llm;inference;${ROLE}" \
  --description "LLM inference (${ROLE}) -- managed by llm-lab"

CONF="/etc/pve/lxc/${CTID}.conf"

# --- No ballooning, and allow mlock --------------------------------------
# Ballooning either fails against an mlocked model or forces it out of page
# cache; re-faulting 18 GB mid-request turns a 2s response into a 40s one.
grep -q '^balloon:' "$CONF" || echo "balloon: 0" >> "$CONF"
cat >> "$CONF" <<'EOF'
# llama.cpp --mlock needs unlimited memlock to pin weights in RAM
lxc.prlimit.memlock = unlimited
EOF

echo "==> starting container"
pct start "$CTID"

echo "==> waiting for network"
for _ in $(seq 1 30); do
  pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break
  sleep 2
done

echo "==> installing base packages and applying guest tuning"
pct exec "$CTID" -- bash -eu <<'GUEST'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  build-essential cmake git curl ca-certificates pkg-config \
  libcurl4-openssl-dev python3 python3-pip python3-venv \
  numactl util-linux jq rsync

# Never trade model residency for swap -- see docs/05-operations.md
printf 'vm.swappiness=0\n' > /etc/sysctl.d/99-llm.conf
sysctl -p /etc/sysctl.d/99-llm.conf >/dev/null 2>&1 || true

mkdir -p /var/lib/llm/models /var/lib/llm/slots /opt/llm-lab
GUEST

cat <<EOF

==> Container $CTID ($CT_HOSTNAME) ready at ${IPADDR%%/*}

Host-side steps still needed on THIS Proxmox node:

  1. Disable KSM. It scans memory for duplicate pages, finds almost nothing in
     high-entropy model weights, and burns the exact resource you are short of
     (memory bandwidth):

       systemctl disable --now ksmtuned

  2. Enable transparent huge pages -- fewer TLB misses when walking gigabytes
     of weights per token:

       echo always > /sys/kernel/mm/transparent_hugepage/enabled
     Persist via kernel cmdline: transparent_hugepage=always

  3. Hybrid P-core/E-core CPU (12th-gen Intel or later)? Pin to P-cores.
     llama.cpp waits at a barrier for every thread, so one slow E-core stalls
     all of them; fewer fast cores often beats more mixed ones. Identify them:

       lscpu --extended
     then add to ${CONF} (example if cores 0-7 are P-cores):

       lxc.cgroup2.cpuset.cpus = 0-7

     inference/tune.sh measures both ways so you can decide from data.

Next, inside the container:

  pct push is per-file; easiest is to rsync the repo in, then:
    pct exec $CTID -- /opt/llm-lab/inference/build-llama-cpp.sh
    pct exec $CTID -- /opt/llm-lab/inference/download-models.sh ${ROLE}
    pct exec $CTID -- /opt/llm-lab/inference/install-service.sh ${ROLE} --bind ${IPADDR%%/*}
EOF
