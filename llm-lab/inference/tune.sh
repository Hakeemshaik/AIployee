#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Find the best thread count and CPU affinity for THIS node, by measurement.
#
# Two questions this answers, both of which have counter-intuitive answers on
# modern Intel mini PCs:
#
#   1. How many decode threads? More is not better. Decode is memory-bandwidth
#      bound, so past the point where bandwidth saturates, extra threads only
#      add barrier-synchronisation overhead.
#
#   2. All cores, or P-cores only? On hybrid CPUs (12th-gen Intel and later),
#      llama.cpp splits work evenly and waits for every thread at a barrier.
#      An E-core running at 60% of P-core speed makes every P-core wait for it.
#      Using FEWER, faster cores is frequently the higher-throughput choice.
#
# Writes the winning values as a snippet you can paste into models.env.
#
#   ./tune.sh [--model /path/to.gguf] [--reps 3]
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=models.env
source "${HERE}/models.env"

MODEL="${MODEL_DIR}/${FAST_FILE}"   # tune with the small model: same shape, faster sweep
REPS=3
OUT="${HERE}/tune-results.tsv"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --reps)  REPS="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

command -v llama-bench >/dev/null || { echo "error: llama-bench not found (run build-llama-cpp.sh)" >&2; exit 1; }
[[ -s "$MODEL" ]] || { echo "error: model not found: $MODEL" >&2; exit 1; }

NPROC=$(nproc)
sockets=$(lscpu | awk -F: '/^Socket\(s\)/ {gsub(/ /,"",$2); print $2}')
per_socket=$(lscpu | awk -F: '/^Core\(s\) per socket/ {gsub(/ /,"",$2); print $2}')
PHYS=$(( ${sockets:-1} * ${per_socket:-4} ))

# --- Detect hybrid topology ----------------------------------------------
# On Intel hybrid parts the P-cores have a higher max frequency than the
# E-cores. Group logical CPUs by max frequency; the top group is the P-cores.
PCORES=""
if [[ -r /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq ]]; then
  mapfile -t freqs < <(
    for c in /sys/devices/system/cpu/cpu[0-9]*; do
      n="${c##*cpu}"
      f=$(cat "$c/cpufreq/cpuinfo_max_freq" 2>/dev/null || echo 0)
      echo "$n $f"
    done | sort -k2 -n
  )
  distinct=$(printf '%s\n' "${freqs[@]}" | awk '{print $2}' | sort -un | wc -l)
  if [[ "$distinct" -gt 1 ]]; then
    top=$(printf '%s\n' "${freqs[@]}" | awk '{print $2}' | sort -un | tail -1)
    PCORES=$(printf '%s\n' "${freqs[@]}" | awk -v t="$top" '$2==t {print $1}' | sort -n | paste -sd, -)
    echo "==> hybrid CPU detected. P-core logical CPUs: ${PCORES}"
  fi
fi

[[ -z "$PCORES" ]] && echo "==> uniform CPU topology (no P/E split detected)"
echo "==> logical=${NPROC} physical=${PHYS} model=$(basename "$MODEL")"
echo

# Candidate thread counts: bracket the physical core count, since that is
# where the bandwidth ceiling usually sits.
CANDIDATES=()
for t in $((PHYS/2)) $((PHYS-2)) $((PHYS-1)) "$PHYS" $((PHYS+2)) "$NPROC"; do
  [[ "$t" -ge 2 && "$t" -le "$NPROC" ]] && CANDIDATES+=("$t")
done
# de-duplicate, preserve order
mapfile -t CANDIDATES < <(printf '%s\n' "${CANDIDATES[@]}" | awk '!seen[$0]++')

printf 'affinity\tthreads\tpp_tok_s\ttg_tok_s\n' > "$OUT"

