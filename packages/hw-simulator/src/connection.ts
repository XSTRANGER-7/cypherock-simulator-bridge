import net from 'node:net';
import { FrameAccumulator, toFrames } from './framing';
import { SimulatorConnectionError, SimulatorErrorCode } from './errors';

export interface SocketChannelOptions {
  host: string;
  port: number;
  connectTimeoutMs: number;
  retries: number;
  retryDelayMs: number;
  frameSize: number;
  logger?: (message: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/**
 * Low-level TCP channel to the simulator.
 * Knows nothing about the Cypherock protocol: it only moves frames.
 */
export class SocketChannel {
  private socket: net.Socket | undefined;
  private readonly accumulator: FrameAccumulator;
  private readonly queue: Uint8Array[] = [];
  private waiters: Array<(frame: Uint8Array | undefined) => void> = [];
  private closed = false;

  private constructor(private readonly options: SocketChannelOptions) {
    this.accumulator = new FrameAccumulator(options.frameSize);
  }

  static async open(options: SocketChannelOptions): Promise<SocketChannel> {
    const channel = new SocketChannel(options);
    await channel.connectWithRetry();
    return channel;
  }

  private log(message: string) {
    this.options.logger?.(`[hw-simulator] ${message}`);
  }

  private async connectWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.retries; attempt += 1) {
      try {
        await this.connectOnce();
        this.log(`connected to ${this.options.host}:${this.options.port}`);
        return;
      } catch (error) {
        lastError = error;
        this.log(`attempt ${attempt}/${this.options.retries} failed`);
        if (attempt < this.options.retries) await sleep(this.options.retryDelayMs);
      }
    }
    if (lastError instanceof SimulatorConnectionError) throw lastError;
    throw new SimulatorConnectionError(SimulatorErrorCode.CONNECTION_REFUSED, lastError);
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: this.options.host,
        port: this.options.port,
      });

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new SimulatorConnectionError(SimulatorErrorCode.CONNECTION_TIMEOUT));
      }, this.options.connectTimeoutMs);

      socket.once('connect', () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        this.attach(socket);
        resolve();
      });

      socket.once('error', (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new SimulatorConnectionError(SimulatorErrorCode.CONNECTION_REFUSED, error));
      });
    });
  }

  private attach(socket: net.Socket) {
    this.socket = socket;
    this.closed = false;
    this.accumulator.reset();

    socket.on('data', (chunk: Buffer) => {
      for (const frame of this.accumulator.push(new Uint8Array(chunk))) {
        this.log(`rx ${toHex(frame)}`);
        const waiter = this.waiters.shift();
        if (waiter) waiter(frame);
        else this.queue.push(frame);
      }
    });

    socket.on('close', () => {
      this.closed = true;
      this.log('socket closed');
      const waiters = this.waiters;
      this.waiters = [];
      waiters.forEach((w) => w(undefined));
    });

    socket.on('error', (error) => this.log(`socket error: ${error.message}`));
  }

  get isOpen(): boolean {
    return !!this.socket && !this.closed && !this.socket.destroyed;
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.isOpen || !this.socket) {
      throw new SimulatorConnectionError(SimulatorErrorCode.NOT_CONNECTED);
    }
    const socket = this.socket;
    for (const frame of toFrames(data, this.options.frameSize)) {
      this.log(`tx ${toHex(frame)}`);
      await new Promise<void>((resolve, reject) => {
        socket.write(frame, (error) => {
          if (error) reject(new SimulatorConnectionError(SimulatorErrorCode.WRITE_FAILED, error));
          else resolve();
        });
      });
    }
  }

  /** Return the next frame without waiting; undefined if none is queued. */
  tryRead(): Uint8Array | undefined {
    return this.queue.shift();
  }

  /** Wait up to timeoutMs for the next frame. */
  read(timeoutMs: number): Promise<Uint8Array | undefined> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (!this.isOpen) return Promise.resolve(undefined);

    return new Promise((resolve) => {
      const waiter = (frame: Uint8Array | undefined) => {
        clearTimeout(timer);
        resolve(frame);
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(undefined);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /** Snapshot of queued frames, not consumed. */
  peekAll(): Uint8Array[] {
    return this.queue.map((frame) => frame.slice());
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = undefined;
    await new Promise<void>((resolve) => {
      if (socket.destroyed) return resolve();
      socket.once('close', () => resolve());
      socket.end();
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 200);
    });
    this.closed = true;
    this.queue.length = 0;
  }
}
