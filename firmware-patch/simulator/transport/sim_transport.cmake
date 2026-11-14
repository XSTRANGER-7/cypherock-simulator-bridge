# Include this from x1_wallet_firmware/CMakeLists.txt inside the simulator
# branch of the build, for example:
#
#   if(CMAKE_BUILD_PLATFORM STREQUAL "Simulator")   # verify the exact name
#     include(simulator/transport/sim_transport.cmake)
#   endif()
#
# Then add ${SIM_TRANSPORT_SOURCES} to the simulator executable's sources and
# ${SIM_TRANSPORT_INCLUDE_DIRS} to its include directories.

set(SIM_TRANSPORT_DIR ${CMAKE_CURRENT_LIST_DIR})

set(SIM_TRANSPORT_SOURCES
  ${SIM_TRANSPORT_DIR}/sim_socket.c
  ${SIM_TRANSPORT_DIR}/sim_transport.c
)

set(SIM_TRANSPORT_INCLUDE_DIRS
  ${SIM_TRANSPORT_DIR}
)

# Phase 1: loopback (prove the socket works inside the simulator binary).
# Phase 2: set to 0 and define SIM_FIRMWARE_RX to reach the real parser.
option(SIM_TRANSPORT_LOOPBACK "Echo frames instead of passing them to firmware" ON)
if(SIM_TRANSPORT_LOOPBACK)
  add_compile_definitions(SIM_TRANSPORT_LOOPBACK=1)
else()
  add_compile_definitions(SIM_TRANSPORT_LOOPBACK=0)
endif()
