#!/usr/bin/env bash
# Stops whatever start-simulator.sh launched, including child processes
# (npx/tsx start the mock device as a grandchild).
source "$(dirname "$0")/common.sh"

kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

if [ -f "$SIM_PID_FILE" ]; then
  pid="$(cat "$SIM_PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    kill_tree "$pid"
    info "Stopped pid $pid"
  fi
  rm -f "$SIM_PID_FILE"
else
  info "Nothing running"
fi
