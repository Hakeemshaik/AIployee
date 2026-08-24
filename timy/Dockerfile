# Timy.ai container image, for Coolify / plain Docker deployment.
#
# Note the deliberate asymmetry with the rest of this repo: Timy is a web app
# and containerises well. The llama.cpp inference workers do NOT -- they want
# mlock, a native-ISA build, CPU pinning and host-level memory control, all of
# which Docker gets in the way of. Keep those on LXC + systemd.
# See llm-lab/docs/07-coolify-and-self-hosted-git.md.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first, so a persona.md or UI edit does not invalidate the
# pip layer -- which is the layer that takes time to rebuild.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./api/
COPY ui/ ./ui/
COPY persona.md ./persona.md

# knowledge/ and data/ are volumes in real deployments: knowledge is content you
# edit without rebuilding, and data holds the feedback log you must not lose on
# redeploy. Create them so the app starts cleanly even with nothing mounted.
RUN mkdir -p /app/knowledge /app/data

# Unprivileged. Only /app/data needs to be writable.
RUN useradd --system --uid 10001 --no-create-home timy \
 && chown -R timy:timy /app/data
USER timy

ENV TIMY_HOST=0.0.0.0 \
    TIMY_PORT=8090
EXPOSE 8090

# Coolify reads this for container health. Uses the app's own health endpoint,
# which also reports whether the upstream cluster is reachable.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/api/health',timeout=8).status==200 else 1)"

CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8090"]
