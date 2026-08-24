"""
Timy.ai -- a private assistant on your own hardware.

A thin, honest layer over the cluster's OpenAI-compatible gateway that adds the
things that make it a product rather than a raw model endpoint:

  * a persona held in a git-tracked file (persona.md)
  * optional grounding in your own documents, with citations
  * history trimming, because on CPU every resent turn costs real prefill time
  * feedback capture, which becomes your eval set
  * a UI

Deliberately stateless: conversations live in the browser. That means no
database to back up, no migration to run, and no store of user conversations
sitting on disk by default -- which is the right default for something whose
selling point is privacy.
"""
from __future__ import annotations

import json
import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import config
from .knowledge import kb

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("timy")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("%s starting -- upstream %s", config.NAME, config.UPSTREAM_BASE_URL)
    if config.KNOWLEDGE_ENABLED:
        await kb.load()
    else:
        log.info("knowledge base disabled by configuration")
    yield


app = FastAPI(title=f"{config.NAME}.ai", lifespan=lifespan)


# --- Schemas --------------------------------------------------------------

class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    model: str | None = None
    temperature: float | None = None
    use_knowledge: bool = True


class Feedback(BaseModel):
    rating: str = Field(pattern="^(up|down)$")
    question: str = ""
    answer: str = ""
    model: str = ""
    note: str = ""


# --- Prompt assembly ------------------------------------------------------

def build_messages(req: ChatRequest, context: list[dict]) -> list[dict]:
    """
    Assemble the upstream message list.

    Ordering is deliberate and matters for performance, not just quality: the
    persona is identical on every request, so putting it first lets the server
    reuse its KV cache instead of re-prefilling it. Retrieved context and the
    conversation -- both of which change -- go after it. Reversing this would
    invalidate the cache on every turn. See llm-lab/docs/03.
    """
    system = config.persona()

    if context:
        blocks = []
        for hit in context:
            head = f" > {hit['heading']}" if hit.get("heading") else ""
            blocks.append(f"[{hit['doc']}{head}]\n{hit['text']}")
        system += (
            "\n\n## Context documents for this question\n\n"
            + "\n\n---\n\n".join(blocks)
            + "\n\nGround your answer in these documents and cite the filename "
              "in square brackets. If they do not answer the question, say so."
        )

    out = [{"role": "system", "content": system}]

    # Trim history. Keeping every turn feels generous but on CPU it directly
    # inflates time-to-first-token, and old turns rarely change the answer.
    history = [m for m in req.messages if m.role in ("user", "assistant")]
    keep = config.HISTORY_TURNS * 2
    if len(history) > keep:
        history = history[-keep:]
    out.extend({"role": m.role, "content": m.content} for m in history)
    return out


# --- Endpoints ------------------------------------------------------------

@app.get("/api/health")
async def health():
    """Reports our own state and whether the upstream cluster is reachable."""
    upstream = {"reachable": False, "models": [], "error": None}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            headers = ({"Authorization": f"Bearer {config.UPSTREAM_API_KEY}"}
                       if config.UPSTREAM_API_KEY else {})
            r = await client.get(
                config.UPSTREAM_BASE_URL.rstrip("/") + "/v1/models", headers=headers)
            r.raise_for_status()
            upstream["reachable"] = True
            upstream["models"] = [m["id"] for m in r.json().get("data", [])]
    except Exception as e:  # noqa: BLE001
        upstream["error"] = f"{type(e).__name__}: {e}"

    return {
        "name": config.NAME,
        "tagline": config.TAGLINE,
        "default_model": config.DEFAULT_MODEL,
        "fast_model": config.FAST_MODEL,
        "upstream": upstream,
        "knowledge": kb.stats(),
    }


@app.post("/api/knowledge/reload")
async def reload_knowledge():
    """Re-scan and re-embed knowledge/ after you add or edit a document."""
    await kb.load()
    return kb.stats()


@app.post("/api/knowledge/search")
async def search_knowledge(payload: dict):
    """Exposed for debugging: see exactly what Timy retrieves for a question."""
    query = (payload or {}).get("query", "").strip()
    if not query:
        raise HTTPException(400, "query is required")
    return {"hits": await kb.search(query)}


