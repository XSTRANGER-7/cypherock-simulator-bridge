/**
 * Local copy of the SDK connection contract, so this package builds and tests
 * on its own, outside the Cypherock SDK monorepo.
 *
 * Copied from sdk/packages/interfaces/src/connection.ts (commit 4e44158).
 * The SDK fork's package (sdk/packages/hw-simulator) imports the real types
 * from @cypherock/sdk-interfaces instead.
 */

export enum DeviceState {
  BOOTLOADER = 0,
  INITIAL = 1,
  MAIN = 2,
}

export interface PoolData {
  id: string;
  data: Uint8Array;
}

export interface IDeviceConnection {
  getConnectionType(): Promise<string>;
  isConnected(): Promise<boolean>;
  beforeOperation(): Promise<void>;
  afterOperation(): Promise<void>;
  getSequenceNumber(): Promise<number>;
  getNewSequenceNumber(): Promise<number>;
  getDeviceState(): Promise<DeviceState>;
  send(data: Uint8Array): Promise<void>;
  receive(): Promise<Uint8Array | undefined>;
  peek(): Promise<PoolData[]>;
  destroy(): Promise<void>;
}

export interface SimulatorConnectionOptions {
  /** Host the simulator listens on. Default 127.0.0.1 */
  host?: string;
  /** TCP port the simulator listens on. Default 52640 */
  port?: number;
  /** Per-attempt connect timeout in ms. */
  connectTimeoutMs?: number;
  /** Number of connection attempts before failing. */
  retries?: number;
  /** Delay between attempts in ms. */
  retryDelayMs?: number;
  /** Frame size in bytes; must match the firmware bridge. */
  frameSize?: number;
  /** Optional logger for debugging raw traffic. */
  logger?: (message: string) => void;
  /** Called for every frame in either direction. */
  onFrame?: (direction: 'tx' | 'rx', frame: Uint8Array) => void;
}
