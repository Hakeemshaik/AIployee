#!/usr/bin/env python3
"""
Batch structured extraction against the cluster. The workload this hardware is
genuinely good at: latency-insensitive, embarrassingly parallel, high volume.

Reads JSONL, sends each record through a prompt template, validates the JSON
response against a schema, writes results to JSONL and failures to a separate
retry queue.

The two design points that matter, learned the hard way:

  1. ALWAYS validate structured output against a schema. A Q4 quantised model
     will occasionally emit malformed or incomplete JSON. A batch job that
     silently drops 2% of records is far worse than one that fails loudly --
     you will not notice until the numbers in a report do not add up.

  2. Failures go to a retry queue, not to /dev/null and not to a crash. One bad
     record should never cost you a six-hour run.

Usage:
  ./batch_extract.py \
      --input transcripts.jsonl \
      --output extracted.jsonl \
      --prompt prompts/score_call.txt \
      --schema schemas/call_outcome.json \
      --model workhorse \
      --concurrency 6

The prompt file is a Python format template; every field of the input record is
available by name, e.g. {transcript} or {account_ref}.
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any


# --- Response parsing ------------------------------------------------------

FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def extract_json(text: str) -> Any:
    """
    Pull a JSON object out of a model response.

    Even with an explicit instruction, smaller quantised models wrap JSON in
    markdown fences or prepend a sentence of commentary. Rather than failing the
    record, try the cheap recoveries in order -- but never guess at malformed
    JSON, because a silently mis-parsed record is worse than a failed one.
    """
    text = text.strip()

    # 1. Clean JSON.
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Fenced code block.
    m = FENCE_RE.search(text)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # 3. First balanced {...} span. Bracket-counting rather than a regex,
    #    because nested objects defeat the naive pattern.
    start = text.find("{")
    if start != -1:
        depth, in_str, esc = 0, False, False
        for i, ch in enumerate(text[start:], start):
            if esc:
                esc = False
                continue
            if ch == "\\" and in_str:
                esc = True
            elif ch == '"':
                in_str = not in_str
            elif not in_str:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(text[start:i + 1])
                        except json.JSONDecodeError:
                            break
    raise ValueError("no parseable JSON object in response")


def validate(obj: Any, schema: dict) -> list[str]:
    """
    Minimal schema check: required keys, types, and enum membership.

    Deliberately dependency-free so this runs on a bare container. If you need
    full JSON Schema, install jsonschema and swap this out -- but this catches
    the failures that actually happen with quantised models: missing fields,
    a string where a number belongs, and invented enum values.
    """
    errs: list[str] = []
    if not isinstance(obj, dict):
        return [f"expected object, got {type(obj).__name__}"]

    types = {
        "string": str, "number": (int, float), "integer": int,
        "boolean": bool, "array": list, "object": dict,
    }

    for key in schema.get("required", []):
        if key not in obj:
            errs.append(f"missing required field '{key}'")

    for key, spec in (schema.get("properties") or {}).items():
        if key not in obj:
            continue
        val = obj[key]
        want = spec.get("type")
        if want and want in types:
            # bool is a subclass of int in Python; don't let True pass as a number
            if want in ("number", "integer") and isinstance(val, bool):
                errs.append(f"field '{key}': expected {want}, got boolean")
            elif not isinstance(val, types[want]):
                errs.append(f"field '{key}': expected {want}, got {type(val).__name__}")
        if "enum" in spec and val not in spec["enum"]:
            errs.append(f"field '{key}': {val!r} not in {spec['enum']}")

    if not schema.get("additionalProperties", True):
        allowed = set((schema.get("properties") or {}).keys())
        for key in obj:
            if key not in allowed:
                errs.append(f"unexpected field '{key}'")

    return errs


# --- Inference -------------------------------------------------------------

def complete(base_url: str, api_key: str, model: str, prompt: str,
             schema: dict | None, max_tokens: int, timeout: float) -> str:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system",
             "content": "You extract structured data. Reply with JSON only, "
                        "no commentary, no markdown fences."},
            {"role": "user", "content": prompt},
        ],
        # Temperature 0: extraction should be reproducible. A re-run over the
        # same input must give the same answer or your numbers are not auditable.
        "temperature": 0.0,
        "max_tokens": max_tokens,
    }
    if schema:
        # Grammar-constrained decoding. When the server supports it this makes
        # invalid JSON structurally impossible, which beats any amount of
        # prompting or fine-tuning. LiteLLM's drop_params discards it harmlessly
        # if the backend does not implement it -- hence the parser above still
        # exists as a fallback.
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "extraction", "schema": schema, "strict": True},
        }

    req = urllib.request.Request(
        base_url.rstrip("/") + "/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {api_key}"} if api_key else {}),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


# --- Runner ----------------------------------------------------------------

class Stats:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.ok = 0
        self.failed = 0
        self.retried = 0
        self.started = time.time()

    def bump(self, field: str) -> None:
        with self.lock:
            setattr(self, field, getattr(self, field) + 1)

    def line(self, total: int) -> str:
        done = self.ok + self.failed
        rate = done / max(1e-9, time.time() - self.started)
        eta = (total - done) / rate if rate > 0 else 0
        return (f"\r  {done}/{total}  ok={self.ok} failed={self.failed} "
                f"retried={self.retried}  {rate*60:.1f} rec/min  "
                f"eta {eta/60:.1f} min   ")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, help="JSONL, one record per line")
    ap.add_argument("--output", required=True, help="JSONL results")
    ap.add_argument("--retry-queue", help="JSONL of failures (default: <output>.retry)")
    ap.add_argument("--prompt", required=True, help="format-template file")
    ap.add_argument("--schema", help="JSON Schema for the expected output")
    ap.add_argument("--base-url", default=os.environ.get("LLM_BASE_URL", "http://10.0.0.201:4000"))
    ap.add_argument("--api-key", default=os.environ.get("LLM_API_KEY", ""))
    ap.add_argument("--model", default="workhorse")
    ap.add_argument("--concurrency", type=int, default=6,
                    help="total in-flight requests. Match this to the sum of "
                         "--parallel across your replicas; more just queues.")
    ap.add_argument("--max-tokens", type=int, default=512)
    ap.add_argument("--timeout", type=float, default=600.0)
    ap.add_argument("--attempts", type=int, default=2,
                    help="attempts per record before it goes to the retry queue")
    ap.add_argument("--limit", type=int, help="process only the first N records")
    ap.add_argument("--resume", action="store_true",
                    help="skip records already present in --output. Essential "
                         "for long runs: a six-hour job should never restart "
                         "from zero.")
    args = ap.parse_args()

    template = open(args.prompt).read()
    schema = json.load(open(args.schema)) if args.schema else None
    retry_path = args.retry_queue or args.output + ".retry"

    # --- Load input, honouring --resume -----------------------------------
    records = []
    with open(args.input) as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append((lineno, json.loads(line)))
            except json.JSONDecodeError as e:
                print(f"input line {lineno}: skipping unparseable JSON ({e})",
                      file=sys.stderr)
    if args.limit:
        records = records[:args.limit]

    done_ids = set()
    if args.resume and os.path.exists(args.output):
        with open(args.output) as f:
            for line in f:
                try:
                    done_ids.add(json.loads(line).get("_id"))
                except json.JSONDecodeError:
                    continue
        before = len(records)
        records = [(n, r) for n, r in records
                   if (r.get("id") or r.get("_id") or n) not in done_ids]
        print(f"resume: skipping {before - len(records)} already-processed records")

    total = len(records)
    if total == 0:
        print("nothing to do")
        return 0

    print(f"input       : {args.input} ({total} records)")
    print(f"model       : {args.model} via {args.base_url}")
    print(f"concurrency : {args.concurrency}")
    print(f"schema      : {args.schema or 'none (no validation!)'}")
    if not schema:
        print("  [!] Without a schema, malformed responses pass through silently.")
    print()

    work: queue.Queue = queue.Queue()
    for item in records:
        work.put(item)

    stats = Stats()
    out_lock = threading.Lock()
    out_f = open(args.output, "a" if args.resume else "w")
    retry_f = open(retry_path, "w")

    def worker() -> None:
        while True:
            try:
                lineno, rec = work.get_nowait()
            except queue.Empty:
                return
            rid = rec.get("id") or rec.get("_id") or lineno
            succeeded = False
            last_err = ""
            for attempt in range(1, args.attempts + 1):
                try:
                    prompt = template.format(**rec)
                except KeyError as e:
                    last_err = f"prompt template needs field {e}, absent from record"
                    break
                try:
                    raw = complete(args.base_url, args.api_key, args.model,
                                   prompt, schema, args.max_tokens, args.timeout)
                    parsed = extract_json(raw)
                    if schema:
                        errs = validate(parsed, schema)
                        if errs:
                            raise ValueError("schema: " + "; ".join(errs[:3]))
                    with out_lock:
                        out_f.write(json.dumps(
                            {"_id": rid, "_source_line": lineno, **parsed}) + "\n")
                        out_f.flush()
                    stats.bump("ok")
                    if attempt > 1:
                        stats.bump("retried")
                    succeeded = True
                    break
                except urllib.error.HTTPError as e:
                    last_err = f"HTTP {e.code}: {e.read()[:200].decode('utf-8','replace')}"
                except Exception as e:  # noqa: BLE001
                    last_err = f"{type(e).__name__}: {e}"
                if attempt < args.attempts:
                    time.sleep(min(2 ** attempt, 10))

            if not succeeded:
                with out_lock:
                    retry_f.write(json.dumps(
                        {"_id": rid, "_source_line": lineno,
                         "_error": last_err, "record": rec}) + "\n")
                    retry_f.flush()
                stats.bump("failed")

    threads = [threading.Thread(target=worker, daemon=True)
               for _ in range(args.concurrency)]
    for t in threads:
        t.start()

    while any(t.is_alive() for t in threads):
        sys.stderr.write(stats.line(total))
        sys.stderr.flush()
        time.sleep(2)
    for t in threads:
        t.join()
    sys.stderr.write(stats.line(total) + "\n")

    out_f.close()
    retry_f.close()

    elapsed = time.time() - stats.started
    print(f"\ndone in {elapsed/60:.1f} min")
    print(f"  ok      : {stats.ok}")
    print(f"  retried : {stats.retried} (succeeded on a later attempt)")
    print(f"  failed  : {stats.failed} -> {retry_path}")

    if stats.failed:
        fail_rate = stats.failed / total
        print()
        if fail_rate > 0.05:
            print(f"  [!] {fail_rate:.1%} failure rate is high. Common causes, in order:")
            print("      - prompt too long for --ctx-size (check journalctl on the worker)")
            print("      - quantisation too aggressive for reliable JSON: Q3 and below")
            print("        break schema adherence before they break prose (docs/02)")
            print("      - --max-tokens truncating the response mid-object")
        print(f"      Re-run just the failures:")
        print(f"        {sys.argv[0]} --input {retry_path} ... ")
        print("      (the retry file nests the original under 'record', so point")
        print("       your template at record fields or flatten it first)")

    return 1 if stats.failed and stats.ok == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
