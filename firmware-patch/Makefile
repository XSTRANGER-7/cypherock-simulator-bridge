# Standalone build for the simulator socket bridge.
# Does not need the firmware: compiles the bridge plus a test harness.
#
#   make            build everything
#   make test       run C unit tests
#   make run-echo   start the loopback echo server on port 52640

CC      ?= cc
CFLAGS  ?= -std=c11 -D_DEFAULT_SOURCE -Wall -Wextra -Werror -O2 -g
SRC_DIR := simulator/transport
BUILD   := build

BRIDGE_SRC := $(SRC_DIR)/sim_socket.c $(SRC_DIR)/sim_transport.c

.PHONY: all test run-echo clean

all: $(BUILD)/echo_server $(BUILD)/test_sim_socket

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/echo_server: test/echo_server.c $(BRIDGE_SRC) | $(BUILD)
	$(CC) $(CFLAGS) -DSIM_TRANSPORT_LOOPBACK=1 -o $@ $^

$(BUILD)/test_sim_socket: test/test_sim_socket.c $(SRC_DIR)/sim_socket.c | $(BUILD)
	$(CC) $(CFLAGS) -o $@ $^

test: $(BUILD)/test_sim_socket
	./$(BUILD)/test_sim_socket

run-echo: $(BUILD)/echo_server
	./$(BUILD)/echo_server

clean:
	rm -rf $(BUILD)
