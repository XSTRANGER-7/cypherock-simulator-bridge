# Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `SIM_CONNECTION_REFUSED` | Simulator not running, or bridge not initialised | `./scripts/start-simulator.sh`; check the log for `[sim_socket] listening on` |
| `start-simulator.sh` says socket did not open | `sim_transport_init()` not called | Add it to the simulator start-up (firmware-integration.md, phase 2) |
| Port already in use | Old simulator still running | `./scripts/stop-simulator.sh` or `CYPHEROCK_SIM_PORT=52641` on both sides |
| Echo works, SDK call hangs | Frames reach the bridge but not the firmware parser | Phase 3a: check `SIM_FIRMWARE_RX` and parser registration |
| SDK call hangs, simulator log shows frames | Firmware answers but transmit is not routed back | Phase 3b: call `sim_transport_write()` from the transmit function |
| Firmware rejects packets | Frame size or report ID byte mismatch | See docs/protocol.md "Frame-size open question" |
| Garbled responses | Both sides disagree on `FRAME_SIZE` | Set the same value in constants.ts and sim_socket.h |
| `Could not load @cypherock/sdk-app-manager` | SDK fork not built | `cd ../sdk && pnpm i && pnpm build`, or `npm i @cypherock/sdk-app-manager` |
| Build error `Define SIM_FIRMWARE_RX` | Loopback off but receive function not wired | Define it (phase 3a) or build with `SIM_TRANSPORT_LOOPBACK=ON` |
| Simulator window does not open in WSL | No display | Use WSLg (Windows 11) or an X server |

## Debug switches

| Variable | Side | Effect |
| --- | --- | --- |
| `DEBUG=1` | examples | Print every tx/rx frame in hex |
| `CYPHEROCK_SIM_VERBOSE=1` | simulator | Log client connects and disconnects |
| `CYPHEROCK_SIM_PORT` | both | Change the port |
| `CYPHEROCK_SIM_HOST` | SDK | Change the host (keep it local) |
