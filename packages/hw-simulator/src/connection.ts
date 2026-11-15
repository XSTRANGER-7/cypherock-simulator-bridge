import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { FrameAccumulator, toFrames } from './framing';
import { SimulatorConnectionError, SimulatorErrorCode } from './errors';
import type { PoolData } from './types';

export interface SocketChannelOptions {
  host: string;
  port: number;
  connectTimeoutMs: number;
  retries: number;
  retryDelayMs: number;
  frameSize: number;
  logger?: (message: string) => void;
  /** Called for every frame in either direction (playground frame log). */
  onFrame?: (direction: 'tx' | 'rx', frame: Uint8Array) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/**
 * Low-level TCP channel to the simulator.
 * Knows nothing about the Cypherock protocol: it only moves 64-byte frames.
 *
 * Incoming frames go into a pool of { id, data } items, the same shape and
 * semantics as @cypherock/sdk-hw-hid's DataListener: sdk-core polls
 * receive() (consumes) and peek() (does not consume, ids stay stable).
 */
export class SocketChannel {
  private socket: net.Socket | undefined;
  private readonly accumulator: FrameAccumulator;
  private readonly pool: PoolData[] = [];
  private closed = true;

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
        this.options.onFrame?.('rx', frame);
        this.pool.push({ id: randomUUID(), data: frame });
      }
    });

    socket.on('close', () => {
      this.closed = true;
      this.log('socket closed');
    });

    socket.on('error', (error) => this.log(`socket error: ${error.message}`));
  }

  get isOpen(): boolean {
    return !!this.socket && !this.closed && !this.socket.destroyed;
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.isOpen || !this.socket) {
      throw new SimulatorConnectionError(SimulatorErrorCode.CONNECTION_CLOSED);
    }
    const socket = this.socket;
    for (const frame of toFrames(data, this.options.frameSize)) {
      this.log(`tx ${toHex(frame)}`);
      this.options.onFrame?.('tx', frame);
      await new Promise<void>((resolve, reject) => {
        socket.write(frame, (error) => {
          if (error) reject(new SimulatorConnectionError(SimulatorErrorCode.WRITE_FAILED, error));
          else resolve();
        });
      });
    }
  }

  /** Next frame, or undefined at once. Same contract as hw-hid (pool.shift()?.data). */
  tryRead(): Uint8Array | undefined {
    return this.pool.shift()?.data;
  }

  /** Snapshot of pooled frames, not consumed; ids stay stable between calls. */
  peekAll(): PoolData[] {
    return this.pool.map((item) => ({ id: item.id, data: item.data.slice() }));
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.closed = true;
    this.pool.length = 0;
    if (!socket || socket.destroyed) return;
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.end();
      setTimeout(() => {
        socket.destroy();
        resolve();
      }, 200);
    });
  }
}
