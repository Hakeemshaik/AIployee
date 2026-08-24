"""
Minimal retrieval over a folder of documents.

Deliberately simple: no vector database, no framework. Chunks are embedded via
the cluster's own embedding endpoint and held in memory. For a knowledge base
of a few thousand chunks this is fast, has no moving parts, and is trivial to
reason about when a citation looks wrong. Swap in Qdrant (already on pve-6 in
the reference architecture) when you outgrow it -- the interface below is the
seam to do that at.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass, asdict
from pathlib import Path

import httpx

from .config import config

log = logging.getLogger("timy.knowledge")

SUPPORTED = {".md", ".txt", ".markdown"}


@dataclass
class Chunk:
    doc: str          # source filename, used for citations
    text: str
    heading: str      # nearest markdown heading, gives the model orientation
    vector: list = None

    def to_public(self) -> dict:
        d = asdict(self)
        d.pop("vector", None)
        return d


def _split(text: str, size: int, overlap: int) -> list[tuple[str, str]]:
    """
    Split on markdown headings first, then by size within a section.

    Heading-aware splitting matters more than it sounds: a chunk that begins
    mid-sentence under an unknown heading gives the model no idea what it is
    reading, and that is where confidently wrong citations come from.
    """
    parts: list[tuple[str, str]] = []
    sections = re.split(r"^(#{1,6}\s+.*)$", text, flags=re.MULTILINE)

    # re.split with a capture group yields [pre, head1, body1, head2, body2, ...]
    pending_heading = ""
    buf = sections[0] if sections else ""
    queue: list[tuple[str, str]] = []
    if buf.strip():
        queue.append(("", buf))
    for i in range(1, len(sections) - 1, 2):
        pending_heading = sections[i].lstrip("# ").strip()
        body = sections[i + 1]
        queue.append((pending_heading, body))

    for heading, body in queue:
        body = body.strip()
        if not body:
            continue
        if len(body) <= size:
            parts.append((heading, body))
            continue
        start = 0
        while start < len(body):
            end = min(len(body), start + size)
            # Prefer a paragraph or sentence boundary over a hard cut.
            if end < len(body):
                for sep in ("\n\n", ". ", "\n", " "):
                    cut = body.rfind(sep, start + size // 2, end)
                    if cut != -1:
                        end = cut + len(sep)
                        break
            parts.append((heading, body[start:end].strip()))
            if end >= len(body):
                break
            start = max(start + 1, end - overlap)
    return [(h, t) for h, t in parts if t]


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class KnowledgeBase:
    def __init__(self) -> None:
        self.chunks: list[Chunk] = []
        self.available = False
        self.reason = "not loaded"
        self._cache_path = config.KNOWLEDGE_DIR.parent / "data" / "kb-cache.json"

    # --- Embedding ------------------------------------------------------
    async def _embed(self, texts: list[str]) -> list[list[float]] | None:
        """Call the cluster's embedding endpoint. Returns None if unavailable."""
        url = config.UPSTREAM_BASE_URL.rstrip("/") + "/v1/embeddings"
        headers = {"Content-Type": "application/json"}
        if config.UPSTREAM_API_KEY:
            headers["Authorization"] = f"Bearer {config.UPSTREAM_API_KEY}"
        out: list[list[float]] = []
        # Batch to keep request bodies sane and let the server pipeline them.
        batch = 16
        async with httpx.AsyncClient(timeout=config.REQUEST_TIMEOUT) as client:
            for i in range(0, len(texts), batch):
                slice_ = texts[i:i + batch]
                try:
                    r = await client.post(url, headers=headers, json={
                        "model": config.EMBED_MODEL, "input": slice_})
                    r.raise_for_status()
                    data = r.json()["data"]
                    out.extend(item["embedding"] for item in data)
                except Exception as e:  # noqa: BLE001
                    log.warning("embedding request failed: %s", e)
                    return None
        return out

    # --- Loading --------------------------------------------------------
    def _scan(self) -> list[Chunk]:
        chunks: list[Chunk] = []
        if not config.KNOWLEDGE_DIR.is_dir():
            return chunks
        for path in sorted(config.KNOWLEDGE_DIR.rglob("*")):
            if path.suffix.lower() not in SUPPORTED or not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as e:
                log.warning("skipping %s: %s", path.name, e)
                continue
            rel = str(path.relative_to(config.KNOWLEDGE_DIR))
            for heading, body in _split(text, config.CHUNK_CHARS, config.CHUNK_OVERLAP):
                chunks.append(Chunk(doc=rel, text=body, heading=heading))
        return chunks

    def _fingerprint(self, chunks: list[Chunk]) -> str:
        h = hashlib.sha256()
        h.update(config.EMBED_MODEL.encode())
        for c in chunks:
            h.update(c.doc.encode())
            h.update(c.text.encode())
        return h.hexdigest()

    async def load(self) -> None:
        """
        Load and embed the knowledge base. Safe to call on startup; never raises.

        Embedding is cached against a fingerprint of the content, so a restart
        does not re-embed unchanged documents -- which matters when embedding a
        few thousand chunks on CPU takes minutes.
        """
        chunks = self._scan()
        if not chunks:
            self.available = False
            self.reason = f"no documents in {config.KNOWLEDGE_DIR}"
            log.info("knowledge base: %s", self.reason)
            return

        fp = self._fingerprint(chunks)
        if self._cache_path.exists():
            try:
                cached = json.loads(self._cache_path.read_text())
                if cached.get("fingerprint") == fp:
                    for c, vec in zip(chunks, cached["vectors"]):
                        c.vector = vec
                    self.chunks = chunks
                    self.available = True
                    self.reason = f"{len(chunks)} chunks (from cache)"
                    log.info("knowledge base: %s", self.reason)
                    return
            except Exception as e:  # noqa: BLE001
                log.warning("ignoring unreadable kb cache: %s", e)

        log.info("embedding %d chunks (first run or documents changed)...", len(chunks))
        # Prefix the heading so the embedding captures section context, not just
        # the raw sentence fragment.
        vectors = await self._embed([f"{c.heading}\n{c.text}" if c.heading else c.text
                                    for c in chunks])
        if vectors is None or len(vectors) != len(chunks):
            self.available = False
            self.reason = (f"embedding model '{config.EMBED_MODEL}' unreachable -- "
                           "Timy will answer without the knowledge base")
            log.warning("knowledge base disabled: %s", self.reason)
            return

        for c, v in zip(chunks, vectors):
            c.vector = v
        self.chunks = chunks
        self.available = True
        self.reason = f"{len(chunks)} chunks from {len({c.doc for c in chunks})} documents"

        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            self._cache_path.write_text(json.dumps(
                {"fingerprint": fp, "vectors": [c.vector for c in self.chunks]}))
        except OSError as e:
            log.warning("could not write kb cache: %s", e)
        log.info("knowledge base: %s", self.reason)

    # --- Search ---------------------------------------------------------
    async def search(self, query: str, top_k: int | None = None) -> list[dict]:
        if not self.available or not self.chunks:
            return []
        top_k = top_k or config.KNOWLEDGE_TOP_K
        qv = await self._embed([query])
        if not qv:
            return []
        scored = [(_cosine(qv[0], c.vector), c) for c in self.chunks if c.vector]
        scored.sort(key=lambda t: t[0], reverse=True)
        hits = []
        for score, c in scored[:top_k]:
            # Weak matches are worse than no matches: they invite the model to
            # answer from an irrelevant document instead of admitting ignorance.
            if score < config.KNOWLEDGE_MIN_SCORE:
                continue
            hits.append({"score": round(score, 4), **c.to_public()})
        return hits

    def stats(self) -> dict:
        return {
            "available": self.available,
            "reason": self.reason,
            "chunks": len(self.chunks),
            "documents": sorted({c.doc for c in self.chunks}),
        }


kb = KnowledgeBase()
