#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Read-only inventory of a Proxmox host. Changes nothing. Run it on each node.
#
#   ./preflight.sh              # human-readable report
#   ./preflight.sh --paste      # markdown block to paste back into a chat
#
# This is the zero-risk first step: it tells you (and me) exactly what the
# hardware is, so container sizing, thread counts and model tier are decided
# from facts instead of assumptions.
# ---------------------------------------------------------------------------
set -uo pipefail   # deliberately no -e: a missing optional tool must not abort

PASTE=0
[[ "${1:-}" == "--paste" ]] && PASTE=1

ok()   { printf '  \033[32m+\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31mx\033[0m %s\n' "$*"; }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$*"; }

# --- Collect ---------------------------------------------------------------
HOSTNAME_=$(hostname)
PVE_VER=$(pveversion 2>/dev/null | head -1 || echo "not a Proxmox host")
KERNEL=$(uname -r)

CPU_MODEL=$(lscpu | sed -n 's/^Model name: *//p' | head -1)
SOCKETS=$(lscpu | awk -F: '/^Socket\(s\)/ {gsub(/ /,"",$2); print $2}')
CORES_PER=$(lscpu | awk -F: '/^Core\(s\) per socket/ {gsub(/ /,"",$2); print $2}')
THREADS_PER=$(lscpu | awk -F: '/^Thread\(s\) per core/ {gsub(/ /,"",$2); print $2}')
LOGICAL=$(nproc)
PHYSICAL=$(( ${SOCKETS:-1} * ${CORES_PER:-0} ))
[[ "$PHYSICAL" -eq 0 ]] && PHYSICAL=$LOGICAL

# ISA extensions decide how fast prompt processing runs.
FLAGS=$(grep -m1 '^flags' /proc/cpuinfo | cut -d: -f2)
have() { grep -qw "$1" <<<"$FLAGS" && echo yes || echo no; }
AVX2=$(have avx2); AVX512=$(have avx512f); AVXVNNI=$(have avx_vnni); AMX=$(have amx_tile)

# Hybrid P/E detection by max frequency spread.
PCORES=""; HYBRID="no"
if [[ -r /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq ]]; then
  mapfile -t FREQS < <(
    for c in /sys/devices/system/cpu/cpu[0-9]*; do
      printf '%s %s\n' "${c##*cpu}" "$(cat "$c/cpufreq/cpuinfo_max_freq" 2>/dev/null || echo 0)"
    done | sort -k2 -n)
  DISTINCT=$(printf '%s\n' "${FREQS[@]}" | awk '{print $2}' | sort -un | grep -cv '^0$')
  if [[ "$DISTINCT" -gt 1 ]]; then
    HYBRID="yes"
    TOP=$(printf '%s\n' "${FREQS[@]}" | awk '{print $2}' | sort -un | tail -1)
    PCORES=$(printf '%s\n' "${FREQS[@]}" | awk -v t="$TOP" '$2==t {print $1}' | sort -n | paste -sd, -)
  fi
fi

MEM_TOTAL=$(free -g | awk '/^Mem:/{print $2}')
MEM_AVAIL=$(free -g | awk '/^Mem:/{print $7}')
SWAP_USED=$(free -m | awk '/^Swap:/{print $3}')

KSM="unknown"
if systemctl is-active --quiet ksmtuned 2>/dev/null; then KSM="RUNNING"; else KSM="off"; fi
THP=$(sed -n 's/.*\[\(.*\)\].*/\1/p' /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo unknown)

DEFAULT_IF=$(ip route 2>/dev/null | awk '/^default/ {print $5; exit}')
GATEWAY_IP=$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')
HOST_CIDR=$(ip -4 -o addr show "${DEFAULT_IF:-lo}" 2>/dev/null | awk '{print $4; exit}')
BRIDGES=$(ip -o link show type bridge 2>/dev/null | awk -F': ' '{print $2}' | paste -sd, -)

# --- Report ----------------------------------------------------------------
if [[ $PASTE -eq 0 ]]; then
printf '\033[1m=== llm-lab preflight: %s ===\033[0m\n' "$HOSTNAME_"

hdr "Platform"
echo "  $PVE_VER"
echo "  kernel $KERNEL"

hdr "CPU"
echo "  $CPU_MODEL"
echo "  ${PHYSICAL} physical cores / ${LOGICAL} logical (${THREADS_PER:-?} threads per core)"
[[ "$AVX2"    == yes ]] && ok "AVX2"          || bad "no AVX2 -- inference will be very slow on this node"
[[ "$AVX512"  == yes ]] && ok "AVX-512"       || warn "no AVX-512 (fine, AVX2 carries most of the win)"
[[ "$AVXVNNI" == yes ]] && ok "AVX-VNNI"      || true
[[ "$AMX"     == yes ]] && ok "AMX (excellent -- big prompt-processing gain)" || true
if [[ "$HYBRID" == yes ]]; then
  NPC=$(( $(tr -cd ',' <<<"$PCORES" | wc -c) + 1 ))
  warn "hybrid P/E cores. P-cores (${NPC}): ${PCORES}"
  echo "      -> llama.cpp barriers on every thread, so one slow E-core stalls all."
  echo "         inference/tune.sh measures whether pinning to P-cores wins."
