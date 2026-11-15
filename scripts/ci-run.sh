#!/usr/bin/env bash
# CI helper: runs a command, keeps its output, and on failure prints the last
# lines (plus the simulator log) as a GitHub error annotation, so the reason is
# visible in the run summary and through the public API without log access.
#
#   scripts/ci-run.sh "<title>" <command> [args...]
title="$1"
shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  encode() { sed -e 's/%/%25/g' -e 's/\r//g' | awk 'BEGIN{ORS="%0A"} {print}'; }
  echo "::error title=${title} (exit ${status})::$(tail -n 60 "$log" | encode)"
  if [ -f .sim.log ]; then
    echo "::error title=${title}: simulator log::$(tail -n 40 .sim.log | encode)"
  fi
  if [ -f playground.log ]; then
    echo "::error title=${title}: playground log::$(tail -n 40 playground.log | encode)"
  fi
fi
rm -f "$log"
exit "$status"
