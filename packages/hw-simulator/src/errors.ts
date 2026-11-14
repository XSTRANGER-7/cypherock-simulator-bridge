/**
 * Errors raised by the simulator transport.
 *
 * When this package is moved into the Cypherock SDK fork, map these codes to
 * the SDK's own error classes (see packages/interfaces, DeviceConnectionError)
 * so app packages handle a simulator failure exactly like a USB failure.
 */
export enum SimulatorErrorCode {
  CONNECTION_REFUSED = 'SIM_CONNECTION_REFUSED',
  CONNECTION_TIMEOUT = 'SIM_CONNECTION_TIMEOUT',
  CONNECTION_CLOSED = 'SIM_CONNECTION_CLOSED',
  NOT_CONNECTED = 'SIM_NOT_CONNECTED',
  WRITE_FAILED = 'SIM_WRITE_FAILED',
  INVALID_FRAME = 'SIM_INVALID_FRAME',
}

const messages: Record<SimulatorErrorCode, string> = {
  [SimulatorErrorCode.CONNECTION_REFUSED]:
    'Could not reach the X1 simulator. Is it running with the socket bridge enabled?',
  [SimulatorErrorCode.CONNECTION_TIMEOUT]:
    'Timed out while connecting to the X1 simulator.',
  [SimulatorErrorCode.CONNECTION_CLOSED]:
    'The X1 simulator closed the connection.',
  [SimulatorErrorCode.NOT_CONNECTED]:
    'No open connection to the X1 simulator.',
  [SimulatorErrorCode.WRITE_FAILED]:
    'Failed to write data to the X1 simulator.',
  [SimulatorErrorCode.INVALID_FRAME]:
    'Received a frame with an unexpected size from the X1 simulator.',
};

export class SimulatorConnectionError extends Error {
  public readonly code: SimulatorErrorCode;
  public readonly cause?: unknown;

  constructor(code: SimulatorErrorCode, cause?: unknown) {
    super(messages[code]);
    this.name = 'SimulatorConnectionError';
    this.code = code;
    this.cause = cause;
  }
}
