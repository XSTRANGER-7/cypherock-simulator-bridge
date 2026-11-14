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
  type SimulatorConnectionOptions,
} from './types';

/**
 * Drop-in replacement for @cypherock/sdk-hw-hid's DeviceConnection that talks
 * to the X1 firmware simulator over TCP instead of USB.
 *
 *   const connection = await DeviceConnection.create();          // simulator
 *   const manager = await ManagerApp.create(connection);         // unchanged
 *
 * Everything above this class (sdk-core packet encoding, protobuf messages,
 * app packages) stays exactly the same. That is the whole point: the real
 * protocol is exercised end to end, only the wire changes.
 */
export class DeviceConnection implements IDeviceConnection {
  private sequenceNumber = 0;
  private initialized = false;
  private destroyed = false;

  private constructor(
    private readonly channel: SocketChannel,
    private readonly options: Required<Omit<SimulatorConnectionOptions, 'logger'>> &
      Pick<SimulatorConnectionOptions, 'logger'>,
  ) {}

  static async create(options: SimulatorConnectionOptions = {}): Promise<DeviceConnection> {
    const resolved = {
      host: options.host ?? process.env.CYPHEROCK_SIM_HOST ?? DEFAULT_HOST,
      port: options.port ?? Number(process.env.CYPHEROCK_SIM_PORT ?? DEFAULT_PORT),
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      retries: options.retries ?? DEFAULT_CONNECT_RETRIES,
      retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      frameSize: options.frameSize ?? FRAME_SIZE,
      logger: options.logger,
    };

    const channel = await SocketChannel.open(resolved);
    const connection = new DeviceConnection(channel, resolved);
    connection.initialized = true;
    return connection;
  }

  /** Same convenience the HID package offers: is anything listening? */
  static async list(options: SimulatorConnectionOptions = {}): Promise<
    Array<{ host: string; port: number }>
  > {
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

  async beforeOperation(): Promise<void> {
    this.assertOpen();
  }

  async afterOperation(): Promise<void> {
    // Nothing to release: the socket stays open between operations,
    // like a USB device that stays plugged in.
  }

  async getSequenceNumber(): Promise<number> {
    return this.sequenceNumber;
  }

  async getNewSequenceNumber(): Promise<number> {
    // Wraps like a 16-bit counter. Check sdk-hw-hid for the exact rule
    // and copy it if it differs.
    this.sequenceNumber = (this.sequenceNumber + 1) % 0xffff;
    return this.sequenceNumber;
  }

  async getDeviceState(): Promise<DeviceState> {
    // The simulator always runs the main firmware (no bootloader mode).
    return DeviceState.MAIN;
  }

  async isInitialized(): Promise<boolean> {
    return this.initialized;
  }

  async send(data: Uint8Array): Promise<void> {
    this.assertOpen();
    await this.channel.write(data);
  }

  /**
   * Returns the next frame from the simulator, or undefined if nothing
   * arrives in a short window. sdk-core polls this in a loop, so it must
   * not block for long.
   */
  async receive(): Promise<Uint8Array | undefined> {
    this.assertOpen();
    return this.channel.read(10);
  }

  async peek(): Promise<Uint8Array[]> {
    this.assertOpen();
    return this.channel.peekAll();
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.channel.close();
  }

  private assertOpen() {
    if (this.destroyed || !this.channel.isOpen) {
      throw new SimulatorConnectionError(
        this.destroyed ? SimulatorErrorCode.NOT_CONNECTED : SimulatorErrorCode.CONNECTION_CLOSED,
      );
    }
  }
}
