/**
 * @file    sim_socket.c
 * @brief   Implementation of the simulator TCP frame bridge (POSIX sockets).
 *
 * Linux and macOS only. On Windows, build the simulator inside WSL2.
 */
#include "sim_socket.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define SIM_LOG(...)                       \
  do {                                     \
    if (sim_socket_verbose) {              \
      fprintf(stderr, "[sim_socket] ");    \
      fprintf(stderr, __VA_ARGS__);        \
      fprintf(stderr, "\n");               \
    }                                      \
  } while (0)

static int listen_fd = -1;
static int client_fd = -1;
static uint16_t bound_port = 0;
static sim_socket_rx_cb_t on_frame = NULL;
static uint8_t rx_buf[SIM_SOCKET_FRAME_SIZE];
static size_t rx_len = 0;
static int sim_socket_verbose = 0;

static int set_non_blocking(int fd) {
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags < 0)
    return -1;
  return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static void close_client(void) {
  if (client_fd >= 0) {
    close(client_fd);
    client_fd = -1;
    rx_len = 0;
    SIM_LOG("client disconnected");
  }
}

sim_socket_status_t sim_socket_init(uint16_t port, sim_socket_rx_cb_t rx_cb) {
  const char *verbose = getenv("CYPHEROCK_SIM_VERBOSE");
  sim_socket_verbose = (verbose && verbose[0] == '1');

  if (port == 0) {
    const char *env_port = getenv("CYPHEROCK_SIM_PORT");
    port = env_port ? (uint16_t)atoi(env_port) : SIM_SOCKET_DEFAULT_PORT;
  }

  on_frame = rx_cb;
  listen_fd = socket(AF_INET, SOCK_STREAM, 0);
  if (listen_fd < 0)
    return SIM_SOCKET_ERR_SOCKET;

  int yes = 1;
  setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); /* never expose beyond localhost */
  addr.sin_port = htons(port);

  if (bind(listen_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
    close(listen_fd);
    listen_fd = -1;
    return SIM_SOCKET_ERR_BIND;
  }
  if (listen(listen_fd, 1) < 0 || set_non_blocking(listen_fd) < 0) {
    close(listen_fd);
    listen_fd = -1;
    return SIM_SOCKET_ERR_LISTEN;
  }

  socklen_t addr_len = sizeof(addr);
  getsockname(listen_fd, (struct sockaddr *)&addr, &addr_len);
  bound_port = ntohs(addr.sin_port);

  /* Always printed: scripts/start-simulator.sh waits for this line. */
  fprintf(stderr, "[sim_socket] listening on 127.0.0.1:%u\n", bound_port);
  fflush(stderr);
  return SIM_SOCKET_OK;
}

static void accept_client(void) {
  int fd = accept(listen_fd, NULL, NULL);
  if (fd < 0)
    return; /* EAGAIN: nobody waiting */

  if (client_fd >= 0) {
    /* One client at a time, like one USB host. Newest wins. */
    close_client();
  }
  set_non_blocking(fd);
  int yes = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof(yes));
  client_fd = fd;
  rx_len = 0;
  SIM_LOG("client connected");
}

static void read_client(void) {
  uint8_t chunk[512];
  for (;;) {
    ssize_t n = recv(client_fd, chunk, sizeof(chunk), 0);
    if (n == 0) {
      close_client();
      return;
    }
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK)
        return;
      close_client();
      return;
    }
    for (ssize_t i = 0; i < n; i++) {
      rx_buf[rx_len++] = chunk[i];
      if (rx_len == SIM_SOCKET_FRAME_SIZE) {
        if (on_frame)
          on_frame(rx_buf, SIM_SOCKET_FRAME_SIZE);
        rx_len = 0;
        if (client_fd < 0)
          return; /* callback may have closed us */
      }
    }
  }
}

void sim_socket_poll(void) {
  if (listen_fd < 0)
    return;
  accept_client();
  if (client_fd >= 0)
    read_client();
}

static int write_all(const uint8_t *buf, size_t len) {
  size_t sent = 0;
  while (sent < len) {
    ssize_t n = send(client_fd, buf + sent, len - sent, MSG_NOSIGNAL);
    if (n < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        usleep(100);
        continue;
      }
      return -1;
    }
    sent += (size_t)n;
  }
  return 0;
}

sim_socket_status_t sim_socket_send(const uint8_t *data, size_t len) {
  if (client_fd < 0)
    return SIM_SOCKET_ERR_NOT_CONNECTED;

  uint8_t frame[SIM_SOCKET_FRAME_SIZE];
  size_t offset = 0;
  do {
    size_t take = len - offset;
    if (take > SIM_SOCKET_FRAME_SIZE)
      take = SIM_SOCKET_FRAME_SIZE;
    memset(frame, 0, sizeof(frame));
    if (take > 0)
      memcpy(frame, data + offset, take);
    if (write_all(frame, sizeof(frame)) < 0) {
      close_client();
      return SIM_SOCKET_ERR_WRITE;
    }
    offset += take;
  } while (offset < len);
  return SIM_SOCKET_OK;
}

int sim_socket_is_connected(void) {
  return client_fd >= 0;
}

uint16_t sim_socket_port(void) {
  return bound_port;
}

void sim_socket_deinit(void) {
  close_client();
  if (listen_fd >= 0) {
    close(listen_fd);
    listen_fd = -1;
  }
  bound_port = 0;
}
