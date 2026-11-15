# Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `SIM_CONNECTION_REFUSED` / `CON_0100` | Simulator not running | `./scripts/start-simulator.sh`; the log must show `[sim_socket] listening on 127.0.0.1:52640` |
| `[sim_transport] bridge not started (port busy?)` | Another simulator (or the echo server) holds the port | `./scripts/stop-simulator.sh`, or `CYPHEROCK_SIM_PORT=52641` on both sides |
| `The device is executing some other command` right after start | Commands sent while the firmware is still booting (`device_idle_state=DEVICE`) | Start with `start-simulator.sh` (it waits for `IDLE`), or run `npx tsx scripts/wait-ready.ts` |
| `Connection was closed while in process` / `CON_0101` | A second client connected; the bridge serves one client at a time | Use one connection per process; do not run two SDK scripts at once |
| `create()` fails with `UNKNOWN_COMMUNICATION_ERROR` at once | Transport `peek()` returns raw arrays instead of `{id, data}` | Use the transport from this repo or the SDK fork (sdk-core's legacy handshake reads `poolItem.id` / `poolItem.data`) |
| A test loop never sees replies | `receive()` never waits; a tight `while` loop starves the socket | Yield between polls (`await sleep(2)`), as sdk-core does |
| `wallets: 0` | Simulator started without the test mnemonic | Start it with `CYPHEROCK_SIM_TEST_MNEMONIC=...`, or create a wallet in the UI (card flows are limited, see limitations.md) |
| `SIMTEST wallet ... exists for a different mnemonic` | Old state files | Delete `.sim-state/` |
| `getEthersLib` error from app-evm | ethers not injected | `setEthersLib(ethers)` (ethers v6) before `EvmApp.create` |
| Firmware build: `No module named 'pkg_resources'` | setuptools >= 81 | `pip install "setuptools<81"` in the build venv |
| Firmware build: `return with a value, in function returning void` and similar | GCC 14+ | The patch's `simulator.cmake` handles it; re-run the CMake configure |
| SDK prebuild: `%1 is not a valid Win32 application` | protoc got the shell-script plugin instead of `.CMD` (Git Bash with `OSTYPE=cygwin`) | Build from the MSYS2 shell, see setup.md |
| Simulator window does not open in WSL | No display | WSLg on Windows 11, or `xvfb-run` for headless |

## Debug switches

| Variable | Side | Effect |
| --- | --- | --- |
| `CYPHEROCK_SIM_VERBOSE=1` | simulator | Hex trace of every frame (`rx`/`tx`), client connects |
| `CYPHEROCK_SIM_LOOPBACK=1` | simulator | Echo frames instead of calling the firmware |
| `DEBUG=1` | examples | Bridge transport logs every frame |
| `LOG_LEVEL=debug` | SDK | sdk-core and the SDK transport log packets |
| `CYPHEROCK_SIM_PORT` / `CYPHEROCK_SIM_HOST` | both / SDK | Change port or host (keep it local) |

Use `gdb --args x1_wallet_firmware/bin/Cypherock_Simulator` with breakpoints on `comm_packet_parser`, `comm_process_packet`, `send_error_packet` and `SIM_Transmit_FS` to see where a packet stops.
