#!/usr/bin/env bash
# Unit tests for bootstrap.sh's auto-detection helpers.
#
# These decide the CTID, IP address and memory size for a real container, so a
# silent wrong answer here means a duplicate IP on a live LAN or a container
# that OOMs hours later. bootstrap.sh returns early when sourced, so the
# helpers can be exercised without touching Proxmox.
#
#   ./tests/test-bootstrap-helpers.sh
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/bootstrap.sh"
pass=0; fail=0
check() { # check <desc> <expected> <actual>
  if [[ "$2" == "$3" ]]; then printf '  ok   %-52s = %s\n' "$1" "$3"; ((pass++))
  else printf '  FAIL %-52s expected %s got %s\n' "$1" "$2" "$3"; ((fail++)); fi
}

echo "next_free_ctid:"
check "empty cluster -> 200"            200 "$(next_free_ctid "")"
check "200,201 used -> 202"             202 "$(next_free_ctid "$(printf '200\n201\n')")"
check "gap at 201 is reused"            201 "$(next_free_ctid "$(printf '200\n202\n203\n')")"
check "VM ids counted too"              204 "$(next_free_ctid "$(printf '200\n201\n202\n203\n')")"
next_free_ctid "$(seq 200 299)" >/dev/null 2>&1
check "exhausted range returns nonzero"  1  "$?"

echo; echo "size_memory (MiB), host keeps 4 GB headroom:"
check "32 GB host, workhorse -> 28 GB"  28672 "$(size_memory 32 workhorse)"
check "64 GB host, workhorse caps 28"   28672 "$(size_memory 64 workhorse)"
check "20 GB host, workhorse -> 16 GB"  16384 "$(size_memory 20 workhorse)"
check "16 GB host, fast -> 12 GB"       12288 "$(size_memory 16 fast)"
check "10 GB host, fast -> 6 GB"         6144 "$(size_memory 10 fast)"
check "8 GB host, embed -> 4 GB"         4096 "$(size_memory 8 embed)"
check "6 GB host -> 0 (refuses)"            0 "$(size_memory 6 workhorse)"
check "4 GB host -> 0 (refuses)"            0 "$(size_memory 4 fast)"

echo; echo "size_disk (GB):"
check "workhorse holds an 18 GB model"  120 "$(size_disk workhorse)"
check "fast"                             60 "$(size_disk fast)"
check "gateway"                          40 "$(size_disk gateway)"

echo; echo "next_free_ip -- refuses to guess when it cannot detect live hosts:"
PROBE_METHOD=""
next_free_ip 10.9.9 99 200 205 >/dev/null 2>&1
check "no working probe -> returns 2 (refuse)"  2 "$?"

probe_init 999.999.999.999 "" ; rc=$?
check "probe_init fails on an unreachable target" 1 "$rc"
check "  and leaves PROBE_METHOD empty"           "" "$PROBE_METHOD"

# Simulate a working probe: pretend .201 and .202 are occupied.
PROBE_METHOD="stub"
probe_alive() { [[ "$1" == "10.9.9.201" || "$1" == "10.9.9.202" ]]; }
check "skips occupied .201 and .202"  "10.9.9.203" "$(next_free_ip 10.9.9 99 201 210)"
check "skips the host's own octet"    "10.9.9.204" "$(next_free_ip 10.9.9 203 201 210)"
next_free_ip 10.9.9 99 201 202 >/dev/null 2>&1
check "range fully occupied -> 1"  1 "$?"

echo
printf 'passed %d, failed %d\n' "$pass" "$fail"
exit $(( fail > 0 ))
