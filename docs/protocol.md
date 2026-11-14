# Wire protocol

## Transport framing (defined by this project)

| Property | Value |
| --- | --- |
| Transport | TCP, IPv4 |
| Address | 127.0.0.1 only |
| Default port | 52640 (`CYPHEROCK_SIM_PORT` overrides on both sides) |
| Frame size | 64 bytes, fixed |
| Padding | Zero bytes at the end of the last frame |
| Clients | One; a new connection replaces the old |
| Byte order | Opaque: frames are passed through unchanged |

Each frame carries exactly the bytes a USB HID report would carry. The bridge never inspects or changes frame contents.

If the firmware's real report size is not 64, change it in both places:
- `packages/hw-simulator/src/constants.ts` → `FRAME_SIZE`
- `firmware-patch/simulator/transport/sim_socket.h` → `SIM_SOCKET_FRAME_SIZE`

### Frame-size open question

If the HID transport prepends a report ID byte (common with node-hid: `[0x00, ...data]`), check whether that byte reaches the firmware's receive function. Match what the firmware sees on real USB.

## Cypherock application protocol (defined by Cypherock)

Inside the frames, sdk-core and the firmware speak Cypherock's own packet format: packet headers with sequence numbers, chunking of long messages, and protobuf-encoded commands (shared definitions in the `common` submodule). This project does not reimplement any of it.

## Findings

Fill this in as you inspect the code. It becomes evidence in your PRs.

| Question | Answer | Where found |
| --- | --- | --- |
| Simulator build platform value | | `CMakeLists.txt` line |
| Simulator main loop | | file:line |
| Firmware USB receive entry point | | file:line |
| Firmware USB transmit function | | file:line |
| Parser registration guarded for simulator? | | file:line |
| Real USB report size | | file:line |
| Report ID byte present? | | |
| `IDeviceConnection` methods | | `packages/interfaces/...` |
| `send()` called per packet or per message? | | `packages/core/...` |
| `getDeviceInfo` response fields | | test output |
