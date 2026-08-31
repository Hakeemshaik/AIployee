#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Generate and install a systemd unit for llama-server for a given role.
#
#   ./install-service.sh workhorse --bind 10.0.0.201
#   ./install-service.sh fast      --bind 10.0.0.205
#
# The rationale for each flag is in the comments below. systemd does not run
# ExecStart through a shell, so the argument list is assembled here and emitted
# as one clean line -- the reasoning lives in this script, not in the unit.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=models.env
source "${HERE}/models.env"

ROLE="${1:-workhorse}"; shift || true
BIND="${BIND_HOST}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bind) BIND="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

# On a 16 GB node the 18 GB MoE cannot fit; WORKHORSE_TIER=16gb selects the
# smaller registry entry instead. Auto-detected below if not set explicitly.
WORKHORSE_TIER="${WORKHORSE_TIER:-auto}"
if [[ "$WORKHORSE_TIER" == "auto" ]]; then
  _total_gb=$(free -g | awk '/^Mem:/{print $2}')
  [[ "${_total_gb:-99}" -lt 24 ]] && WORKHORSE_TIER="16gb" || WORKHORSE_TIER="full"
fi
if [[ "$ROLE" == "workhorse" && "$WORKHORSE_TIER" == "16gb" ]]; then
  WORKHORSE_FILE="$WORKHORSE16_FILE"; WORKHORSE_REPO="$WORKHORSE16_REPO"
  WORKHORSE_CTX="$WORKHORSE16_CTX"; WORKHORSE_SLOTS="$WORKHORSE16_SLOTS"
  echo "==> 16 GB node detected: using ${WORKHORSE_FILE} instead of the 30B MoE"
fi

case "$ROLE" in
  workhorse) FILE="$WORKHORSE_FILE"; CTX="$WORKHORSE_CTX"; SLOTS="$WORKHORSE_SLOTS"; PORT="$WORKHORSE_PORT" ;;
  fast)      FILE="$FAST_FILE";      CTX="$FAST_CTX";      SLOTS="$FAST_SLOTS";      PORT="$FAST_PORT" ;;
  embed)     FILE="$EMBED_FILE";     CTX="$EMBED_CTX";     SLOTS=4;                  PORT="$EMBED_PORT" ;;
  *) echo "usage: $0 workhorse|fast|embed [--bind IP]" >&2; exit 1 ;;
esac

MODEL_PATH="${MODEL_DIR}/${FILE}"
[[ -s "$MODEL_PATH" ]] || { echo "error: model not found: $MODEL_PATH (run download-models.sh $ROLE)" >&2; exit 1; }
command -v llama-server >/dev/null || { echo "error: llama-server not installed (run build-llama-cpp.sh)" >&2; exit 1; }

# --- Thread counts --------------------------------------------------------
# Decode threads = physical cores. Decode is memory-bandwidth-bound, so threads
# beyond what saturates bandwidth only add barrier contention.
if [[ "$THREADS" -eq 0 ]]; then
  sockets=$(lscpu | awk -F: '/^Socket\(s\)/ {gsub(/ /,"",$2); print $2}')
  per_socket=$(lscpu | awk -F: '/^Core\(s\) per socket/ {gsub(/ /,"",$2); print $2}')
  THREADS=$(( ${sockets:-1} * ${per_socket:-4} ))
fi
# Prefill threads may exceed decode threads: prefill is compute-bound and keeps
# scaling past the point where decode stops benefiting.
[[ "$THREADS_BATCH" -eq 0 ]] && THREADS_BATCH="$(nproc)"

echo "==> role=$ROLE model=$FILE ctx=$CTX slots=$SLOTS port=$PORT"
echo "==> threads: decode=$THREADS prefill=$THREADS_BATCH"

mkdir -p "$SLOT_CACHE_DIR"

# --- Assemble the argument list ------------------------------------------
ARGS=(
  --model "$MODEL_PATH"
  --alias "$ROLE"
  --host "$BIND"
  --port "$PORT"

  # Context sized to real prompts, not to the model maximum. KV cache scales
  # linearly with ctx x slots and is the usual cause of a late-firing OOM.
  --ctx-size "$CTX"
  --parallel "$SLOTS"

  --threads "$THREADS"
  --threads-batch "$THREADS_BATCH"

  # Quantised KV cache: roughly halves KV memory for negligible quality cost.
  # One of the highest-value settings on CPU.
  --cache-type-k "$KV_TYPE"
  --cache-type-v "$KV_TYPE"

  # Reduces attention memory traffic. Modest win on CPU, grows with context.
  --flash-attn auto

  # Keep weights resident. With swap=0 on the container, this means the model
  # is never paged out mid-request.
  --mlock

  # Continuous batching lets slots share prefill/decode passes -- what turns
  # N slots into real concurrency instead of N serial queues.
  --cont-batching

  # Prometheus metrics for the dashboards in docs/05-operations.md.
  --metrics
)

