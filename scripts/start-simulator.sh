#!/usr/bin/env bash
# Starts the simulator (or the echo server) and waits until the socket is up.
#
#   ./scripts/start-simulator.sh          real firmware simulator
#   ./scripts/start-simulator.sh --echo   C loopback bridge only (no firmware)
#   ./scripts/start-simulator.sh --mock   TypeScript mock device (no compiler needed)
source "$(dirname "$0")/common.sh"

MODE="${1:-sim}"

if [ -f "$SIM_PID_FILE" ] && kill -0 "$(cat "$SIM_PID_FILE")" 2>/dev/null; then
  info "Already running (pid $(cat "$SIM_PID_FILE"))"
  exit 0
fi

case "$MODE" in
  --echo)
    make -s -C "$BRIDGE_ROOT/firmware-patch" build/echo_server
    CMD=("$BRIDGE_ROOT/firmware-patch/build/echo_server")
    ;;
  --mock)
    CMD=(npx tsx "$BRIDGE_ROOT/packages/mock-device/src/index.ts")
    ;;
  *)
    PATH_FILE="$SIM_BUILD_DIR/.simulator-path"
    [ -f "$PATH_FILE" ] || fail "no simulator build found (run ./scripts/build-simulator.sh)"
    CMD=("$(cat "$PATH_FILE")")
    ;;
esac

info "Starting: ${CMD[*]} (port $SIM_PORT)"
CYPHEROCK_SIM_PORT="$SIM_PORT" "${CMD[@]}" >"$SIM_LOG" 2>&1 &
echo $! > "$SIM_PID_FILE"

for _ in $(seq 1 100); do
  if node -e "require('net').connect($SIM_PORT,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
    info "Ready on 127.0.0.1:$SIM_PORT (log: $SIM_LOG)"
    exit 0
  fi
  kill -0 "$(cat "$SIM_PID_FILE")" 2>/dev/null || { cat "$SIM_LOG" >&2; fail "process exited during start-up"; }
  sleep 0.1
done

cat "$SIM_LOG" >&2
fail "socket did not open within 10s. Is sim_transport_init() called at start-up?"
