/**
 * @file    sim_transport.h
 * @brief   Glue between sim_socket and the firmware's USB communication layer.
 *
 * This is the ONLY file that needs to know firmware internals. sim_socket.c
 * is generic and fully tested on its own.
 *
 * Copy into: x1_wallet_firmware/simulator/transport/
 */
#ifndef SIM_TRANSPORT_H
#define SIM_TRANSPORT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Start the socket bridge. Call once during simulator start-up. */
void sim_transport_init(void);

/** Pump the socket. Call once per simulator main-loop iteration. */
void sim_transport_tick(void);

/**
 * Send bytes from firmware to the SDK. Call this from the simulator's
 * USB transmit function (the code path a real device uses to send a report).
 * Returns 0 on success.
 */
int sim_transport_write(const uint8_t *data, size_t len);

#ifdef __cplusplus
}
#endif

#endif /* SIM_TRANSPORT_H */
