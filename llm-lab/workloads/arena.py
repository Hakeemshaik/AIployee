#!/usr/bin/env python3
"""
Blind model arena -- find out which model is actually best for YOUR prompts.

Leaderboards rank models on someone else's tasks. This runs your own prompts
through several models, hides which is which, lets you pick a winner, and
reports win rates. The answer decides which model earns the RAM on your
workhorse nodes.

Two phases, deliberately separate:

  generate   all models answer every prompt, in batch. Slow on CPU -- go and
             do something else. Results are cached to disk.
  judge      you rate pairs, blind, at your own pace. Fast.

  ./arena.py generate --base-url http://192.168.1.201:4000 --api-key sk-... \\
             --models workhorse,fast --prompts my-prompts.txt
  ./arena.py judge
  ./arena.py report

The split matters: blind rating only works if you cannot see which model
produced what, and batching the slow part means you are never sat waiting on a
CPU generating tokens.

Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import textwrap
import time
import urllib.error
import urllib.request
from itertools import combinations
from pathlib import Path

DEFAULT_STORE = Path("arena-results.json")

# A starter prompt set. Replace it with YOUR real work -- that is the entire
# point. A model that wins on generic questions may lose badly on your
# transcripts, and vice versa.
STARTER_PROMPTS = [
    "Summarise this in two sentences: a tenant called about arrears of R4 200 "
    "across three months, disputed one month's charge, and agreed to pay R2 000 "
    "on the 25th.",
    "Extract JSON with fields outcome, amount, date from: 'I'll pay two "
    "thousand rand on the 25th of next month.'",
    "A customer says they already paid but our system shows arrears. Write a "
    "three-sentence reply that is polite and does not admit fault.",
    "Explain the difference between a promise to pay and a payment arrangement, "
    "in plain language, for a call centre agent.",
    "Rewrite this to be warmer without losing the deadline: 'Payment is overdue. "
    "Settle immediately to avoid handover.'",
]


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------

def complete(base_url: str, api_key: str, model: str, prompt: str,
             max_tokens: int, timeout: float) -> tuple[str, float]:
    """Return (text, seconds). Non-streaming: we only want the finished answer."""
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        # A little warmth, but fixed across models so the comparison is fair.
        "temperature": 0.3,
    }).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + "/v1/chat/completions", data=body,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {api_key}"} if api_key else {})},
        method="POST")
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"].strip(), time.perf_counter() - t0


def cmd_generate(args) -> int:
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    if len(models) < 2:
        sys.exit("need at least two models to compare")

    if args.prompts:
        prompts = [p.strip() for p in Path(args.prompts).read_text().split("\n\n") if p.strip()]
    else:
        prompts = STARTER_PROMPTS
        print("note: using the built-in starter prompts. Replace them with your\n"
              "      real work (--prompts file.txt, blank line between prompts)\n"
              "      -- a model that wins on generic questions may lose on yours.\n")

    store = json.loads(args.store.read_text()) if args.store.exists() else {}
    store.setdefault("answers", {})
    store.setdefault("votes", [])
    store["models"] = sorted(set(store.get("models", [])) | set(models))

    todo = [(pi, m) for pi, _ in enumerate(prompts) for m in models
            if f"{pi}|{m}" not in store["answers"]]
    print(f"{len(prompts)} prompts x {len(models)} models = "
          f"{len(prompts)*len(models)} answers ({len(todo)} still to generate)")
    if not todo:
        print("all answers already cached.")
    print()

    store["prompts"] = prompts
    failures = 0
    for n, (pi, model) in enumerate(todo, 1):
        label = textwrap.shorten(prompts[pi], 54)
        print(f"  [{n}/{len(todo)}] {model:<12} {label}", flush=True)
        try:
            text, secs = complete(args.base_url, args.api_key, model,
                                  prompts[pi], args.max_tokens, args.timeout)
            store["answers"][f"{pi}|{model}"] = {"text": text, "secs": round(secs, 2)}
            print(f"        {secs:.1f}s, {len(text)} chars")
        except urllib.error.HTTPError as e:
            failures += 1
            print(f"        FAILED HTTP {e.code}: "
                  f"{e.read()[:120].decode('utf-8','replace')}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"        FAILED {type(e).__name__}: {e}")
        # Save after every answer: a two-hour batch must survive a Ctrl-C.
        args.store.write_text(json.dumps(store, indent=2))

    print(f"\nsaved to {args.store}" + (f"  ({failures} failed)" if failures else ""))
    print("next:  ./arena.py judge")
    return 0


# --------------------------------------------------------------------------
# Judging
# --------------------------------------------------------------------------

def cmd_judge(args) -> int:
    if not args.store.exists():
        sys.exit(f"{args.store} not found -- run 'generate' first")
    store = json.loads(args.store.read_text())
    prompts, answers = store["prompts"], store["answers"]
    models = store["models"]

    judged = {(v["prompt"], v["a"], v["b"]) for v in store["votes"]}
    pairs = []
    for pi in range(len(prompts)):
        for a, b in combinations(models, 2):
            if f"{pi}|{a}" not in answers or f"{pi}|{b}" not in answers:
                continue
            if (pi, a, b) in judged or (pi, b, a) in judged:
                continue
            pairs.append((pi, a, b))

    if not pairs:
        print("nothing left to judge.")
        return cmd_report(args)

    random.shuffle(pairs)
    print(f"{len(pairs)} comparisons to judge. Ctrl-C any time -- votes are saved "
          "as you go.\n")

    for n, (pi, a, b) in enumerate(pairs, 1):
        # Randomise which side each model appears on, so a habit of picking
        # the left one does not quietly become the result.
        left, right = (a, b) if random.random() < 0.5 else (b, a)

        print("=" * 78)
        print(f"[{n}/{len(pairs)}]  PROMPT")
        print(textwrap.indent(textwrap.fill(prompts[pi], 74), "  "))
        for tag, model in (("A", left), ("B", right)):
            print("-" * 78)
            print(f"  {tag}:")
            body = answers[f"{pi}|{model}"]["text"]
            print(textwrap.indent(textwrap.fill(body, 74,
                  replace_whitespace=False), "     "))
        print("=" * 78)

        try:
            choice = input("  winner? [a/b/t=tie/s=skip/q=quit] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nstopping.")
            break
        if choice == "q":
            break
        if choice == "s":
            continue
        winner = {"a": left, "b": right, "t": "tie"}.get(choice)
        if winner is None:
            print("  (unrecognised, skipping)")
            continue

        store["votes"].append({"prompt": pi, "a": left, "b": right, "winner": winner})
        args.store.write_text(json.dumps(store, indent=2))
        print(f"  recorded.\n")

    return cmd_report(args)


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------

def cmd_report(args) -> int:
    if not args.store.exists():
        sys.exit(f"{args.store} not found")
    store = json.loads(args.store.read_text())
    votes, models, answers = store["votes"], store["models"], store["answers"]

    if not votes:
        print("no votes recorded yet -- run './arena.py judge'")
        return 0

    wins = {m: 0 for m in models}
    losses = {m: 0 for m in models}
    ties = {m: 0 for m in models}
    for v in votes:
        a, b, w = v["a"], v["b"], v["winner"]
        if w == "tie":
            ties[a] += 1; ties[b] += 1
        else:
            loser = b if w == a else a
            wins[w] += 1; losses[loser] += 1

    print(f"\n{'='*66}\nARENA RESULTS  ({len(votes)} comparisons)\n{'='*66}\n")
    hdr = f"{'model':<14}{'wins':>6}{'losses':>8}{'ties':>6}{'win rate':>11}{'avg secs':>11}"
    print(hdr); print("-" * len(hdr))

    ranked = []
    for m in models:
        decided = wins[m] + losses[m]
        rate = wins[m] / decided if decided else 0.0
        times = [a["secs"] for k, a in answers.items() if k.endswith(f"|{m}")]
        avg = sum(times) / len(times) if times else 0.0
        ranked.append((rate, wins[m], m, losses[m], ties[m], avg))
    ranked.sort(reverse=True)

    for rate, w, m, l, t, avg in ranked:
        print(f"{m:<14}{w:>6}{l:>8}{t:>6}{rate:>10.0%}{avg:>10.1f}s")

    print()
    best = ranked[0]
    # Count votes, not win+loss tallies: every decided vote increments one
    # model's wins AND another's losses, so summing both double-counts.
    decided_total = sum(1 for v in votes if v["winner"] != "tie")

    # Be honest about sample size: a 3-comparison "result" is noise.
    if decided_total < 10:
        print(f"  Only {decided_total} decided comparisons -- too few to trust.")
        print("  Judge at least 20 before acting on this.")
    else:
        print(f"  Winner: {best[2]} at {best[0]:.0%}")
        if len(ranked) > 1:
            runner = ranked[1]
            gap = best[0] - runner[0]
            speed = runner[5] / best[5] if best[5] else 1
            faster = runner[5] < best[5] * 0.5
            if gap < 0.1:
                print(f"  {runner[2]} is within {gap:.0%} -- effectively a tie on quality.")
                print(f"  Prefer whichever is faster, smaller, or cheaper to run.")
            elif gap < 0.2 and faster:
                # A modest quality gap against a large speed gap is the real
                # trade-off worth surfacing. A wide gap is not: no amount of
                # speed rescues a model that loses two thirds of the time.
                print(f"  {runner[2]} loses by {gap:.0%} but is {1/speed:.1f}x faster.")
                print(f"  Worth considering as the default, with {best[2]} reserved")
                print(f"  for the questions that need it.")
            elif faster:
                print(f"  {runner[2]} is {1/speed:.1f}x faster but loses by {gap:.0%} --")
                print(f"  too wide a gap to trade away. Keep {best[2]} as the default.")

    print("\n  Remember this ranks models on YOUR prompts. If those prompts are")
    print("  not representative of your real work, neither is this table.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", type=Path, default=DEFAULT_STORE)
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="run all models over all prompts")
    g.add_argument("--base-url", default=os.environ.get("LLM_BASE_URL", "http://192.168.1.201:4000"))
    g.add_argument("--api-key", default=os.environ.get("LLM_API_KEY", ""))
    g.add_argument("--models", default="workhorse,fast")
    g.add_argument("--prompts", help="file of prompts, separated by blank lines")
    g.add_argument("--max-tokens", type=int, default=400)
    g.add_argument("--timeout", type=float, default=600.0)
    g.set_defaults(func=cmd_generate)

    j = sub.add_parser("judge", help="blind pairwise rating")
    j.set_defaults(func=cmd_judge)

    r = sub.add_parser("report", help="show the standings")
    r.set_defaults(func=cmd_report)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(0)