if [[ "$ROLE" == "embed" ]]; then
  # Embedding servers produce vectors, not tokens: no generation, and pooling
  # to get one vector per input rather than one per token.
  ARGS+=( --embedding --pooling cls )
else
  # Prefix KV cache persistence. This is what makes multi-turn affordable on
  # CPU: turn two prefills only the genuinely new tokens instead of re-reading
  # the entire system prompt. Essential for voice -- see docs/03.
  ARGS+=( --slot-save-path "$SLOT_CACHE_DIR" --cache-reuse 256 )
fi

# Optional speculative decoding: a tiny draft model proposes tokens that the
# big model verifies in one batched pass. Worth ~1.5-2x on predictable or
# structured output where the guesses land, roughly nothing on open-ended text,
# and it costs RAM for the second model. Benchmark before trusting it.
if [[ "$DRAFT_ENABLED" == "1" && -s "${MODEL_DIR}/${DRAFT_FILE}" ]]; then
  ARGS+=( --model-draft "${MODEL_DIR}/${DRAFT_FILE}" --draft-max 16 --draft-min 4 )
  echo "==> speculative decoding enabled with ${DRAFT_FILE}"
fi

# Quote every argument for systemd's parser.
EXEC_ARGS=""
for a in "${ARGS[@]}"; do EXEC_ARGS+=" \"${a}\""; done

# CPU pinning on hybrid P-core/E-core CPUs. llama.cpp joins all worker threads
# at a barrier each step, so a single slow E-core stalls every other thread --
# restricting to P-cores is frequently faster despite using fewer cores.
# tune.sh measures this; set CPU_AFFINITY in models.env once you know.
if [[ -n "$CPU_AFFINITY" ]]; then
  AFFINITY_LINE="CPUAffinity=${CPU_AFFINITY}"
else
  AFFINITY_LINE="# CPUAffinity=0-7    # set from inference/tune.sh results"
fi

UNIT="/etc/systemd/system/llama-${ROLE}.service"
cat > "$UNIT" <<UNITFILE
# Generated by llm-lab inference/install-service.sh -- do not edit by hand.
# Change inference/models.env and re-run the script instead.
[Unit]
Description=llama.cpp server (${ROLE}: ${FILE})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# What makes --mlock work. Without it llama-server falls back to unpinned
# pages and the kernel may evict model pages under memory pressure.
LimitMEMLOCK=infinity
LimitNOFILE=65535
${AFFINITY_LINE}

ExecStart=/usr/local/bin/llama-server${EXEC_ARGS}

Restart=always
RestartSec=10
# Loading the model reads many GB from disk; don't let systemd give up early.
TimeoutStartSec=600
OOMPolicy=stop

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/llm

[Install]
WantedBy=multi-user.target
UNITFILE

systemctl daemon-reload
systemctl enable "llama-${ROLE}.service" >/dev/null
systemctl restart "llama-${ROLE}.service"

echo "==> waiting for health endpoint on ${BIND}:${PORT} (model load reads GB from disk)"
ok=0
for _ in $(seq 1 120); do
  if curl -fsS "http://${BIND}:${PORT}/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done

if [[ $ok -eq 1 ]]; then
  echo "==> healthy: http://${BIND}:${PORT}"
  rss=$(ps -o rss= -C llama-server 2>/dev/null | awk '{s+=$1} END {printf "%.1f", s/1024/1024}')
  total=$(free -g | awk '/^Mem:/{print $2}')
  echo "==> resident: ${rss:-?} GiB of ${total} GiB"
  echo "    Re-check this after changing --ctx-size or --parallel. Both scale KV"
  echo "    cache linearly, and it is easy to configure an OOM that only fires"
  echo "    hours later, once all slots have actually filled."
else
  echo "==> NOT healthy after 10 minutes." >&2
  echo "    journalctl -u llama-${ROLE} -n 80 --no-pager" >&2
  echo "    Most common causes: a flag renamed by a llama.cpp upgrade, or OOM." >&2
  exit 1
fi
