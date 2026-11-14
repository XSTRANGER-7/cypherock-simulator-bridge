#!/usr/bin/env bash
# Shared settings for all scripts. Override any value with an env variable.

set -euo pipefail

BRIDGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="${CYPHEROCK_WORKSPACE:-$(cd "$BRIDGE_ROOT/.." && pwd)}"

GITHUB_USER="${GITHUB_USER:-YOUR_GITHUB_USERNAME}"
FIRMWARE_DIR="${FIRMWARE_DIR:-$WORKSPACE/x1_wallet_firmware}"
SDK_DIR="${SDK_DIR:-$WORKSPACE/sdk}"

# Pin the exact commits you tested against so anyone can reproduce results.
# Fill these in once your branches work (git rev-parse HEAD in each fork).
FIRMWARE_REF="${FIRMWARE_REF:-feat/simulator-communication}"
SDK_REF="${SDK_REF:-feat/simulator-transport}"

SIM_PORT="${CYPHEROCK_SIM_PORT:-52640}"
SIM_BUILD_DIR="${SIM_BUILD_DIR:-$FIRMWARE_DIR/build-sim}"
SIM_LOG="${SIM_LOG:-$BRIDGE_ROOT/.sim.log}"
SIM_PID_FILE="$BRIDGE_ROOT/.sim.pid"

info()  { printf '\033[1;34m[bridge]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[bridge]\033[0m %s\n' "$*" >&2; }
fail()  { printf '\033[1;31m[bridge]\033[0m %s\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "missing dependency: $1 ($2)"
}
