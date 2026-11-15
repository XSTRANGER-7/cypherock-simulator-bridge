#!/usr/bin/env bash
# Checks dependencies and clones your two forks next to this repo.
#
#   GITHUB_USER=yourname ./scripts/setup.sh
source "$(dirname "$0")/common.sh"

info "Checking dependencies"
require git   "install git"
require node  "install Node 18+ (nvm recommended)"
require cmake "install CMake 3.25+"
require make  "install build-essential"
require cc    "install a C compiler (gcc or clang)"
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found; installing with npm"
  npm i -g pnpm
fi
command -v docker >/dev/null 2>&1 || warn "docker not found: only needed if you build firmware in Cypherock's container"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 18 ] || fail "Node 18+ required (found $(node -v))"

clone_fork() {
  local name="$1" dir="$2" ref="$3"
  if [ -d "$dir/.git" ]; then
    info "$name already present at $dir"
  else
    [ "$GITHUB_USER" = "YOUR_GITHUB_USERNAME" ] && fail "set GITHUB_USER to your GitHub username"
    info "Cloning your fork of $name"
    git clone --recurse-submodules "https://github.com/$GITHUB_USER/$name.git" "$dir"
    git -C "$dir" remote add upstream "https://github.com/Cypherock/$name.git" || true
  fi
  if git -C "$dir" rev-parse --verify --quiet "$ref" >/dev/null; then
    git -C "$dir" checkout "$ref"
  else
    warn "$name: ref '$ref' not found yet, staying on current branch"
  fi
}

clone_fork x1_wallet_firmware "$FIRMWARE_DIR" "$FIRMWARE_REF"
clone_fork sdk "$SDK_DIR" "$SDK_REF"

info "Building the standalone C bridge"
make -C "$BRIDGE_ROOT/firmware-patch"

info "Installing bridge dev dependencies"
(cd "$BRIDGE_ROOT" && npm install)

info "Setup complete. Next: ./scripts/build-simulator.sh"
