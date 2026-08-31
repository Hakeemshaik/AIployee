#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Fetch GGUF weights for a role onto LOCAL disk.
#
# Local disk is not optional: llama.cpp mmaps the GGUF and relies on the OS
# page cache to keep it resident. Over NFS, cache-coherency semantics force
# re-reads and every miss costs a network round trip instead of a microsecond.
#
#   ./download-models.sh workhorse|fast|embed|draft [--force]
#
# If MODEL_MIRROR is set in models.env, pulls from your own mirror (pve-6)
# instead of Hugging Face -- worth it when the same 18 GB goes to four nodes.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=models.env
source "${HERE}/models.env"

ROLE="${1:-workhorse}"; shift || true
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# Match install-service.sh: a 16 GB node gets the smaller workhorse.
WORKHORSE_TIER="${WORKHORSE_TIER:-auto}"
if [[ "$WORKHORSE_TIER" == "auto" ]]; then
  _total_gb=$(free -g | awk '/^Mem:/{print $2}')
  [[ "${_total_gb:-99}" -lt 24 ]] && WORKHORSE_TIER="16gb" || WORKHORSE_TIER="full"
fi
if [[ "$ROLE" == "workhorse" && "$WORKHORSE_TIER" == "16gb" ]]; then
  WORKHORSE_REPO="$WORKHORSE16_REPO"; WORKHORSE_FILE="$WORKHORSE16_FILE"
  echo "==> 16 GB node: fetching ${WORKHORSE_FILE} rather than the 18 GB MoE"
fi

case "$ROLE" in
  workhorse) REPO="$WORKHORSE_REPO"; FILE="$WORKHORSE_FILE" ;;
  fast)      REPO="$FAST_REPO";      FILE="$FAST_FILE" ;;
  embed)     REPO="$EMBED_REPO";     FILE="$EMBED_FILE" ;;
  draft)     REPO="$DRAFT_REPO";     FILE="$DRAFT_FILE" ;;
  *) echo "usage: $0 workhorse|fast|embed|draft [--force]" >&2; exit 1 ;;
esac

mkdir -p "$MODEL_DIR"
DEST="${MODEL_DIR}/${FILE}"

if [[ -s "$DEST" && $FORCE -eq 0 ]]; then
  echo "==> already present: $DEST ($(du -h "$DEST" | cut -f1))"
  exit 0
fi

# Refuse to serve from a network filesystem -- see the header comment.
fstype="$(stat -f -c %T "$MODEL_DIR" 2>/dev/null || echo unknown)"
case "$fstype" in
  nfs*|cifs|smb*|fuse*)
    echo "error: MODEL_DIR is on '$fstype'. Serve models from local disk only." >&2
    echo "       Keep the canonical library on the share and rsync it down." >&2
    exit 1 ;;
esac

# --- Free space check: models are big and a partial download is a bad day ---
avail_gb=$(df -BG --output=avail "$MODEL_DIR" 2>/dev/null | tail -1 | tr -dc '0-9')
if [[ -n "$avail_gb" && "$avail_gb" -lt 25 ]]; then
  echo "warning: only ${avail_gb} GB free in ${MODEL_DIR}; a Q4 30B needs ~18 GB" >&2
fi

if [[ -n "$MODEL_MIRROR" ]]; then
  echo "==> pulling ${FILE} from mirror ${MODEL_MIRROR}"
  # --partial --append-verify makes an interrupted 18 GB transfer resumable
  rsync -h --progress --partial --append-verify \
    "${MODEL_MIRROR%/}/${FILE}" "$DEST"
else
  echo "==> downloading ${REPO} :: ${FILE} from Hugging Face"
  URL="https://huggingface.co/${REPO}/resolve/main/${FILE}?download=true"
  # -C - resumes; write to .part so an interrupted run never looks complete
  curl -fL --retry 5 --retry-delay 5 --retry-connrefused \
       -C - -o "${DEST}.part" "$URL"
  mv "${DEST}.part" "$DEST"
fi

echo "==> done: $DEST ($(du -h "$DEST" | cut -f1))"

# Warm the page cache so the first request doesn't pay for cold reads.
echo "==> pre-warming page cache"
cat "$DEST" > /dev/null 2>&1 || true