run_bench() {
  local label="$1" threads="$2"; shift 2
  local pin=("$@")
  # -p 512 measures prompt processing (prefill), -n 128 measures generation
  # (decode). They have different bottlenecks, so both matter.
  local json
  if ! json=$("${pin[@]}" llama-bench \
        --model "$MODEL" \
        --threads "$threads" \
        -p 512 -n 128 \
        --repetitions "$REPS" \
        --output json 2>/dev/null); then
    echo "    (bench failed for ${label} t=${threads})" >&2
    return 0
  fi
  local pp tg
  pp=$(printf '%s' "$json" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(0); sys.exit()
v=[r.get("avg_ts",0) for r in d if r.get("n_prompt",0)>0 and r.get("n_gen",0)==0]
print(round(v[0],2) if v else 0)')
  tg=$(printf '%s' "$json" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(0); sys.exit()
v=[r.get("avg_ts",0) for r in d if r.get("n_gen",0)>0]
print(round(v[0],2) if v else 0)')
  printf '%s\t%s\t%s\t%s\n' "$label" "$threads" "$pp" "$tg" | tee -a "$OUT"
}

echo "==> sweeping thread counts across all cores"
for t in "${CANDIDATES[@]}"; do
  run_bench "all" "$t"
done

if [[ -n "$PCORES" ]]; then
  NPC=$(( $(printf '%s' "$PCORES" | tr -cd ',' | wc -c) + 1 ))
  echo
  echo "==> sweeping P-cores only (${NPC} logical CPUs: ${PCORES})"
  for t in $((NPC/2)) $((NPC-1)) "$NPC"; do
    [[ "$t" -ge 2 ]] || continue
    run_bench "pcores" "$t" taskset -c "$PCORES"
  done
fi

echo
echo "================================ results ================================"
column -t -s $'\t' "$OUT"
echo

python3 - "$OUT" "$PCORES" <<'PY'
import sys, csv
rows=[]
with open(sys.argv[1]) as f:
    for r in csv.DictReader(f, delimiter='\t'):
        try:
            r['tg']=float(r['tg_tok_s']); r['pp']=float(r['pp_tok_s'])
        except ValueError:
            continue
        if r['tg']>0: rows.append(r)
if not rows:
    print("No successful benchmark runs. Check that llama-bench works:")
    print("  llama-bench --model <model> -p 512 -n 128")
    sys.exit(1)

pcores = sys.argv[2] if len(sys.argv)>2 else ""

# Decode rate is what users feel on every token, so optimise -t for it.
best_tg = max(rows, key=lambda r: r['tg'])
# Prefill sets time-to-first-token, so optimise -tb separately.
best_pp = max(rows, key=lambda r: r['pp'])

print(f"Best decode  (sets tokens/sec):  {best_tg['tg']:>7.2f} tok/s  "
      f"@ threads={best_tg['threads']} affinity={best_tg['affinity']}")
print(f"Best prefill (sets TTFT):        {best_pp['pp']:>7.2f} tok/s  "
      f"@ threads={best_pp['threads']} affinity={best_pp['affinity']}")
print()

# Did pinning to P-cores actually win?
alls=[r for r in rows if r['affinity']=='all']
pcs =[r for r in rows if r['affinity']=='pcores']
if pcs and alls:
    ba=max(alls, key=lambda r:r['tg'])['tg']
    bp=max(pcs,  key=lambda r:r['tg'])['tg']
    delta=(bp-ba)/ba*100 if ba else 0
    if delta > 3:
        print(f"P-core pinning WINS by {delta:.1f}% on decode. This is the E-core")
        print("barrier-stall effect -- fewer fast cores beating more mixed ones.")
    elif delta < -3:
        print(f"P-core pinning LOSES by {abs(delta):.1f}%. Use all cores; the extra")
        print("E-core throughput outweighs the barrier cost on this part.")
    else:
        print(f"P-core pinning is a wash ({delta:+.1f}%). Prefer all cores for")
        print("simplicity, or pin anyway to leave E-cores free for STT/TTS.")
    print()

print("--- paste into inference/models.env, then re-run install-service.sh ---")
print(f'THREADS={best_tg["threads"]}')
print(f'THREADS_BATCH={best_pp["threads"]}')
if best_tg['affinity']=='pcores' and pcores:
    print(f'CPU_AFFINITY="{pcores}"')
else:
    print('CPU_AFFINITY=""')
print("-----------------------------------------------------------------------")
print()
print("Caveat: llama-bench runs a single stream. If you serve many concurrent")
print("slots, re-check with bench/run-suite.sh under real concurrency -- the")
print("optimum shifts down as slots contend for the same memory bandwidth.")
PY

echo
echo "raw results: $OUT"
