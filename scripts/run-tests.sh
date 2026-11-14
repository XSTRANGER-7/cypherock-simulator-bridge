#!/usr/bin/env bash
# Runs every test layer that is possible on this machine.
#
#   1. C unit tests for the socket bridge        (needs a C compiler)
#   2. TypeScript transport tests vs mock device (needs Node)
#   3. TypeScript transport vs real C bridge     (needs 1)
#   4. Real SDK vs real firmware simulator       (needs both forks built
#                                                 and CYPHEROCK_SIM=1)
source "$(dirname "$0")/common.sh"
cd "$BRIDGE_ROOT"

info "1/4 C bridge unit tests"
make -s -C firmware-patch all test

info "2/4 Transport unit tests"
npx tsx --test packages/hw-simulator/tests/*.test.ts

info "3/4 Transport <-> C bridge"
npx tsx --test integration-tests/c-bridge.test.ts

if [ "${CYPHEROCK_SIM:-0}" = "1" ]; then
  info "4/4 SDK <-> firmware simulator"
  ./scripts/start-simulator.sh
  trap ./scripts/stop-simulator.sh EXIT
  npx tsx --test integration-tests/sdk-*.test.ts
else
  warn "4/4 skipped. Build the simulator and rerun with CYPHEROCK_SIM=1"
fi

info "All available test layers passed"
