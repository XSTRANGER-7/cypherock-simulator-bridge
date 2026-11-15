# Limitations and safety

Measured on Nov 15, 2026 with firmware `5b11739d` and SDK `4e44158`.

## What works

| Flow | Result | Firmware code that answers |
| --- | --- | --- |
| SDK handshake (`*.create()`) | Works, SDK version `3.0.0`, packet version v3 | `usb_rx_parser.c` (legacy command 88) |
| `ManagerApp.getDeviceInfo()` | Works (no firmware version, see below) | `apps/manager_app/get_device_info.c` |
| `ManagerApp.getWallets()` | Works | `apps/manager_app/export_wallets.c` |
| `EvmApp.getPublicKeys()` | Works with the `SIMTEST` wallet | `apps/evm_family/evm_pub_key.c` |
| `EvmApp.signTxn()` (chain id 1) | Works with the `SIMTEST` wallet; signature verified by viem and ethers | `apps/evm_family/evm_sign_txn.c` |
| Disconnect, reconnect, busy device | Clear SDK errors, no hangs | `sim_socket.c`, sdk-core |

## Known limits

| Limit | Why | What to do |
| --- | --- | --- |
| `firmwareVersion` missing from device info | On a real X1 the bootloader writes the version into permanent flash; the simulator has no bootloader, so `get_fwVer()` returns `0xFFFFFFFF` and `get_device_info.c` leaves the field out | Follow-up: seed `bootData.fwVer` from `version.txt` in simulator builds |
| Card flows (create wallet, restore, seed rebuild from cards) | The simulator's emulated card (`simulator/nfc/applet.c`) speaks an old plaintext APDU set; the firmware encrypts card APDUs (`nfc_exchange_apdu`, `apdu_encrypt_data`) with no simulator branch | Use `CYPHEROCK_SIM_TEST_MNEMONIC` (SIMTEST wallet). A real card emulator is a follow-up |
| On-screen confirmations are automatic | The simulator is built with `DEV_SWITCH=ON`; Cypherock's dev builds queue emulated key presses on every confirmation screen (`ui_scroll_page.c`, `ui_confirmation.c`) | Build with `SIM_DEV_SWITCH=OFF` to press keys yourself (arrows + Enter in the window) |
| One client at a time | Like one USB host: a new TCP connection closes the old one | Run one SDK process at a time |
| Socket opens before boot finishes | `SIM_USB_DEVICE_Init()` runs inside `application_init()`, before the boot logo; early commands get "executing some other command" | `start-simulator.sh` waits for `device_idle_state = IDLE` (`scripts/wait-ready.ts`) |
| Fixed device serial | The simulator fakes the secure element; every simulator reports the same serial | Do not use the serial to tell simulators apart |
| Sepolia transactions | The firmware ETH app rejects any chain id except 1 (`evm_txn_helpers.c:316`) | Sign chain-id-1 transactions offline; never broadcast |

## Host compiler notes

- GCC 14+ and 15+ (Windows MSYS2, Arch, Fedora 40+) are stricter than the device toolchain (GCC 10.3). `simulator.cmake` builds the simulator with `-std=gnu17` and keeps four checks as warnings on GCC 14+. Ubuntu 22.04 (GCC 11) is unaffected.
- Files that only build because of that: `apps/canton_app/canton_txn_encoding.c:969` and `src/wallet/wallet_unlock_flow.c:306` (return with a value in a `void` function), `apps/near_app/near_txn_helpers.c:105` (return without a value), `common/libraries/crypto/mpz_operations/mpz_ecdsa.c:110,118` (missing includes for `memzero`, `random32`), `common/libraries/util/dev_utils.c:95` (`ekp_is_empty()` declared without parameters, called with one). Worth a small separate upstream fix.

## Safety rules

- Development only. Never use the simulator with real funds.
- Test mnemonics only. The simulator's flash and card files are plain files in `.sim-state/`.
- The socket binds to 127.0.0.1 only. Do not change the bind address.
- Simulator builds must never be signed with release keys or shipped.

## Reporting security issues

If you find a firmware vulnerability while working on this, do not open a public issue or PR. Email bounty@cypherock.com as described in Cypherock's bug bounty policy.
