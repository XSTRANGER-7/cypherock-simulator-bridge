/**
 * Shared constants for the simulator transport.
 *
 * FRAME_SIZE mirrors the USB HID report size used between cySync/SDK and the
 * X1 Vault. Every message on the TCP socket is split into fixed-size frames so
 * the firmware side can hand each frame to the same code path a real USB
 * report would take. Verify the real report size in the firmware
 * (search for the HID/USB packet length constant) and change it here and in
 * firmware-patch/sim_socket.h if it differs.
 */
export const FRAME_SIZE = 64;

/** Default address the patched firmware simulator listens on. */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 52640;

/** How long to wait for the TCP connection before giving up (ms). */
export const DEFAULT_CONNECT_TIMEOUT_MS = 3000;

/** How many times to retry connecting (useful while the simulator boots). */
export const DEFAULT_CONNECT_RETRIES = 10;

/** Delay between connection retries (ms). */
export const DEFAULT_RETRY_DELAY_MS = 300;

/** Connection type string reported to the SDK. */
export const CONNECTION_TYPE = 'simulator';
