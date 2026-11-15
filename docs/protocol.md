# Wire protocol

## Transport framing (defined by this project)

| Property | Value |
| --- | --- |
| Transport | TCP, IPv4 |
| Address | 127.0.0.1 only |
| Default port | 52640 (`CYPHEROCK_SIM_PORT` overrides on both sides) |
| Frame size | 64 bytes, fixed (`COMM_PKT_MAX_LEN` in `usb_api_priv.h:30`) |
| Padding | Zero bytes after the packet |
| Report ID | Never sent. `hw-hid` prepends `0x00` for node-hid; the device's USB stack strips it, so the firmware never sees it |
| Clients | One; a new connection closes the old one |

SDK to simulator: each `connection.send(packet)` is one frame. Simulator to SDK: each `SIM_Transmit_FS(data, size)` is one frame (16 to 64 bytes of packet, zero-padded). The firmware gets `comm_packet_parser(frame, 64, COMM_LIBUSB__HID)` per frame; zero padding is skipped by the parser's `WAIT4_SOH1` state.

## Cypherock v3 packet (defined by Cypherock, unchanged)

Big endian. Firmware: `usb_internals.c:89-97`, `usb_rx_parser.c:85-104`. SDK: `packages/core/src/encoders/packet/packet.ts`.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 2 | `55 55` start of frame |
| 2 | 2 | CRC-16/XMODEM over bytes 4 to end of payload |
| 4 | 2 | chunk number (from 1) |
| 6 | 2 | total chunks |
| 8 | 2 | sequence number (`FF FF` for status and error) |
| 10 | 1 | packet type: 1 STATUS_REQ, 2 CMD, 3 CMD_OUTPUT_REQ, 4 STATUS, 5 CMD_ACK, 6 CMD_OUTPUT, 7 ERROR, 8 ABORT |
| 11 | 4 | timestamp (ignored by firmware) |
| 15 | 1 | payload length (0 to 48) |
| 16 | n | payload: first chunk starts with proto length (2) + raw length (2) |

`examples/lib/packets.ts` encodes and decodes these packets; `scripts/wait-ready.ts` decodes the `core.Status` protobuf inside `STATUS`.

## A real exchange, annotated

From [notes/simulator-trace.log](notes/simulator-trace.log) (`CYPHEROCK_SIM_VERBOSE=1`), first SDK call after boot:

```text
rx 64: 55 55 47 f4 00 01 00 01 ff ff 01 00 00 00 00 00 00 ...   STATUS_REQ (raw check)
tx 24: 55 55 b7 6f 00 01 00 01 ff ff 04 00 00 2b e1 08          STATUS, payload 8 bytes:
       00 04 00 00 10 01 18 01                                    proto len 4: device_idle_state=1 (IDLE), abort_disabled=1
rx 64: aa 58 07 00 01 00 01 00 45 85 00 ...                      legacy v1 SDK-version request (command 88 = 0x58)
tx 28: aa 01 0a 00 01 00 01 00 00 00 00 12 30                    legacy ACK
       aa 58 0c 00 01 00 01 00 03 00 00 00 00 bd 90               SDK version 3.0.0 -> sdk-core picks packet v3
rx 64: 55 55 49 bf 00 01 00 01 00 01 02 ... 0a 00 06 00 00 ...   CMD seq=1, chunk 1/1
tx 22: 55 55 29 de 00 01 00 01 00 01 05 ... 06 00 00 00 02 00 01  CMD_ACK seq=1, last chunk received = 1
rx 64: 55 55 83 a7 00 01 00 01 00 01 03 ... 06 00 00 00 02 00 01  CMD_OUTPUT_REQ seq=1, chunk 1
tx 28: 55 55 37 2c 00 01 00 01 ff ff 04 ... 10 01 18 01 20 01 28 02  STATUS: current_cmd_seq=1, cmd_state=2 (RECEIVED), not done yet
...                                                               more STATUS polls, then CMD_OUTPUT with the result
```

Every request in the trace got exactly one reply (154 frames in, 154 out for the full example run).

## Boot sequence seen by the readiness probe

`scripts/wait-ready.ts` polls `STATUS_REQ` after the socket opens. On a fresh state:

```text
[wait-ready] device_idle_state=NULL     comm layer up, firmware still initialising
[wait-ready] device_idle_state=DEVICE   boot logo / on-device flow; SDK commands are rejected here
[wait-ready] device_idle_state=IDLE     main menu, ready
```

## Findings from the code

| Question | Answer | Where |
| --- | --- | --- |
| Simulator build platform | `-DCMAKE_BUILD_PLATFORM=Simulator` (also the default) | `CMakeLists.txt:27-32` |
| Main loop | `while (1) engine_run(...)`; `RUN_ENGINE` always defined | `src/main.c:95, 154-157` |
| Old USB poll | `usbsim_continue_loop()` only in a compiled-out branch | `src/main.c:163` |
| Firmware USB receive entry | `comm_packet_parser(data, length, interface)` | `usb_rx_parser.c:171` |
| Simulator USB transmit | `SIM_Transmit_FS(uint8_t *data, uint8_t size)` | `simulator/USB/sim_usb.c` |
| Parser registration | Hardware only (`#if USE_SIMULATOR == 0`) | `usb_api.c:132-136` |
| `IDeviceConnection` | 11 methods; `peek()` returns `PoolData[]` (`{id, data}`) | `packages/interfaces/src/connection.ts` |
| `send()` granularity | Once per 64-byte packet | `packages/core/src/encoders/packet/packet.ts` |
| `getDeviceInfo` fields | `deviceSerial` (32 bytes), `isAuthenticated`, `isInitial`, `onboardingStep`, `firmwareVariant`; `firmwareVersion` absent in the simulator | `notes/m1-get-device-info.txt` |
