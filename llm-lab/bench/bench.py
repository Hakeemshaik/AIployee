#!/usr/bin/env python3
"""
Measure what this cluster actually does, so you can stop trusting estimates.

Reports, per configuration:
  TTFT      time to first token  -- dominated by prefill; sets voice viability
  TPOT      time per output token -- dominated by memory bandwidth
  decode    tokens/sec on the generation phase
  e2e       total wall clock for the request
  throughput aggregate tokens/sec across all concurrent requests

The distinction between TTFT and TPOT is the whole point. They have different
bottlenecks (compute vs memory bandwidth), they respond to different tuning
knobs, and a single "tokens/sec" number hides both. See docs/02 and docs/03.

Usage:
  ./bench.py --base-url http://10.0.0.200:4000 --model workhorse
  ./bench.py --base-url http://10.0.0.201:8080 --concurrency 1,2,4,8
  ./bench.py --base-url ... --prompt-tokens 2000 --json results.json

Only needs the standard library -- nothing to install on a fresh container.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field, asdict

# A filler paragraph used to synthesise prompts of a target token length.
# Deliberately prose rather than repeated tokens: repeated text compresses in
# ways that make prefill look artificially fast.
FILLER = (
    "The account holder was contacted regarding the outstanding balance on the "
    "property levy account. The representative explained the current arrears "
    "position, the total balance owing, and the number of months the account "
    "has been in arrears. Payment options were discussed including a debit "
    "order arrangement and a partial settlement. "
)


@dataclass
class Sample:
    ttft: float = 0.0          # seconds to first token
    e2e: float = 0.0           # seconds total
    out_tokens: int = 0
    prompt_tokens: int = 0
    ok: bool = False
    error: str = ""

    @property
    def decode_tps(self) -> float:
        """Tokens/sec during generation only, excluding the prefill wait."""
        gen_time = self.e2e - self.ttft
        if gen_time <= 0 or self.out_tokens <= 1:
            return 0.0
        return (self.out_tokens - 1) / gen_time

    @property
    def tpot_ms(self) -> float:
        d = self.decode_tps
        return 1000.0 / d if d > 0 else 0.0


@dataclass
class Result:
    label: str
    concurrency: int
    prompt_tokens: int
    max_tokens: int
    samples: list = field(default_factory=list)
    wall: float = 0.0

    def ok_samples(self):
        return [s for s in self.samples if s.ok]

    def summary(self) -> dict:
        good = self.ok_samples()
        if not good:
            errs = {s.error for s in self.samples if s.error}
            return {
                "label": self.label,
                "concurrency": self.concurrency,
                "failed": len(self.samples),
                "errors": sorted(errs)[:3],
            }

        def pct(values, p):
            vs = sorted(values)
            if not vs:
                return 0.0
            k = min(len(vs) - 1, int(round((p / 100.0) * (len(vs) - 1))))
            return vs[k]

        ttfts = [s.ttft for s in good]
        decodes = [s.decode_tps for s in good]
        total_out = sum(s.out_tokens for s in good)

        return {
            "label": self.label,
            "concurrency": self.concurrency,
            "prompt_tokens": self.prompt_tokens,
            "requests": len(good),
            "failed": len(self.samples) - len(good),
            "ttft_ms_p50": round(pct(ttfts, 50) * 1000, 1),
            "ttft_ms_p95": round(pct(ttfts, 95) * 1000, 1),
            "decode_tps_p50": round(statistics.median(decodes), 2),
            "tpot_ms_p50": round(1000 / statistics.median(decodes), 1)
                            if statistics.median(decodes) > 0 else 0,
            "e2e_s_p50": round(pct([s.e2e for s in good], 50), 2),
            # Aggregate throughput: what the node delivers in total, which is
            # the number that matters for batch work.
            "throughput_tps": round(total_out / self.wall, 2) if self.wall > 0 else 0,
        }


def build_prompt(target_tokens: int) -> str:
    """Approximate a token count. ~4 chars/token is close enough for sizing."""
    target_chars = max(40, target_tokens * 4)
    reps = target_chars // len(FILLER) + 1
    return (FILLER * reps)[:target_chars]


def one_request(base_url: str, model: str, api_key: str, prompt: str,
                max_tokens: int, timeout: float) -> Sample:
    """One streaming chat completion, timing first token separately."""
    s = Sample()
    body = json.dumps({
        "model": model,
        "messages": [
            # Stable system prefix first, variable content last -- the ordering
            # that lets prefix caching work. See docs/03.
            {"role": "system", "content": "You are a concise assistant."},
            {"role": "user", "content": prompt + "\n\nSummarise the above in two sentences."},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.0,   # deterministic, so runs are comparable
        "stream": True,
    }).encode()

    req = urllib.request.Request(
        base_url.rstrip("/") + "/v1/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}" if api_key else "",
        },
        method="POST",
    )

    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                if delta.get("content"):
                    if s.out_tokens == 0:
                        s.ttft = time.perf_counter() - start
                    s.out_tokens += 1
                usage = chunk.get("usage") or {}
                if usage.get("prompt_tokens"):
                    s.prompt_tokens = usage["prompt_tokens"]
        s.e2e = time.perf_counter() - start
        s.ok = s.out_tokens > 0
        if not s.ok:
            s.error = "stream produced no content"
    except urllib.error.HTTPError as e:
        s.error = f"HTTP {e.code}: {e.read()[:200].decode('utf-8', 'replace')}"
    except Exception as e:  # noqa: BLE001 -- report, don't crash the sweep
        s.error = f"{type(e).__name__}: {e}"
    return s


def run_level(base_url, model, api_key, prompt, max_tokens, concurrency,
              requests_per_level, timeout, label) -> Result:
    res = Result(label=label, concurrency=concurrency,
                 prompt_tokens=len(prompt) // 4, max_tokens=max_tokens)
    lock = threading.Lock()
    pending = list(range(requests_per_level))

    def worker():
        while True:
            with lock:
                if not pending:
                    return
                pending.pop()
            s = one_request(base_url, model, api_key, prompt, max_tokens, timeout)
            with lock:
                res.samples.append(s)

    t0 = time.perf_counter()
    threads = [threading.Thread(target=worker, daemon=True) for _ in range(concurrency)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    res.wall = time.perf_counter() - t0
    return res


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", required=True,
                    help="gateway or llama-server, e.g. http://10.0.0.200:4000")
    ap.add_argument("--model", default="workhorse")
    ap.add_argument("--api-key", default="", help="required if going via the gateway")
    ap.add_argument("--concurrency", default="1,2,4",
                    help="comma-separated levels to sweep")
    ap.add_argument("--prompt-tokens", type=int, default=512,
                    help="synthetic prompt size; use ~2000 to model a voice agent")
    ap.add_argument("--max-tokens", type=int, default=128)
    ap.add_argument("--requests", type=int, default=0,
                    help="requests per level (default: 3x concurrency)")
    ap.add_argument("--timeout", type=float, default=600.0)
    ap.add_argument("--json", metavar="PATH", help="write raw results here")
    args = ap.parse_args()

    levels = [int(x) for x in args.concurrency.split(",") if x.strip()]
    prompt = build_prompt(args.prompt_tokens)

    print(f"target      : {args.base_url}  model={args.model}")
    print(f"prompt      : ~{args.prompt_tokens} tokens ({len(prompt)} chars)")
    print(f"max_tokens  : {args.max_tokens}")
    print(f"concurrency : {levels}")
    print()

    # Warm-up: the first request pays for model load, page-cache misses, and an
    # empty prefix cache. Including it would poison every number.
    print("warming up (first request pays for cold cache and is discarded)...")
    warm = one_request(args.base_url, args.model, args.api_key, prompt,
                       16, args.timeout)
    if not warm.ok:
        print(f"\nERROR: warm-up request failed: {warm.error}", file=sys.stderr)
        print("Check the endpoint is up:  curl " +
              args.base_url.rstrip('/') + "/v1/models", file=sys.stderr)
        return 1
    print(f"  ok (ttft {warm.ttft*1000:.0f} ms)\n")

    results = []
    hdr = (f"{'conc':>5}  {'reqs':>5}  {'fail':>5}  {'ttft p50':>9}  "
           f"{'ttft p95':>9}  {'decode':>9}  {'tpot':>8}  {'e2e p50':>8}  {'total':>10}")
    print(hdr)
    print("-" * len(hdr))

    for c in levels:
        n = args.requests or max(3, c * 3)
        r = run_level(args.base_url, args.model, args.api_key, prompt,
                      args.max_tokens, c, n, args.timeout, f"c{c}")
        s = r.summary()
        results.append(s)
        if s.get("requests"):
            print(f"{s['concurrency']:>5}  {s['requests']:>5}  {s['failed']:>5}  "
                  f"{s['ttft_ms_p50']:>8.0f}m  {s['ttft_ms_p95']:>8.0f}m  "
                  f"{s['decode_tps_p50']:>7.1f}/s  {s['tpot_ms_p50']:>6.0f}ms  "
                  f"{s['e2e_s_p50']:>7.2f}s  {s['throughput_tps']:>7.1f}/s")
        else:
            print(f"{c:>5}  ALL FAILED: {'; '.join(s.get('errors', []))[:80]}")

    print()
    interpret(results, args)

    if args.json:
        with open(args.json, "w") as f:
            json.dump({"config": vars(args), "results": results}, f, indent=2)
        print(f"\nraw results written to {args.json}")
    return 0


def interpret(results, args):
    """Turn the numbers into the decisions they imply."""
    good = [r for r in results if r.get("requests")]
    if not good:
        return

    base = good[0]
    print("=" * 72)
    print("WHAT THIS MEANS")
    print("=" * 72)

    ttft = base["ttft_ms_p50"]
    decode = base["decode_tps_p50"]

    print(f"\nSingle-stream: {decode:.1f} tok/s decode, {ttft:.0f} ms TTFT at "
          f"~{args.prompt_tokens} prompt tokens.")

    # Prefill rate is the number that decides voice viability.
    if ttft > 0:
        prefill_rate = args.prompt_tokens / (ttft / 1000.0)
        print(f"Implied prefill rate: ~{prefill_rate:.0f} tok/s.")
        print(f"  -> a cold 2000-token voice prompt would cost "
              f"~{2000/prefill_rate:.1f} s before the first word.")
        print("     This is why prefix caching is mandatory for voice (docs/03).")

    # Human reading speed is ~4 tok/s; speech is ~3-4 tok/s. Below that, the
    # agent cannot keep up with its own speech.
    if decode < 4:
        print(f"\n  [!] {decode:.1f} tok/s is below conversational speech rate "
              "(~3-4 tok/s).")
        print("      Not viable for voice at all. Use a smaller model or an MoE "
              "(docs/02).")
    elif decode < 10:
        print(f"\n  [~] {decode:.1f} tok/s sustains speech but leaves no margin. "
              "Batch work only.")
    else:
        print(f"\n  [+] {decode:.1f} tok/s is comfortable for streaming text and "
              "batch work.")

    # Does concurrency actually buy throughput, or just queue?
    if len(good) > 1:
        print("\nScaling with concurrency:")
        for r in good:
            eff = r["throughput_tps"] / base["throughput_tps"] if base["throughput_tps"] else 0
            print(f"  c={r['concurrency']:<3} throughput {r['throughput_tps']:>6.1f} tok/s "
                  f"({eff:.2f}x)  ttft p95 {r['ttft_ms_p95']:>6.0f} ms")
        top = good[-1]
        eff = (top["throughput_tps"] / base["throughput_tps"]) / top["concurrency"] \
              if base["throughput_tps"] else 0
        print()
        if eff > 0.7:
            print(f"  Concurrency scales well ({eff:.0%} efficiency at "
                  f"c={top['concurrency']}). Raise --parallel and batch harder.")
        elif eff > 0.4:
            print(f"  Partial scaling ({eff:.0%} at c={top['concurrency']}). "
                  "You are approaching the memory-bandwidth ceiling.")
        else:
            print(f"  Poor scaling ({eff:.0%} at c={top['concurrency']}). Memory "
                  "bandwidth is saturated -- concurrency is now just queueing.")
            print("  More throughput needs MORE NODES, not more slots (docs/01).")

        ttft_growth = top["ttft_ms_p95"] / base["ttft_ms_p95"] if base["ttft_ms_p95"] else 1
        if ttft_growth > 3:
            print(f"  [!] TTFT p95 grew {ttft_growth:.1f}x under load. Anything "
                  "latency-sensitive needs its own dedicated node.")

    print("\nNext: bench/voice-budget.py turns these numbers into a per-turn "
          "voice latency budget.")


if __name__ == "__main__":
    sys.exit(main())
