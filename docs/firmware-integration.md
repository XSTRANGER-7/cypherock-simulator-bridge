# Firmware integration

Goal: the simulator receives SDK frames over TCP and answers through its real command handlers.

Work in three phases. Do not move on until each phase's check passes.

## Phase 1: build the unmodified simulator

```bash
./scripts/build-simulator.sh
```

If the script cannot find the simulator platform, read `CMakeLists.txt`, find the value of `CMAKE_BUILD_PLATFORM` that selects the simulator, and rerun with `SIM_PLATFORM=<value>`.

**Check:** the simulator window opens and you can click through the device UI.

Record in `docs/protocol.md`:
- the build command that worked
- extra packages you had to install (SDL2 is common for simulators)

## Phase 2: socket bridge in loopback

1. Copy the bridge into your fork:

   ```bash
   cp -r firmware-patch/simulator/transport ../x1_wallet_firmware/simulator/
   ```

2. Include it in the simulator build. In `CMakeLists.txt`, inside the simulator branch:

   ```cmake
   include(simulator/transport/sim_transport.cmake)
   # add to the simulator executable:
   #   sources:      ${SIM_TRANSPORT_SOURCES}
   #   include dirs: ${SIM_TRANSPORT_INCLUDE_DIRS}
   ```

3. Find the simulator's main loop (start with `grep -Rn "main(" simulator`). Add:

   ```c
   #include "sim_transport.h"

   int main(...) {
     /* existing init */
     sim_transport_init();
     while (...) {
       /* existing loop body */
       sim_transport_tick();
     }
   }
   ```

4. Build with loopback on:

   ```bash
   SIM_TRANSPORT_LOOPBACK=ON ./scripts/build-simulator.sh
   ./scripts/start-simulator.sh
   npx tsx examples/connect.ts
   ```

**Check:** `connect.ts` prints the reply `68656c6c6f207831...` ("hello x1"). The socket now works inside the real simulator binary.

## Phase 3: connect to the firmware's USB path

This is the real engineering. You need two firmware entry points.

### 3a. Receive: where a USB report enters the firmware

```bash
grep -Rni "Receive_FS" simulator src
grep -Rni "usb_receive\|packet_parser\|comm_packet" src
```

Look for the function a real USB driver calls with incoming bytes. In the simulator build it is often a stub (an empty or unfinished function). Then:

- Build with `SIM_TRANSPORT_LOOPBACK=OFF`.
- Define `SIM_FIRMWARE_RX(frame, len)` to call that function, for example in `sim_transport.c`:

  ```c
  extern void SIM_Receive_FS(uint8_t *buf, uint32_t *len);  /* use the real signature */
  #define SIM_FIRMWARE_RX(frame, len) do {          \
      uint32_t n = (uint32_t)(len);                 \
      SIM_Receive_FS((uint8_t *)(frame), &n);       \
    } while (0)
  ```

- If the packet parser is only registered for hardware builds (an `#ifndef` around its init), enable it for the simulator. First check that nothing inside it touches hardware registers, DMA or interrupts. If something does, wrap only that part.

### 3b. Transmit: where the firmware sends a report to the host

Find the simulator's USB transmit function (often `*_Transmit_FS` or a `usb_send` wrapper) and make it call:

```c
sim_transport_write(buf, len);
```

### 3c. Check

```bash
./scripts/build-simulator.sh
./scripts/start-simulator.sh
CYPHEROCK_SIM_VERBOSE=1 npx tsx examples/get-device-info.ts
```

**Check:** device info prints. That is Milestone 1, the result to put at the top of your README and PR.

If it hangs: run with `DEBUG=1` to see tx/rx frames on the SDK side, and `CYPHEROCK_SIM_VERBOSE=1` on the simulator side. See [troubleshooting.md](troubleshooting.md).

## Keep the diff small

Reviewers trust small diffs. Aim for:
- the new `simulator/transport/` folder
- one `include` in CMake
- two lines in the simulator main loop
- one call in the receive path and one in the transmit path
- if needed, one changed `#if` around parser registration

Anything larger should go in a separate, later PR.
