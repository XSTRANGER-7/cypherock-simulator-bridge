# Firmware integration

All firmware changes are in [`firmware-patch/x1_wallet_firmware.patch`](../firmware-patch/x1_wallet_firmware.patch). It applies cleanly to upstream `x1_wallet_firmware` at `5b11739d` and is the content of the fork branch `feat/simulator-communication`.

```bash
cd x1_wallet_firmware
git apply ../cypherock-simulator-bridge/firmware-patch/x1_wallet_firmware.patch
```

## What the patch changes

| File | Change | Why |
| --- | --- | --- |
| `simulator/transport/sim_socket.{c,h}` (new) | Non-blocking TCP frame server on 127.0.0.1, POSIX + Winsock | Generic; knows nothing about Cypherock |
| `simulator/transport/sim_transport.{c,h}` (new) | Receive callback, `CYPHEROCK_SIM_LOOPBACK`, `CYPHEROCK_SIM_VERBOSE` hex trace, re-entry guard | Runtime switches; same binary for loopback and real mode |
| `simulator/USB/sim_usb.c` | `SIM_Receive_FS()` calls `comm_packet_parser(buf, len, COMM_LIBUSB__HID)`; `SIM_Transmit_FS()` calls `sim_transport_write()`; `SIM_USB_DEVICE_Init()` starts the bridge | Replaces the file-based stub (`/tmp/cypherock_device_*.bin`) whose receive was a `TODO` |
| `simulator/BSP/board.c` | `BSP_DelayMs()` polls the bridge in 5 ms slices | The old poll (`src/main.c:163`) is compiled out; `get_events()` calls `BSP_DelayMs(50)` every pass, like the USB IRQ during waits |
| `utilities/cmake/simulator/simulator.cmake` | Include `simulator/transport`; link `ws2_32` on Windows; `-std=gnu17` and four `-Wno-error=` on GCC 14+ | Sources are already globbed (`simulator/*.*`) |
| `simulator/testing/sim_test_wallet.{c,h}` (new, optional) | Adds a `SIMTEST` flash wallet for `CYPHEROCK_SIM_TEST_MNEMONIC` | The emulated card cannot rebuild seeds (see limitations) |
| `src/wallet/reconstruct_wallet_flow.c` (optional) | Inside `#if USE_SIMULATOR == 1`: if the requested wallet id matches the test mnemonic, derive the seed from it | Pairs with `SIMTEST`; compiled out of device builds |

Nothing outside `simulator/` changes except the optional test-wallet block, which is guarded by `USE_SIMULATOR == 1` (device builds define `USE_SIMULATOR=0`, `firmware.cmake:163`) and does nothing unless the env var is set. The device build never compiles `simulator/` (`firmware.cmake` globs `stm32-hal/`, `src/`, `common/...`).

## Why not register the parser in `usb_init()`

`usb_init()` registers `comm_packet_parser` with `lusb_register_parserFunction()`, which lives in the device-only libusb code (`usb_api.c:71-73, 132-136`). Calling the parser straight from `SIM_Receive_FS()` has the same effect and keeps shared code untouched.

## Verify

```bash
./scripts/build-simulator.sh
CYPHEROCK_SIM_LOOPBACK=1 ./scripts/start-simulator.sh --echo   # or the real binary with LOOPBACK=1
npx tsx examples/connect.ts                                    # echo "hello x1"
./scripts/stop-simulator.sh
./scripts/start-simulator.sh && npx tsx examples/raw-status.ts # firmware answers STATUS_REQ
```

Firmware unit tests still pass with the patch: `./utilities/run_unit_tests.sh -f main -p simulator` (130 tests, 0 failures, Nov 15, 2026).
