/**
 * @file    sim_transport.c
 * @brief   Routes frames between the TCP bridge and the firmware USB layer.
 *
 * ---------------------------------------------------------------------------
 *  INTEGRATION POINT (read docs/firmware-integration.md before editing)
 * ---------------------------------------------------------------------------
 * The firmware has a function that a real USB stack calls when a report
 * arrives from the host. In the simulator build that path is stubbed out.
 * Your job is to:
 *
 *   1. Find that receive entry point. Start with:
 *        grep -Rni "Receive_FS" simulator src
 *        grep -Rni "comm_packet_parser\|usb_receive\|packet_parser" src
 *   2. Put its name in SIM_FIRMWARE_RX below (or edit on_frame_from_sdk).
 *   3. Find the simulator's USB transmit function and make it call
 *      sim_transport_write().
 *   4. If the packet parser is only registered for non-simulator builds
 *      (look for #ifndef / #if !USE_SIMULATOR around its init), enable it
 *      for the simulator, checking for hardware-only dependencies first.
 *
 * Until step 2 is done, SIM_TRANSPORT_LOOPBACK echoes frames back so you can
 * prove the socket works inside the simulator binary.
 */
#include "sim_transport.h"

#include <stdio.h>

#include "sim_socket.h"

#ifndef SIM_TRANSPORT_LOOPBACK
#define SIM_TRANSPORT_LOOPBACK 1
#endif

#if !SIM_TRANSPORT_LOOPBACK
/* Declare the firmware receive function you found in step 1, for example:
 *   extern void SIM_Receive_FS(uint8_t *buf, uint32_t *len);
 * and define SIM_FIRMWARE_RX(frame, len) to call it. */
#ifndef SIM_FIRMWARE_RX
#error "Define SIM_FIRMWARE_RX(frame, len) to call the firmware USB receive function"
#endif
#endif

static void on_frame_from_sdk(const uint8_t *frame, size_t len) {
#if SIM_TRANSPORT_LOOPBACK
  /* Phase 1 proof: echo each frame back to the SDK. */
  sim_socket_send(frame, len);
#else
  SIM_FIRMWARE_RX(frame, len);
#endif
}

void sim_transport_init(void) {
  sim_socket_status_t status = sim_socket_init(0, on_frame_from_sdk);
  if (status != SIM_SOCKET_OK) {
    fprintf(stderr, "[sim_transport] socket bridge failed to start (%d)\n", status);
  }
}

void sim_transport_tick(void) {
  sim_socket_poll();
}

int sim_transport_write(const uint8_t *data, size_t len) {
  return sim_socket_send(data, len) == SIM_SOCKET_OK ? 0 : -1;
}
