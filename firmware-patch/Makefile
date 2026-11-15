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

# Winsock on Windows (MinGW / MSYS2)
ifeq ($(OS),Windows_NT)
LDLIBS  += -lws2_32
endif

.PHONY: all test run-echo clean

ifeq ($(OS),Windows_NT)
# test_sim_socket.c uses fork()/POSIX sockets: Linux and macOS only
all: $(BUILD)/echo_server

test:
	@echo "C unit tests need POSIX (Linux/macOS/CI); skipped on Windows"
else
all: $(BUILD)/echo_server $(BUILD)/test_sim_socket

test: $(BUILD)/test_sim_socket
	./$(BUILD)/test_sim_socket
endif

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/echo_server: test/echo_server.c $(BRIDGE_SRC) | $(BUILD)
	$(CC) $(CFLAGS) -o $@ $^ $(LDLIBS)

$(BUILD)/test_sim_socket: test/test_sim_socket.c $(SRC_DIR)/sim_socket.c | $(BUILD)
	$(CC) $(CFLAGS) -o $@ $^ $(LDLIBS)

run-echo: $(BUILD)/echo_server
	./$(BUILD)/echo_server

clean:
	rm -rf $(BUILD)
