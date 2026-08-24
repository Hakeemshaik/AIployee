"""Timy.ai configuration. Everything is env-overridable so the same image runs
in dev on a laptop and in prod on the cluster."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Config:
    # --- Identity ---------------------------------------------------------
    # The persona file IS the product. Editing it is how Timy changes -- not
    # retraining. Keep it in git so you can diff and roll back a personality
    # change the same way you would a code change.
    NAME = os.environ.get("TIMY_NAME", "Timy")
    TAGLINE = os.environ.get("TIMY_TAGLINE", "Your private AI assistant")
    PERSONA_FILE = Path(os.environ.get("TIMY_PERSONA_FILE", ROOT / "persona.md"))

    # --- Upstream inference ----------------------------------------------
    # Points at the LiteLLM gateway, or straight at a llama-server for dev.
    UPSTREAM_BASE_URL = os.environ.get("UPSTREAM_BASE_URL", "http://10.0.0.201:4000")
    UPSTREAM_API_KEY = os.environ.get("UPSTREAM_API_KEY", "")

    # Model aliases as configured in gateway/litellm-config.yaml.
    DEFAULT_MODEL = os.environ.get("TIMY_DEFAULT_MODEL", "workhorse")
    FAST_MODEL = os.environ.get("TIMY_FAST_MODEL", "fast")
    EMBED_MODEL = os.environ.get("TIMY_EMBED_MODEL", "embed")

    # --- Generation -------------------------------------------------------
    TEMPERATURE = float(os.environ.get("TIMY_TEMPERATURE", "0.4"))
    MAX_TOKENS = int(os.environ.get("TIMY_MAX_TOKENS", "1024"))
    # CPU inference is slow; a long answer legitimately takes minutes.
    REQUEST_TIMEOUT = float(os.environ.get("TIMY_REQUEST_TIMEOUT", "600"))

    # How many prior turns to resend. Every turn you keep costs prefill time on
    # CPU, and beyond ~10 turns the marginal value is low. Trim, don't hoard.
    HISTORY_TURNS = int(os.environ.get("TIMY_HISTORY_TURNS", "10"))

    # --- Knowledge (RAG) --------------------------------------------------
    # Optional. Drop .md/.txt files in knowledge/ and Timy can cite them.
    # Degrades gracefully to a plain chatbot if the embedding model is absent.
    KNOWLEDGE_DIR = Path(os.environ.get("TIMY_KNOWLEDGE_DIR", ROOT / "knowledge"))
    KNOWLEDGE_ENABLED = _bool("TIMY_KNOWLEDGE_ENABLED", True)
    KNOWLEDGE_TOP_K = int(os.environ.get("TIMY_KNOWLEDGE_TOP_K", "4"))
    # Below this cosine similarity a chunk is noise. Injecting weak matches is
    # worse than injecting nothing: it invites the model to answer from an
    # irrelevant document rather than saying it does not know.
    KNOWLEDGE_MIN_SCORE = float(os.environ.get("TIMY_KNOWLEDGE_MIN_SCORE", "0.35"))
    CHUNK_CHARS = int(os.environ.get("TIMY_CHUNK_CHARS", "1200"))
    CHUNK_OVERLAP = int(os.environ.get("TIMY_CHUNK_OVERLAP", "150"))

    # --- Feedback ---------------------------------------------------------
    # Thumbs up/down are written here. This becomes your eval set -- the most
    # valuable artifact you will produce, because it is specific to your users.
    FEEDBACK_LOG = Path(os.environ.get("TIMY_FEEDBACK_LOG", ROOT / "data" / "feedback.jsonl"))

    # --- Server -----------------------------------------------------------
    HOST = os.environ.get("TIMY_HOST", "0.0.0.0")
    PORT = int(os.environ.get("TIMY_PORT", "8090"))
    UI_DIR = Path(os.environ.get("TIMY_UI_DIR", ROOT / "ui"))

    @classmethod
    def persona(cls) -> str:
        try:
            return cls.PERSONA_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return f"You are {cls.NAME}, a helpful, concise assistant."


config = Config()
