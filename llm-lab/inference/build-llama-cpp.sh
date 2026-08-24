#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build llama.cpp tuned for THIS machine's CPU. Run inside the inference guest.
#
# The important part is -march=native: it lets the compiler emit AVX2/AVX-512
# (and AMX on newer Xeon/Core) instructions for the exact CPU it is compiled on.
# Generic binaries and most distro packages target a baseline ISA and leave a
# large chunk of prompt-processing performance on the table. The cost is that
# the resulting binary is not portable to a different CPU generation -- which is
# fine, we build per node.
# ---------------------------------------------------------------------------
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=models.env
source "${HERE}/models.env"

JOBS="${JOBS:-$(nproc)}"

echo "==> CPU features detected:"
grep -o -m1 -E '\b(avx|avx2|avx512f|avx512_vnni|avx_vnni|amx_tile|f16c|fma)\b' /proc/cpuinfo \
  | sort -u | tr '\n' ' ' || true
echo

if [[ ! -d "${LLAMA_PREFIX}/.git" ]]; then
  echo "==> cloning llama.cpp into ${LLAMA_PREFIX}"
  mkdir -p "$(dirname "${LLAMA_PREFIX}")"
  git clone "${LLAMA_REPO}" "${LLAMA_PREFIX}"
fi

cd "${LLAMA_PREFIX}"
echo "==> checking out ${LLAMA_REF}"
git fetch --tags --prune origin
git checkout --quiet "${LLAMA_REF}"
git pull --ff-only 2>/dev/null || true   # no-op when LLAMA_REF is a tag/sha
BUILT_REF="$(git rev-parse --short HEAD)"

# GGML_NATIVE=ON is llama.cpp's own switch for -march=native.
# BUILD_SHARED_LIBS=OFF gives a self-contained binary, simpler to move around.
# LLAMA_CURL=ON lets llama-server pull models by URL if you ever want that.
echo "==> configuring (Release, native ISA)"
cmake -B build \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_NATIVE=ON \
  -DGGML_LTO=ON \
  -DLLAMA_CURL=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF

echo "==> building with ${JOBS} jobs (this takes a few minutes)"
cmake --build build --config Release -j "${JOBS}" --target llama-server llama-cli llama-bench

install -d /usr/local/bin
for b in llama-server llama-cli llama-bench; do
  src="$(find "${LLAMA_PREFIX}/build" -maxdepth 3 -type f -name "$b" -perm -u+x | head -1)"
  [[ -n "$src" ]] || { echo "error: built binary $b not found" >&2; exit 1; }
  install -m 0755 "$src" "/usr/local/bin/$b"
done

echo "${BUILT_REF}" > /var/lib/llm/.llama-cpp-ref 2>/dev/null || true

echo
echo "==> installed at ref ${BUILT_REF}:"
llama-server --version 2>&1 | head -3 || true
echo
echo "NOTE: llama.cpp renames flags occasionally. If the service fails to start"
echo "after an upgrade, diff 'llama-server --help' against inference/models.env"
echo "before assuming something is broken. Upgrade one worker at a time and"
echo "benchmark it against the others -- see docs/05-operations.md."
