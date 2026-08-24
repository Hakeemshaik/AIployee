#!/usr/bin/env python3
"""
Turn measured LLM numbers into a verdict on live voice.

Reads the JSON that bench.py writes (or takes numbers directly) and builds the
per-turn latency budget from docs/03-voice-latency-reality.md, using YOUR
hardware's numbers instead of my estimates.

  ./bench.py --base-url http://10.0.0.205:8081 --model fast \
             --prompt-tokens 2000 --json fast.json
  ./voice-budget.py fast.json

  ./voice-budget.py --prefill-tps 350 --decode-tps 18

The point of separating this from bench.py: the LLM is only one of four serial
stages, and it is easy to celebrate a good tok/s number while the total turn
time is still 2 seconds.
"""
from __future__ import annotations

import argparse
import json
import sys

# Non-LLM stage costs, CPU-only. Ranges reflect what is realistically
# achievable, not best-case demos. Override on the command line if you have
# measured your own STT/TTS.
STAGES = {
    "vad":  ("End-of-turn detection", 150, 300,
             "Silero VAD is cheap, but a short silence threshold false-triggers "
             "mid-sentence. This is deliberate waiting -- not optimisable."),
    "stt":  ("STT finalise", 150, 400,
             "Streaming whisper.cpp/Parakeet transcribes as the caller speaks; "
             "only the tail needs finalising. Competes for the same cores."),
    "tts":  ("TTS first audio", 80, 200,
             "Piper on CPU has a real-time factor well under 0.1 and streams. "
             "This stage is genuinely fine."),
}

# Conversational tolerances.
GOOD_MS = 800      # feels natural
TOLERABLE_MS = 1200  # noticeably slow but survivable
# Speech consumes roughly 3-4 tokens/sec of generated text. Below that the
# agent literally cannot talk as fast as it is thinking.
SPEECH_TPS = 3.5


def load_from_bench(path: str):
    with open(path) as f:
        data = json.load(f)
    cfg = data.get("config", {})
    results = [r for r in data.get("results", []) if r.get("requests")]
    if not results:
        sys.exit(f"{path}: no successful results to read")
    # Use concurrency=1: voice is latency-bound, so the single-stream number is
    # the honest one. Concurrency makes it worse, never better.
    r = min(results, key=lambda x: x["concurrency"])
    ptoks = cfg.get("prompt_tokens") or r.get("prompt_tokens") or 512
    ttft_s = r["ttft_ms_p50"] / 1000.0
    prefill_tps = ptoks / ttft_s if ttft_s > 0 else 0
    return prefill_tps, r["decode_tps_p50"], r["ttft_ms_p95"] / 1000.0, ptoks