else
  ok "uniform core topology (no P/E split)"
fi

hdr "Memory"
echo "  ${MEM_TOTAL} GB total, ${MEM_AVAIL} GB available"
if   [[ "$MEM_AVAIL" -ge 28 ]]; then ok  "fits the 30B MoE workhorse (~26 GB resident)"
elif [[ "$MEM_AVAIL" -ge 14 ]]; then warn "fits a mid-size model, not the 30B MoE. Use --role fast here."
else                                 bad "under 14 GB free -- too little for a useful model"; fi
[[ "${SWAP_USED:-0}" -gt 0 ]] && warn "swap in use (${SWAP_USED} MB). Inference nodes must never swap."

hdr "Host tuning"
[[ "$KSM" == "off" ]] && ok "KSM off" || bad "ksmtuned RUNNING -- burns memory bandwidth. systemctl disable --now ksmtuned"
[[ "$THP" == "always" || "$THP" == "madvise" ]] && ok "transparent hugepages: $THP" || warn "transparent hugepages: $THP"

hdr "Network"
echo "  interface ${DEFAULT_IF:-?}  host ${HOST_CIDR:-?}  gateway ${GATEWAY_IP:-?}"
echo "  bridges: ${BRIDGES:-none found}"
if curl -sf --max-time 8 -o /dev/null https://huggingface.co 2>/dev/null; then
  ok "internet reachable (can download model weights)"
else
  bad "cannot reach huggingface.co -- model download will fail"
fi

hdr "Storage"
if command -v pvesm >/dev/null 2>&1; then
  pvesm status 2>/dev/null | awk 'NR==1{printf "  %-16s %-10s %10s\n","NAME","TYPE","AVAIL(GB)"} \
    NR>1 && $3=="active"{printf "  %-16s %-10s %10.0f\n",$1,$2,$6/1024/1024}'
else
  df -h / | tail -1 | awk '{printf "  root filesystem: %s avail\n",$4}'
fi

hdr "Guests and free IDs"
if command -v pct >/dev/null 2>&1; then
  echo "  containers:"; pct list 2>/dev/null | sed 's/^/    /' | head -12
  echo "  VMs:";        qm list  2>/dev/null | sed 's/^/    /' | head -12
  USED=$( { pct list 2>/dev/null | awk 'NR>1{print $1}'; qm list 2>/dev/null | awk 'NR>1{print $1}'; } | sort -n)
  FREE=""
  for i in $(seq 200 260); do grep -qx "$i" <<<"$USED" || FREE+="$i "; [[ $(wc -w <<<"$FREE") -ge 6 ]] && break; done
  ok "free CTIDs: ${FREE:-none in 200-260}"
else
  warn "pct not found -- is this a Proxmox host?"
fi

hdr "Verdict for this node"
if [[ "$AVX2" == yes && "$MEM_AVAIL" -ge 28 ]]; then
  echo "  Good workhorse node. Run:"
  echo "    ./bootstrap.sh --role workhorse"
elif [[ "$AVX2" == yes && "$MEM_AVAIL" -ge 12 ]]; then
  echo "  Good fast-lane / embeddings node. Run:"
  echo "    ./bootstrap.sh --role fast"
else
  echo "  Use this node for the gateway or data services, not inference."
  echo "    ./bootstrap.sh --role gateway"
fi
echo

else
# --- Paste-friendly markdown ----------------------------------------------
STORAGE_LINE=$(pvesm status 2>/dev/null | awk '$3=="active"{printf "%s(%.0fG) ",$1,$6/1024/1024}')
USED=$( { pct list 2>/dev/null | awk 'NR>1{print $1}'; qm list 2>/dev/null | awk 'NR>1{print $1}'; } | sort -n | paste -sd, -)
cat <<MD
| field | value |
|---|---|
| host | ${HOSTNAME_} |
| pve | ${PVE_VER} |
| cpu | ${CPU_MODEL} |
| cores | ${PHYSICAL} physical / ${LOGICAL} logical |
| isa | avx2=${AVX2} avx512=${AVX512} vnni=${AVXVNNI} amx=${AMX} |
| hybrid | ${HYBRID}${PCORES:+ (P-cores: ${PCORES})} |
| ram | ${MEM_TOTAL}G total / ${MEM_AVAIL}G avail |
| ksm | ${KSM} |
| thp | ${THP} |
| net | if=${DEFAULT_IF} host=${HOST_CIDR} gw=${GATEWAY_IP} bridges=${BRIDGES} |
| storage | ${STORAGE_LINE:-unknown} |
| used ids | ${USED:-none} |
MD
fi
