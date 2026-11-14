/**
 * Local copy of the SDK connection contract.
 *
 * This file exists so the package builds and tests on its own, outside the
 * Cypherock SDK monorepo. The shape below follows IDeviceConnection from
 * @cypherock/sdk-interfaces as best understood from the public SDK.
 *
 * BEFORE OPENING AN UPSTREAM PR:
 *   1. Open sdk/packages/interfaces/src and find `interface IDeviceConnection`.
 *   2. Compare every method name, argument and return type with the list below.
 *   3. Replace this file with:
 *        export type { IDeviceConnection, DeviceState } from '@cypherock/sdk-interfaces';
 *   4. Fix any compile errors in deviceConnection.ts. They will show you
 *      exactly where the real contract differs.
 */

export enum DeviceState {
  BOOTLOADER = 0,
  INITIAL = 1,
  MAIN = 2,
}

export interface IDeviceConnection {
  getConnectionType(): Promise<string>;
  isConnected(): Promise<boolean>;
  beforeOperation(): Promise<void>;
  afterOperation(): Promise<void>;
  getSequenceNumber(): Promise<number>;
  getNewSequenceNumber(): Promise<number>;
  getDeviceState(): Promise<DeviceState>;
  isInitialized(): Promise<boolean>;
  send(data: Uint8Array): Promise<void>;
  receive(): Promise<Uint8Array | undefined>;
  peek(): Promise<Uint8Array[]>;
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
}