def band(ms: float) -> str:
    if ms <= GOOD_MS:
        return "GOOD"
    if ms <= TOLERABLE_MS:
        return "MARGINAL"
    return "TOO SLOW"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bench_json", nargs="?", help="output of bench.py --json")
    ap.add_argument("--prefill-tps", type=float, help="measured prompt-processing rate")
    ap.add_argument("--decode-tps", type=float, help="measured generation rate")
    ap.add_argument("--system-prompt-tokens", type=int, default=2000,
                    help="static prefix: policy, tone rules, dispute handling")
    ap.add_argument("--turn-tokens", type=int, default=40,
                    help="new tokens per turn (the caller's last utterance)")
    ap.add_argument("--reply-tokens", type=int, default=60,
                    help="agent reply length. Keep this small -- every token "
                         "costs wall clock on CPU")
    ap.add_argument("--stt-ms", type=float, help="override measured STT finalise")
    ap.add_argument("--tts-ms", type=float, help="override measured TTS first audio")
    ap.add_argument("--vad-ms", type=float, help="override VAD detection")
    args = ap.parse_args()

    if args.bench_json:
        prefill, decode, _p95, measured_ptoks = load_from_bench(args.bench_json)
        src = f"measured from {args.bench_json} (prompt ~{measured_ptoks} tokens)"
    elif args.prefill_tps and args.decode_tps:
        prefill, decode = args.prefill_tps, args.decode_tps
        src = "supplied on the command line"
    else:
        sys.exit("need either a bench.py JSON file or --prefill-tps and --decode-tps")

    if prefill <= 0 or decode <= 0:
        sys.exit("measured rates are zero -- check the bench run actually succeeded")

    def stage(key, override):
        name, lo, hi, note = STAGES[key]
        if override is not None:
            return name, override, override, note + " (overridden with your measurement)"
        return name, lo, hi, note

    vad = stage("vad", args.vad_ms)
    stt = stage("stt", args.stt_ms)
    tts = stage("tts", args.tts_ms)

    # LLM TTFT, warm cache: only the genuinely new tokens need prefilling,
    # because the static prefix's KV cache survives from the previous turn.
    llm_warm_ms = args.turn_tokens / prefill * 1000
    # LLM TTFT, cold cache (turn one): the entire prefix must be prefilled.
    llm_cold_ms = (args.system_prompt_tokens + args.turn_tokens) / prefill * 1000
    # Time to speak the whole reply, for the sentence-streaming check below.
    reply_ms = args.reply_tokens / decode * 1000

    print("=" * 74)
    print("VOICE TURN BUDGET")
    print("=" * 74)
    print(f"\nLLM rates: {src}")
    print(f"  prefill  {prefill:8.0f} tok/s   (sets time-to-first-token)")
    print(f"  decode   {decode:8.1f} tok/s   (sets how fast it can speak)")
    print(f"\nPrompt shape: {args.system_prompt_tokens} static prefix tokens, "
          f"{args.turn_tokens} new per turn, {args.reply_tokens}-token replies")

    rows = [
        (vad[0], vad[1], vad[2], vad[3]),
        (stt[0], stt[1], stt[2], stt[3]),
        ("LLM TTFT (warm prefix cache)", llm_warm_ms, llm_warm_ms,
         f"only the {args.turn_tokens} new tokens are prefilled -- requires "
         "--slot-save-path and a stable prefix"),
        (tts[0], tts[1], tts[2], tts[3]),
    ]

    print(f"\n{'stage':<32} {'best':>8} {'worst':>8}")
    print("-" * 74)
    for name, lo, hi, _ in rows:
        print(f"{name:<32} {lo:>7.0f}m {hi:>7.0f}m")
    best = sum(r[1] for r in rows)
    worst = sum(r[2] for r in rows)
    print("-" * 74)
    print(f"{'TOTAL per turn (warm)':<32} {best:>7.0f}m {worst:>7.0f}m"
          f"   -> {band(best)} / {band(worst)}")

    print(f"\nFirst turn (cold cache): LLM TTFT is {llm_cold_ms:.0f} ms instead of "
          f"{llm_warm_ms:.0f} ms,")
    cold_total = best - llm_warm_ms + llm_cold_ms
    print(f"  so turn one totals ~{cold_total:.0f} ms -> {band(cold_total)}")
    if cold_total > TOLERABLE_MS:
        print("  MITIGATION: pre-warm the slot with the system prompt while the")
        print("  call is still ringing, and hard-code the greeting. Never")
        print("  generate turn one. (docs/03, checklist items 5 and 6.)")

    print("\n" + "=" * 74)
    print("VERDICT")
    print("=" * 74)

    if decode < SPEECH_TPS:
        print(f"\n  NOT VIABLE. Decode is {decode:.1f} tok/s against a speech rate of")
        print(f"  ~{SPEECH_TPS} tok/s -- the agent cannot generate words as fast as it")
        print("  speaks them, so it will stutter and pause mid-sentence regardless")
        print("  of how good the TTFT is. Move to a smaller model (docs/02).")
    elif worst <= GOOD_MS:
        print(f"\n  VIABLE. Worst-case turn {worst:.0f} ms is inside the {GOOD_MS} ms")
        print("  natural-conversation window. Build it.")
    elif best <= TOLERABLE_MS:
        print(f"\n  MARGINAL. Best case {best:.0f} ms, worst case {worst:.0f} ms against a")
        print(f"  {GOOD_MS} ms target. Usable for demos and 1-2 concurrent calls;")
        print("  it will read as a laggy agent on production collections calls.")
        print("  Every item on the docs/03 checklist matters at this point.")
    else:
        print(f"\n  NOT VIABLE for live calls. Even the best case is {best:.0f} ms")
        print(f"  against a {GOOD_MS} ms target.")
        biggest = max(rows, key=lambda r: r[1])
        print(f"  Dominant stage: {biggest[0]} at {biggest[1]:.0f} ms.")
        if "LLM" in biggest[0]:
            print("  -> the LLM is the bottleneck: smaller model, or wait for the GPU.")
        else:
            print("  -> the LLM is NOT the bottleneck here. Fixing the model will")
            print("     not help; look at the stage above.")

    # Sentence streaming is the biggest perceived-latency win available.
    print(f"\nReply generation: {args.reply_tokens} tokens at {decode:.1f} tok/s = "
          f"{reply_ms:.0f} ms of speaking time.")
    if reply_ms > 1500:
        print("  Stream into TTS sentence-by-sentence -- do NOT wait for the full")
        print("  completion. Sending the first sentence the moment it is complete")
        print("  hides most of this and is the single biggest perceived-latency")
        print("  win available. (docs/03, checklist item 8.)")

    print(f"\nConcurrency: this budget is single-stream. Each additional concurrent")
    print("call contends for the same memory bandwidth, so re-measure with")
    print("bench.py --concurrency before promising more than one call per node.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        # Piping into head/less closes stdout early; that is not an error.
        sys.stderr.close()
        sys.exit(0)
