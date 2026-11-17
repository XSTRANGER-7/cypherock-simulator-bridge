# Testing: every way to try it

Eight ways to test, from "just a browser" to "full CI". Each one says what it proves. All results below are from Nov 15, 2026 (firmware `5b11739d` + bridge patch, SDK `4e44158` + `hw-simulator`).

| # | Way | Needs | What it proves | Command | Last result |
| --- | --- | --- | --- | --- | --- |
| 0 | Online (GitHub Pages) | A browser | The real firmware (WebAssembly) and SDK run in your tab, no install | Open https://xstranger-7.github.io/cypherock-simulator-bridge/play/ | 11/11 levels in headless Chrome before every deploy ([how](deploy.md)) |
| 1 | Docker playground | Docker | Anyone can try real SDK calls in a browser | `docker run --rm -p 127.0.0.1:3000:3000 x1-sim-playground` | Built and smoke-tested in CI (`docker` job) |
| 2 | Web playground: X1 Quest game (local) | Built simulator + SDK | Same, on your machine, guided level by level | `npm run playground:web` | 11/11 levels in a headless browser; API smoke 33/33 |
| 3 | Example scripts | Built simulator + SDK | One SDK call each, with output you can paste | `npx tsx examples/<name>.ts` | All pass ([outputs](notes/)) |
| 4 | Capability matrix | Built simulator + SDK | Which SDK operations work in the simulator | `npm run capabilities` | 37 pass, 0 fail, 1 needs a key press, 6 not run ([report](notes/capabilities.md)) |
| 5 | Test layers 1-4 | Node; gcc for layer 1/3; simulator for 4 | Transport, C bridge, both together, SDK against firmware | `CYPHEROCK_SIM=1 ./scripts/run-tests.sh` | 17 + 2 + 8 pass (C unit tests on Linux/macOS) |
| 6 | SDK package tests | SDK fork | `@cypherock/sdk-hw-simulator` contract, real sdk-core handshake | `pnpm --filter @cypherock/sdk-hw-simulator test` | 14/14 |
| 7 | Firmware unit tests | Firmware build | The patch breaks nothing in the firmware | `./utilities/run_unit_tests.sh -f main -p simulator` | 130 tests, 0 failures |

Plus a browser test of the game itself: `npx tsx tools/playground-ui-test.ts` (headless Edge/Chrome plays all 11 levels, fails on any red check, saves screenshots in [notes/](notes/)).

## 0. Online (nothing to install)

Open https://xstranger-7.github.io/cypherock-simulator-bridge/play/ (or the product page at https://xstranger-7.github.io/cypherock-simulator-bridge/ and **Launch X1 Quest**) and press **Power on** in level 0. The firmware boots in your tab in a few seconds, and its real screen appears above the live wire. Reloading the page gives a fresh device. Build and test it locally with `npm run web:build`, `npm run web:serve` and `UI_SHOT_PREFIX=web- npx tsx tools/playground-ui-test.ts http://127.0.0.1:8090/play/` (see [deploy.md](deploy.md)).

## 1. Docker (any OS with Docker)

```bash
git clone https://github.com/XSTRANGER-7/cypherock-simulator-bridge.git
cd cypherock-simulator-bridge
docker build -t x1-sim-playground -f docker/Dockerfile .     # ~15 min: builds firmware + SDK
docker run --rm -p 127.0.0.1:3000:3000 x1-sim-playground
# open http://127.0.0.1:3000 and wait for "Simulator: running"
```

The image clones Cypherock's upstream repos at the pinned commits, applies `firmware-patch/` and `sdk-patch/`, builds the simulator, and runs it headless under Xvfb next to the playground. Publish the port on `127.0.0.1` only.

## 2. Web playground on your machine

```bash
./scripts/build-simulator.sh            # once (Linux, macOS, or Windows MSYS2 shell)
npm run playground:web                  # http://127.0.0.1:3000
```

The page is a guided game (X1 Quest). Level 0 powers on the simulator (its window opens); each next level unlocks when the current one passes. Every level shows what you do, why it matters and where it is used, advances its steps on real packets, animates the result and runs real checks on it. Level 10 runs all 33 checks. The right panel animates every 64-byte frame and lists it decoded (`CMD seq=12 chunk 1/1 len=48 | 5555...`) with the simulator's log. `/classic.html` keeps the plain all-buttons view.

