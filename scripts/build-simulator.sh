#!/usr/bin/env bash
# Builds the X1 firmware simulator from your firmware fork.
#
# The simulator platform name is read from CMakeLists.txt rather than
# hard-coded, because HACKING.md only documents the Device build.
source "$(dirname "$0")/common.sh"

[ -d "$FIRMWARE_DIR" ] || fail "firmware not found at $FIRMWARE_DIR (run setup.sh)"
cd "$FIRMWARE_DIR"

PLATFORM="${SIM_PLATFORM:-}"
if [ -z "$PLATFORM" ]; then
  if grep -qi '"Simulator"' CMakeLists.txt || grep -qi 'STREQUAL[[:space:]]*"\?Simulator' CMakeLists.txt; then
    PLATFORM="Simulator"
  else
    warn "Could not find a Simulator platform in CMakeLists.txt."
    warn "Inspect it:  grep -ni 'BUILD_PLATFORM' CMakeLists.txt"
    fail "then rerun with SIM_PLATFORM=<value> ./scripts/build-simulator.sh"
  fi
fi

info "Configuring simulator build (CMAKE_BUILD_PLATFORM=$PLATFORM)"
cmake -B "$SIM_BUILD_DIR" \
  -DDEV_SWITCH=ON \
  -DUNIT_TESTS_SWITCH:BOOL=OFF \
  -DSIGN_BINARY=OFF \
  -DCMAKE_BUILD_TYPE:STRING="Debug" \
  -DFIRMWARE_TYPE="Main" \
  -DCMAKE_BUILD_PLATFORM:STRING="$PLATFORM" \
  -DSIM_TRANSPORT_LOOPBACK="${SIM_TRANSPORT_LOOPBACK:-OFF}" \
  -G "${CMAKE_GENERATOR:-Ninja}"

info "Building"
cmake --build "$SIM_BUILD_DIR" -- -j"$(nproc 2>/dev/null || echo 4)"

BIN="$(find "$SIM_BUILD_DIR" -maxdepth 2 -type f -perm -u+x \( -iname '*simulator*' -o -iname 'Cypherock-Main' \) | head -1)"
[ -n "$BIN" ] || fail "build finished but no simulator executable was found in $SIM_BUILD_DIR"
echo "$BIN" > "$SIM_BUILD_DIR/.simulator-path"
info "Simulator binary: $BIN"
