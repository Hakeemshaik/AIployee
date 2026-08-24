# Convenience targets. Most real work happens on the nodes; these are the
# things you run from a workstation or the gateway.

GATEWAY ?= http://10.0.0.201:4000
API_KEY  ?=
MODEL    ?= workhorse

.PHONY: help bench bench-quick voice-check tune lint gateway-up gateway-down gateway-logs

help:
	@echo "Targets:"
	@echo "  make bench        GATEWAY=http://ip:4000 API_KEY=sk-...   full sweep"
	@echo "  make bench-quick  GATEWAY=...                            one fast scenario"
	@echo "  make voice-check  GATEWAY=...                            voice latency verdict"
	@echo "  make tune                                                CPU sweep (run ON a worker)"
	@echo "  make gateway-up   / gateway-down / gateway-logs          docker compose on pve-1"
	@echo "  make lint                                                shell + python checks"

bench:
	bench/run-suite.sh --base-url $(GATEWAY) $(if $(API_KEY),--api-key $(API_KEY),)

bench-quick:
	python3 bench/bench.py --base-url $(GATEWAY) $(if $(API_KEY),--api-key $(API_KEY),) \
		--model $(MODEL) --prompt-tokens 512 --max-tokens 128 --concurrency 1,4

# Measures with a voice-shaped prompt, then converts to a per-turn budget.
voice-check:
	python3 bench/bench.py --base-url $(GATEWAY) $(if $(API_KEY),--api-key $(API_KEY),) \
		--model $(MODEL) --prompt-tokens 2000 --max-tokens 64 --concurrency 1 \
		--json /tmp/voice-bench.json
	python3 bench/voice-budget.py /tmp/voice-bench.json

tune:
	inference/tune.sh

gateway-up:
	cd gateway && docker compose up -d && docker compose ps

gateway-down:
	cd gateway && docker compose down

gateway-logs:
	cd gateway && docker compose logs -f --tail=100 litellm

lint:
	@for f in $$(find . -name '*.sh'); do bash -n "$$f" && echo "ok   $$f"; done
	@for f in $$(find . -name '*.py'); do python3 -m py_compile "$$f" && echo "ok   $$f"; done
	@command -v shellcheck >/dev/null && shellcheck -S warning $$(find . -name '*.sh') || \
		echo "note: shellcheck not installed, skipped"
