# Roadmap

| Milestone | Outcome | Proof |
| --- | --- | --- |
| 0. Bridge | TS transport and C bridge agree on the wire | `./scripts/run-tests.sh` layers 1 to 3 (done) |
| 1. First call | `getDeviceInfo` answered by firmware | `examples/get-device-info.ts` output |
| 2. Read-only flows | Wallet list, ETH and BTC public keys | `get-wallets.ts`, `get-eth-address.ts` |
| 3. Card flows | Document or stub card taps in the simulator | Notes in limitations.md |
| 4. Signing | Sign a Sepolia transaction end to end | Signed tx verified with viem |
| 5. CI | GitHub Action builds simulator and runs SDK tests | Green workflow badge |
| 6. Web playground | Browser UI showing requests, frames, simulator screen | Live demo link |

## Ideas after that

- A `--headless` simulator mode for CI (no window)
- Scripted "user" input (approve/reject on the device) for automated tests
- Fault injection: drop frames, delay replies, disconnect mid-message
- Recording and replaying sessions as test fixtures
