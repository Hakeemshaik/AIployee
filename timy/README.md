# Timy.ai

A private assistant that runs entirely on your own hardware, on top of the
`llm-lab` cluster.

## What this is, precisely

Timy is **your product built on an open-weight base model**. The persona,
knowledge, UI, brand, and behaviour are yours; the weights are Qwen's. That is
what building your own assistant means in practice — and it's the right
architecture, because the base model can be swapped for a better one in an
afternoon without losing anything you built.

What Timy adds over pointing curl at the gateway:

| Piece | Why it matters |
|---|---|
| `persona.md` | Timy's character and rules, in git. Editing this file *is* how you change Timy — diff it, roll it back, review it like code. No retraining. |
| `knowledge/` | Drop in `.md`/`.txt` files and Timy answers from them with citations. This is what makes it *yours* rather than a generic chatbot. |
| History trimming | On CPU every resent turn costs prefill time. Timy keeps the last N turns, not all of them. |
| Cache-friendly prompts | The persona goes first (identical every request, so its KV cache is reused); retrieved context and history go last. Reversing this would re-prefill everything on every turn. |
| Feedback capture | Thumbs up/down land in `data/feedback.jsonl`. This becomes your eval set. |
| The UI | Streaming, citations, markdown, dark mode, live timings. |

## Run it

```bash
sudo ./install.sh --upstream http://10.0.0.201:4000 --api-key sk-your-gateway-key
```

Development, without installing:

```bash
pip install -r requirements.txt
UPSTREAM_BASE_URL=http://10.0.0.201:4000 UPSTREAM_API_KEY=sk-... \
  python3 -m uvicorn api.main:app --reload --port 8090
```

Then open `http://<host>:8090`.

## Configuration

Everything is env-driven — see `api/config.py` for the full list. The ones you'll
actually touch:

| Variable | Default | Notes |
|---|---|---|
| `UPSTREAM_BASE_URL` | `http://10.0.0.201:4000` | The LiteLLM gateway |
| `UPSTREAM_API_KEY` | — | Gateway key |
| `TIMY_DEFAULT_MODEL` | `workhorse` | Alias from `litellm-config.yaml` |
| `TIMY_TEMPERATURE` | `0.4` | Low: this is an assistant, not a poet |
| `TIMY_HISTORY_TURNS` | `10` | Raise cautiously — it costs TTFT |
| `TIMY_KNOWLEDGE_MIN_SCORE` | `0.35` | Below this, a chunk is noise |
| `TIMY_MAX_TOKENS` | `1024` | Every token is ~40–80 ms on CPU |

## Adding knowledge

```bash
cp ~/handbooks/*.md knowledge/
curl -X POST http://localhost:8090/api/knowledge/reload
```

Embeddings are cached against a content fingerprint, so restarts are instant and
only changed documents are re-embedded.

**Tuning retrieval.** If Timy cites the wrong document, look at the scores
before changing the prompt:

```bash
curl -sX POST http://localhost:8090/api/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"your actual question"}' | python3 -m json.tool
```

- Right document, low score → lower `TIMY_KNOWLEDGE_MIN_SCORE`.
- Wrong document, high score → your documents overlap too much, or chunks are
  too big. Reduce `TIMY_CHUNK_CHARS` and add clearer headings.
- Nothing returned → the embedding model is probably unreachable; check
  `/api/health`.

`TIMY_KNOWLEDGE_MIN_SCORE` is deliberately not zero. Injecting weak matches is
worse than injecting nothing: it invites the model to answer confidently from an
irrelevant document instead of saying it doesn't know.

## Why vanilla JS and no database

The UI is three static files — no build step, no `node_modules`, no CDN. It
works on an isolated network and will still work in two years without a
dependency upgrade.

Conversations live in the browser's `localStorage`, so the server stores
nothing. That keeps the privacy claim honest and means there's no database to
back up or migrate. The trade-off is real and worth knowing: conversations don't
follow a user between devices, and clearing site data loses them. If you need
shared history later, that's the point to add Postgres — not before.

## Feedback is the valuable output

`data/feedback.jsonl` accumulates real questions from real users with a
judgement attached. That's an eval set you cannot buy, and it's what tells you
whether a persona edit or a model swap actually helped rather than just felt
different. Back this file up; it's worth more than the model weights.

## Security

- Timy has no authentication. On a trusted LAN that's a decision, not an
  oversight — but do not expose it to the internet as-is. Put it behind the
  gateway's auth, a reverse proxy with basic auth, or a VPN.
- It runs as an unprivileged system user with `ProtectSystem=strict` and can
  only write `data/`.
- The gateway API key lives in `/etc/timy.env` at mode 0640, not in the unit
  file (unit files are world-readable).
- The markdown renderer escapes all HTML before parsing, so model output cannot
  inject script. If you extend it, keep that ordering.