Operations: raw status packet, device info, wallets; EVM address on 9 chains (any index); sign EIP-1559 transaction (any chain, to, value); sign message (EIP-191); sign EIP-712; Bitcoin, segwit, Litecoin, Dogecoin, Dash xpubs; Solana, NEAR, Tron, XRP, Starknet, ICP, Stellar, Constellation, Sia, Canton public keys. EVM keys, signatures and the BTC xpub show **verified** when ethers derives the same result from the test mnemonic.

Safety: the server binds to `127.0.0.1`, rejects any non-local `Host` header (DNS rebinding) and any POST that is not JSON (cross-site forms). Automate it with `npx tsx tools/playground-smoke.ts`.

## 3. Example scripts

```bash
export CYPHEROCK_SIM_TEST_MNEMONIC="test test test test test test test test test test test junk"
./scripts/start-simulator.sh
npx tsx examples/raw-status.ts          # one STATUS_REQ packet, no SDK
npx tsx examples/get-device-info.ts     # M1
npx tsx examples/get-wallets.ts         # M2
npx tsx examples/get-eth-address.ts     # firmware address vs ethers
npx tsx examples/sign-tx.ts             # M4: viem + ethers verify the signature
USE_SDK_TRANSPORT=1 npx tsx examples/get-device-info.ts   # through the SDK fork's package
./scripts/stop-simulator.sh
```

## 4. Capability matrix

```bash
./scripts/start-simulator.sh && npm run capabilities; ./scripts/stop-simulator.sh
```

Writes [notes/capabilities.md](notes/capabilities.md). Summary of the last run:

| Area | Works | Notes |
| --- | --- | --- |
| Manager | getDeviceInfo, getWallets, getLogs (answers "logs disabled", the default), trainJoystick, trainCard | selectWallet waits for a joystick choice; authDevice/authCard need Cypherock's server; updateFirmware needs a bootloader |
| EVM | getPublicKeys on Ethereum, Polygon, BNB Chain, Fantom, Avalanche, Optimism, Arbitrum, Base, Hyperliquid; getUserVerifiedPublicKey; signTxn (chains 1, 137, 8453); signPersonalMsg; signEthMsg; signTypedMsg | All keys and signatures verified with ethers |
| Bitcoin family | getXpubs for BTC (44', 84'), LTC, DOGE, DASH; getPublicKey | BTC xpub verified with ethers; signTxn needs real UTXO data (not attempted) |
| Other coins | getPublicKeys for Solana, NEAR, Tron, XRP, Starknet, ICP, Stellar, Constellation, Sia, Canton | signTxn not attempted (needs chain-specific transactions) |

## What the simulator emulates (hardware)

| X1 hardware | In the simulator | State |
| --- | --- | --- |
| USB to the host | TCP bridge on 127.0.0.1:52640 (this project) | Works |
| Display | SDL window (LVGL monitor driver) | Works |
| Joystick | Keyboard: arrows, Enter, Esc; dev builds also auto-press confirm screens | Works |
| Internal flash | Files in the state folder (`sim_data.bin`, `sim_pdata.bin`, ...) | Works |
| Secure element (ATECC608A) | Software stub: fixed serial, reports authenticated, no provisioned keys | Partial |
| NFC reader + X1 cards | File-backed fake card with an old plaintext command set; the firmware encrypts card commands | Card flows do not work; `SIMTEST` wallet instead |
| Random numbers | `rand()` (`simulator/BSP/board.c:204`) | Not secure: simulator only |
| Bootloader, firmware update | Not present | Not available |
| Buzzer | Empty stub | n/a |

## 5-7. Automated layers

```bash
CYPHEROCK_SIM=1 CYPHEROCK_SIM_TEST_MNEMONIC="test test test test test test test test test test test junk" ./scripts/run-tests.sh
(cd ../sdk && pnpm --filter @cypherock/sdk-hw-simulator test)
(cd ../x1_wallet_firmware && ./utilities/run_unit_tests.sh -f main -p simulator)
```

## CI

`.github/workflows/ci.yml` runs on every push: the bridge job (typecheck, C unit tests, transport, TS <-> C), the simulator job (builds upstream + patches on Ubuntu 22.04; layers 1-4, every example, the capability matrix in the job summary, the playground smoke test) and the Docker job (builds the image, starts it, drives the playground from outside). `.github/workflows/pages.yml` builds the browser version (firmware to WebAssembly, SDK bundled), plays all 11 levels in headless Chrome and publishes it to GitHub Pages.
