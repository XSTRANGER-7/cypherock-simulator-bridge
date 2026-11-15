#!/usr/bin/env bash
# Builds the X1 firmware simulator from your firmware fork.
#
# Values come from x1_wallet_firmware/CMakeLists.txt (CMAKE_BUILD_PLATFORM=
# Simulator) and utilities/cmake/simulator/simulator.cmake (output in bin/).
# Works on Linux, macOS and Windows (MSYS2 MinGW shell).
source "$(dirname "$0")/common.sh"

[ -d "$FIRMWARE_DIR" ] || fail "firmware not found at $FIRMWARE_DIR"
[ -d "$FIRMWARE_DIR/common/cypherock-common/proto" ] ||
  fail "firmware submodules are empty; see docs/setup.md (submodule URLs)"
cd "$FIRMWARE_DIR"

GENERATOR="${CMAKE_GENERATOR:-}"
if [ -z "$GENERATOR" ]; then
  if command -v ninja >/dev/null 2>&1; then GENERATOR="Ninja"; else GENERATOR="Unix Makefiles"; fi
fi

info "Configuring simulator build in $SIM_BUILD_DIR ($GENERATOR)"
cmake -S . -B "$SIM_BUILD_DIR" -G "$GENERATOR" \
  -DCMAKE_BUILD_PLATFORM:STRING=Simulator \
  -DFIRMWARE_TYPE=Main \
  -DCMAKE_BUILD_TYPE:STRING="${SIM_BUILD_TYPE:-Debug}" \
  -DDEV_SWITCH="${SIM_DEV_SWITCH:-ON}" \
  -DUNIT_TESTS_SWITCH:BOOL=OFF

info "Building"
cmake --build "$SIM_BUILD_DIR" -j"$(nproc 2>/dev/null || echo 4)"

BIN="$FIRMWARE_DIR/bin/Cypherock_Simulator"
[ -f "$BIN.exe" ] && BIN="$BIN.exe"
[ -f "$BIN" ] || fail "build finished but $BIN was not found"
echo "$BIN" > "$SIM_BUILD_DIR/.simulator-path"
info "Simulator binary: $BIN"
