import { SocketChannel } from './connection';
import {
  CONNECTION_TYPE,
  DEFAULT_CONNECT_RETRIES,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_RETRY_DELAY_MS,
  FRAME_SIZE,
} from './constants';
import { SimulatorConnectionError, SimulatorErrorCode } from './errors';
import {
  DeviceState,
  type IDeviceConnection,
  type PoolData,
  type SimulatorConnectionOptions,
} from './types';

type ResolvedOptions = Required<Omit<SimulatorConnectionOptions, 'logger' | 'onFrame'>> &
  Pick<SimulatorConnectionOptions, 'logger' | 'onFrame'>;

/**
 * Drop-in replacement for @cypherock/sdk-hw-hid's DeviceConnection that talks
 * to the X1 firmware simulator over TCP instead of USB.
 *
 *   const connection = await DeviceConnection.create();          // simulator
 *   const manager = await ManagerApp.create(connection);         // unchanged
 *
 * Every method mirrors sdk/packages/hw-hid/src/deviceConnection.ts:
 *  - send(): hw-hid prepends a 0x00 HID report ID and pads to 64. The device's
 *    USB stack strips the report ID, so the firmware never sees it; we send
 *    only the 64-byte report.
 *  - receive(): returns the next frame or undefined at once (no waiting).
 *  - peek(): { id, data } items, not consumed (sdk-core's legacy handshake
 *    relies on this shape, core/src/operations/legacy/sendData.ts:88-99).
 *  - getNewSequenceNumber(): += 1, the hw-hid rule.
 */
export class DeviceConnection implements IDeviceConnection {
  private sequenceNumber = 0;
  private initialized = false;
  private destroyed = false;

  private constructor(
    private readonly channel: SocketChannel,
    private readonly options: ResolvedOptions,
  ) {}

  static async create(options: SimulatorConnectionOptions = {}): Promise<DeviceConnection> {
    const resolved: ResolvedOptions = {
      host: options.host ?? process.env.CYPHEROCK_SIM_HOST ?? DEFAULT_HOST,
      port: options.port ?? Number(process.env.CYPHEROCK_SIM_PORT ?? DEFAULT_PORT),
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      retries: options.retries ?? DEFAULT_CONNECT_RETRIES,
      retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      frameSize: options.frameSize ?? FRAME_SIZE,
      logger: options.logger,
      onFrame: options.onFrame,
    };

    const channel = await SocketChannel.open(resolved);
    const connection = new DeviceConnection(channel, resolved);
    connection.initialized = true;
    return connection;
  }

  /** Same convenience the HID package offers: is anything listening? */
  static async list(
    options: SimulatorConnectionOptions = {},
  ): Promise<Array<{ host: string; port: number }>> {
    try {
      const probe = await DeviceConnection.create({ ...options, retries: 1 });
      const found = { host: probe.options.host, port: probe.options.port };
      await probe.destroy();
      return [found];
    } catch {
      return [];
    }
  }

  async getConnectionType(): Promise<string> {
    return CONNECTION_TYPE;
  }

  async isConnected(): Promise<boolean> {
    return !this.destroyed && this.channel.isOpen;
  }

  /**
   * hw-hid starts its read loop here and stops it in afterOperation(). The
   * socket is always read; frames that arrive between operations wait in the
   * pool, like unread HID reports wait in the OS buffer.
   */
  async beforeOperation(): Promise<void> {}

  async afterOperation(): Promise<void> {}

  async getSequenceNumber(): Promise<number> {
    return this.sequenceNumber;
  }

  async getNewSequenceNumber(): Promise<number> {
    this.sequenceNumber += 1;
    return this.sequenceNumber;
  }

  async getDeviceState(): Promise<DeviceState> {
    // The simulator is built with FIRMWARE_TYPE=Main (no bootloader mode).
    return DeviceState.MAIN;
  }

  /** Extra, like hw-hid's isInitialized(); not part of IDeviceConnection. */
  async isInitialized(): Promise<boolean> {
    return this.initialized;
  }

  async send(data: Uint8Array): Promise<void> {
    if (this.destroyed) throw new SimulatorConnectionError(SimulatorErrorCode.NOT_CONNECTED);
    if (!this.channel.isOpen) {
      throw new SimulatorConnectionError(SimulatorErrorCode.CONNECTION_CLOSED);
    }
    await this.channel.write(data);
  }

  async receive(): Promise<Uint8Array | undefined> {
    return this.channel.tryRead();
  }

  async peek(): Promise<PoolData[]> {
    return this.channel.peekAll();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.channel.close();
  }
}