@app.post("/api/feedback")
async def feedback(fb: Feedback):
    """
    Record a thumbs up/down.

    This file is the most valuable thing this app produces. Real questions your
    real users asked, with a judgement attached, is exactly the eval set you
    cannot buy -- and it is what tells you whether a prompt change or a model
    swap actually helped. See llm-lab/docs/05.
    """
    try:
        config.FEEDBACK_LOG.parent.mkdir(parents=True, exist_ok=True)
        with config.FEEDBACK_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"ts": time.time(), **fb.model_dump()}) + "\n")
    except OSError as e:
        raise HTTPException(500, f"could not write feedback: {e}") from e
    return {"ok": True}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Streaming chat. Emits SSE events the UI understands."""
    if not req.messages:
        raise HTTPException(400, "messages is required")

    model = req.model or config.DEFAULT_MODEL
    question = next((m.content for m in reversed(req.messages)
                     if m.role == "user"), "")

    context: list[dict] = []
    if req.use_knowledge and question:
        try:
            context = await kb.search(question)
        except Exception as e:  # noqa: BLE001
            # Retrieval failing should degrade to a plain answer, never 500.
            log.warning("knowledge search failed, continuing without: %s", e)

    payload = {
        "model": model,
        "messages": build_messages(req, context),
        "temperature": req.temperature if req.temperature is not None else config.TEMPERATURE,
        "max_tokens": config.MAX_TOKENS,
        "stream": True,
    }
    headers = {"Content-Type": "application/json"}
    if config.UPSTREAM_API_KEY:
        headers["Authorization"] = f"Bearer {config.UPSTREAM_API_KEY}"
    url = config.UPSTREAM_BASE_URL.rstrip("/") + "/v1/chat/completions"

    async def stream():
        # Tell the UI which sources are in play before any tokens arrive, so it
        # can show citations immediately rather than after the answer.
        yield _sse("sources", {"sources": context, "model": model})
        t0 = time.perf_counter()
        ttft = None
        tokens = 0
        try:
            async with httpx.AsyncClient(timeout=config.REQUEST_TIMEOUT) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as r:
                    if r.status_code >= 400:
                        detail = (await r.aread()).decode("utf-8", "replace")[:400]
                        yield _sse("error", {
                            "message": f"upstream returned {r.status_code}",
                            "detail": detail})
                        return
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        body = line[5:].strip()
                        if body == "[DONE]":
                            break
                        try:
                            chunk = json.loads(body)
                        except json.JSONDecodeError:
                            continue
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        piece = (choices[0].get("delta") or {}).get("content")
                        if piece:
                            if ttft is None:
                                ttft = time.perf_counter() - t0
                            tokens += 1
                            yield _sse("token", {"t": piece})
        except httpx.TimeoutException:
            yield _sse("error", {
                "message": "the model took too long",
                "detail": "CPU inference is slow; try a shorter question or the "
                          "fast model. Raise TIMY_REQUEST_TIMEOUT if this is "
                          "expected for your workload."})
            return
        except Exception as e:  # noqa: BLE001
            log.exception("chat stream failed")
            yield _sse("error", {"message": "could not reach the model",
                                 "detail": f"{type(e).__name__}: {e}"})
            return

        elapsed = time.perf_counter() - t0
        # Surface the timings in the UI. On self-hosted CPU inference these are
        # not trivia -- they are how you notice a node has started throttling.
        yield _sse("done", {
            "ttft_ms": round((ttft or 0) * 1000),
            "tokens": tokens,
            "elapsed_ms": round(elapsed * 1000),
            "tok_per_s": round(tokens / max(1e-9, elapsed - (ttft or 0)), 1)
                         if tokens > 1 else 0,
        })

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# --- UI -------------------------------------------------------------------

if config.UI_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(config.UI_DIR)), name="static")

    @app.get("/")
    async def index(_: Request):
        return FileResponse(str(config.UI_DIR / "index.html"))
