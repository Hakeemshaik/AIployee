#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Full benchmark sweep. Run this before you believe any number in the docs.
#
#   ./run-suite.sh --base-url http://10.0.0.201:4000 --api-key sk-...
#   ./run-suite.sh --base-url http://10.0.0.202:8080          # a single worker
#
# Produces a report directory with JSON per scenario plus a summary.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL=""
API_KEY=""
MODELS="workhorse,fast"
OUTDIR="${HERE}/results"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --api-key)  API_KEY="$2"; shift 2 ;;
    --models)   MODELS="$2"; shift 2 ;;
    --outdir)   OUTDIR="$2"; shift 2 ;;
    -h|--help)  sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$BASE_URL" ]] || { echo "error: --base-url is required" >&2; exit 1; }
mkdir -p "$OUTDIR"

# Scenarios chosen to isolate the two different bottlenecks:
#   short prompt  -> decode-dominated, shows the memory-bandwidth ceiling
#   long prompt   -> prefill-dominated, shows the TTFT you would face on voice
#   batch         -> aggregate throughput, the number that matters for bulk work
run() {
  local model="$1" label="$2" ptoks="$3" maxtok="$4" conc="$5"
  local out="${OUTDIR}/${model}-${label}.json"
  echo
  echo "########################################################################"
  echo "# ${model} / ${label}: prompt=${ptoks} tok, max_tokens=${maxtok}, conc=${conc}"
  echo "########################################################################"
  python3 "${HERE}/bench.py" \
    --base-url "$BASE_URL" \
    ${API_KEY:+--api-key "$API_KEY"} \
    --model "$model" \
    --prompt-tokens "$ptoks" \
    --max-tokens "$maxtok" \
    --concurrency "$conc" \
    --json "$out" || echo "  (scenario failed -- continuing)"
}

IFS=',' read -ra MODEL_LIST <<< "$MODELS"
for m in "${MODEL_LIST[@]}"; do
  # Short interactive request: what a chat turn feels like.
  run "$m" "short"  256  128 "1,2,4"
  # Voice-shaped request: a realistic system prompt, cold cache.
  run "$m" "voice"  2000  64 "1,2"
  # Transcript-shaped request: the batch workload this cluster is for.
  run "$m" "batch"  2000 512 "1,4,8"
done

echo
echo "========================================================================"
echo "SUMMARY"
echo "========================================================================"
python3 - "$OUTDIR" <<'PY'
import json, sys, pathlib
outdir = pathlib.Path(sys.argv[1])
files = sorted(outdir.glob("*.json"))
if not files:
    print("no results found"); sys.exit(0)

hdr = f"{'scenario':<26}{'conc':>5}{'ttft p50':>11}{'decode':>10}{'throughput':>12}"
print(hdr); print("-"*len(hdr))
voice = {}
for f in files:
    try: d = json.load(open(f))
    except Exception: continue
    for r in d.get("results", []):
        if not r.get("requests"): continue
        print(f"{f.stem:<26}{r['concurrency']:>5}{r['ttft_ms_p50']:>10.0f}m"
              f"{r['decode_tps_p50']:>9.1f}/s{r['throughput_tps']:>10.1f}/s")
        if "voice" in f.stem and r["concurrency"] == 1:
            voice[f.stem] = (f, d)

print()
for stem, (f, d) in voice.items():
    print(f"Voice budget for {stem}:")
    print(f"  python3 bench/voice-budget.py {f}")
PY

echo
echo "Results in: $OUTDIR"
echo "Then run:   python3 ${HERE}/voice-budget.py ${OUTDIR}/<model>-voice.json"
