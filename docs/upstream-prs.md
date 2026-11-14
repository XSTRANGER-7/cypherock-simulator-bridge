# Upstream PR plan

Two small PRs are easier to review than one large one. Open an issue first in each repo, describing the problem and the plan, and link the bridge repo as a working demo.

## Issue text (adapt)

> **Title:** Connect the SDK to the firmware simulator for hardware-free testing
>
> Today every SDK test needs a physical X1. The firmware already has a simulator, but its USB receive path is stubbed, so the SDK cannot talk to it. I've built a small TCP bridge (C side + an SDK transport package) and have it working end to end: `ManagerApp.getDeviceInfo()` returns real data from the simulator. Demo and tests: <link>. Would you accept two small PRs, one per repo?

## PR 1: x1_wallet_firmware

**Branch:** `feat/simulator-communication`

- [ ] Adds `simulator/transport/` (sim_socket, sim_transport, cmake snippet)
- [ ] Includes it only in the simulator build
- [ ] Calls `sim_transport_init()` / `sim_transport_tick()` from the simulator loop
- [ ] Routes simulator USB receive/transmit through the bridge
- [ ] No change to device (STM32) builds; verify with the documented Device build command
- [ ] Binds to 127.0.0.1 only
- [ ] README or `docs/` note on running the simulator with the bridge
- [ ] Conventional commit: `feat(simulator): add tcp bridge for sdk communication`

## PR 2: sdk

**Branch:** `feat/simulator-transport`

- [ ] Adds `packages/hw-simulator` using real `@cypherock/sdk-interfaces` types
- [ ] Matches hw-hid's tsconfig, lint and test setup
- [ ] Unit tests with a mock device; no hardware needed
- [ ] Docs page in the SDK docs app
- [ ] Changeset added
- [ ] Conventional commit: `feat(hw-simulator): add simulator transport`

## PR description template

```
## What
<one paragraph>

## Why
Hardware-free development and CI for the SDK.

## How it was tested
- Unit tests: <n> passing
- End to end: getDeviceInfo against simulator built from <commit>
- Device build unchanged: <command> succeeds

## Screenshots / logs
<terminal output of examples/get-device-info.ts>
```

## If the PRs sit unreviewed

The public repos have had little maintainer activity. That's fine:
- Keep this repo public with pinned commits of your forks.
- Link the PRs and the demo in your application and outreach.
- An unmerged but well-tested PR still shows exactly the skills the team hires for.
