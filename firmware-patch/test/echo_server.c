/**
 * Standalone harness: runs sim_transport in loopback mode with the same
 * single-threaded loop shape as the simulator. Used to prove the C bridge
 * and the TypeScript transport agree on the wire format, without building
 * the firmware.
 *
 *   make -C firmware-patch && ./firmware-patch/build/echo_server
 */
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
#include <windows.h>
#define sleep_1ms() Sleep(1)
#else
#include <unistd.h>
#define sleep_1ms() usleep(1000)
#endif

#include "../simulator/transport/sim_socket.h"
#include "../simulator/transport/sim_transport.h"

static volatile int running = 1;

static void handle_signal(int sig) {
  (void)sig;
  running = 0;
}

int main(void) {
  signal(SIGINT, handle_signal);
  signal(SIGTERM, handle_signal);

#ifdef _WIN32
  _putenv("CYPHEROCK_SIM_LOOPBACK=1");
#else
  setenv("CYPHEROCK_SIM_LOOPBACK", "1", 1);
#endif
  if (sim_transport_init(NULL) != 0)
    return 1;

  while (running) {
    sim_transport_tick();
    sleep_1ms(); /* the real simulator loop also does UI work here */
  }

  sim_socket_deinit();
  return 0;
}
