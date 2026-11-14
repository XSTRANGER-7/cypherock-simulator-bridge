/**
 * Unit tests for sim_socket.c. A forked child acts as the SDK client while
 * the parent runs the non-blocking server loop.
 */
#include <arpa/inet.h>
#include <assert.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../simulator/transport/sim_socket.h"

#define FS SIM_SOCKET_FRAME_SIZE

static int frames_seen = 0;
static uint8_t last_frame[FS];

static void echo_cb(const uint8_t *frame, size_t len) {
  assert(len == FS);
  memcpy(last_frame, frame, FS);
  frames_seen++;
  sim_socket_send(frame, len);
}

static int connect_client(uint16_t port) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in addr = {0};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  for (int i = 0; i < 50; i++) {
    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) == 0)
      return fd;
    usleep(10000);
  }
  return -1;
}

static int read_exact(int fd, uint8_t *buf, size_t len) {
  size_t got = 0;
  while (got < len) {
    ssize_t n = recv(fd, buf + got, len - got, 0);
    if (n <= 0)
      return -1;
    got += (size_t)n;
  }
  return 0;
}

/* Child: send a payload in awkward pieces, expect padded echo frames back. */
static int run_client(uint16_t port) {
  int fd = connect_client(port);
  if (fd < 0)
    return 10;

  /* 70 bytes = one full frame + 6 bytes; client pads to 2 frames (128). */
  uint8_t out[2 * FS] = {0};
  for (int i = 0; i < 70; i++)
    out[i] = (uint8_t)(i + 1);

  /* Split writes across the frame boundary to test reassembly. */
  send(fd, out, 10, 0);
  usleep(20000);
  send(fd, out + 10, 100, 0);
  usleep(20000);
  send(fd, out + 110, 18, 0);

  uint8_t in[2 * FS];
  if (read_exact(fd, in, sizeof(in)) < 0)
    return 11;
  if (memcmp(in, out, sizeof(in)) != 0)
    return 12;

  close(fd);
  return 0;
}

static void test_echo_roundtrip(void) {
  assert(sim_socket_init(0, echo_cb) == SIM_SOCKET_OK);
  uint16_t port = sim_socket_port();
  assert(port != 0);

  pid_t pid = fork();
  if (pid == 0)
    _exit(run_client(port));

  int status = 0;
  for (int i = 0; i < 3000; i++) {
    sim_socket_poll();
    if (waitpid(pid, &status, WNOHANG) == pid)
      break;
    usleep(1000);
  }
  assert(WIFEXITED(status));
  if (WEXITSTATUS(status) != 0) {
    fprintf(stderr, "client failed with code %d\n", WEXITSTATUS(status));
    assert(0);
  }
  assert(frames_seen == 2);
  assert(last_frame[0] == 65 && last_frame[5] == 70 && last_frame[6] == 0);

  /* Poll a few more times so the server notices the client left. */
  for (int i = 0; i < 50 && sim_socket_is_connected(); i++) {
    sim_socket_poll();
    usleep(1000);
  }
  assert(!sim_socket_is_connected());
  sim_socket_deinit();
  printf("ok - echo round trip with split writes\n");
}

static void test_send_without_client(void) {
  assert(sim_socket_init(0, echo_cb) == SIM_SOCKET_OK);
  uint8_t data[4] = {1, 2, 3, 4};
  assert(sim_socket_send(data, sizeof(data)) == SIM_SOCKET_ERR_NOT_CONNECTED);
  sim_socket_deinit();
  printf("ok - send without client returns NOT_CONNECTED\n");
}

static void test_bind_conflict(void) {
  assert(sim_socket_init(0, echo_cb) == SIM_SOCKET_OK);
  uint16_t port = sim_socket_port();
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in addr = {0};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(port);
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  assert(bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0);
  close(fd);
  sim_socket_deinit();
  printf("ok - port is held while listening\n");
}

int main(void) {
  setenv("CYPHEROCK_SIM_PORT", "0", 1); /* let the OS pick free ports */
  test_send_without_client();
  test_echo_roundtrip();
  test_bind_conflict();
  printf("all sim_socket tests passed\n");
  return 0;
}
