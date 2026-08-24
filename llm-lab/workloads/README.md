# Workloads

Working examples of the batch patterns this cluster is actually good at.

## batch_extract.py

Structured extraction over JSONL at scale. Schema-validated, resumable,
failures routed to a retry queue rather than silently dropped.

```bash
export LLM_BASE_URL=http://10.0.0.201:4000
export LLM_API_KEY=sk-your-gateway-key

./batch_extract.py \
    --input  transcripts.jsonl \
    --output scored.jsonl \
    --prompt examples/score_call.txt \
    --schema examples/call_outcome.schema.json \
    --model  workhorse \
    --concurrency 6 \
    --resume
```

Input is one JSON object per line; every field is available to the prompt
template by name (`{transcript}`, `{account_ref}`).

### Setting --concurrency

Match it to the **sum of `--parallel` across your replicas** — three workhorse
nodes at 4 slots each is 12. Going higher just builds a queue at the gateway
and inflates p95 without adding throughput. Going lower leaves slots idle.

Verify with `bench/bench.py --concurrency`: once throughput stops rising with
concurrency, you have found the memory-bandwidth ceiling and more requests are
pure queueing.

### Notes on nullable fields

The example schema omits `ptp_amount` and `ptp_date` from `required` rather than
allowing null, because strict JSON-schema mode on some backends rejects
`["number","null"]` unions. The prompt asks for null; a missing key and a null
key mean the same thing to the consumer. If your backend handles unions well,
tighten this.

### Why temperature 0

Extraction must be reproducible. If a re-run over the same transcripts produces
different numbers, no figure you report from it is auditable — and for
collections reporting that matters more than squeezing out a marginally better
answer.

## Pattern: local filter, hosted confirm

The pattern from docs/05 that saves the most money without lying to you:

1. Run the full job locally on the cluster. Free, unlimited, run it nightly.
2. Sample the results — or take every record where `confidence` is `low` — and
   re-run just those against a hosted model.
3. Compare. If the local model agrees with the hosted model on the sample, trust
   the bulk run. If it does not, you have found either a prompt problem or a
   model-tier problem, and you have found it cheaply.

This gives you hosted-model reliability on the records that need it and local
economics on the ones that do not. The `confidence` field in the example prompt
exists specifically to drive step 2.
