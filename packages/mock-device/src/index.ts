import net from 'node:net';
import { FrameAccumulator, toFrames } from '../../hw-simulator/src/framing';
import { FRAME_SIZE } from '../../hw-simulator/src/constants';

/**
 * A tiny TCP server that behaves like the patched simulator at the byte level.
 *
 * It does NOT implement the Cypherock protocol. It exists so the transport
 * can be tested (framing, reconnects, timeouts, disconnects) on any machine,
 * in CI, without building the firmware.
 *
 * A handler receives every complete frame and returns zero or more reply
 * payloads. The default handler echoes each frame back.
 */
export type FrameHandler = (
  frame: Uint8Array,
  control: MockControl,
) => Uint8Array[] | void | Promise<Uint8Array[] | void>;

export interface MockControl {
  /** Close the client connection, simulating an unplugged device. */
  disconnect(): void;
  /** Send an unsolicited payload to the client. */
  push(payload: Uint8Array): void;
}

export interface MockDeviceOptions {
  port?: number; // 0 = pick a free port
  host?: string;
  frameSize?: number;
  handler?: FrameHandler;
}

export const echoHandler: FrameHandler = (frame) => [frame];

export class MockDevice {
  private server: net.Server;
  private clients = new Set<net.Socket>();
  public readonly received: Uint8Array[] = [];
  private readonly frameSize: number;
  private handler: FrameHandler;

  private constructor(private readonly options: MockDeviceOptions) {
    this.frameSize = options.frameSize ?? FRAME_SIZE;
    this.handler = options.handler ?? echoHandler;
    this.server = net.createServer((socket) => this.onClient(socket));
  }

  static async start(options: MockDeviceOptions = {}): Promise<MockDevice> {
    const device = new MockDevice(options);
    await new Promise<void>((resolve, reject) => {
      device.server.once('error', reject);
      device.server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => resolve());
    });
    return device;
  }

  get port(): number {
    const address = this.server.address();
    if (address && typeof address === 'object') return address.port;
    throw new Error('MockDevice is not listening');
  }

  setHandler(handler: FrameHandler) {
    this.handler = handler;
  }

  private onClient(socket: net.Socket) {
    this.clients.add(socket);
    socket.setNoDelay(true);
    const accumulator = new FrameAccumulator(this.frameSize);

    const control: MockControl = {
      disconnect: () => socket.destroy(),
      push: (payload) => {
        for (const frame of toFrames(payload, this.frameSize)) socket.write(frame);
      },
    };

    socket.on('data', async (chunk: Buffer) => {
      for (const frame of accumulator.push(new Uint8Array(chunk))) {
        this.received.push(frame);
        const replies = (await this.handler(frame, control)) ?? [];
        if (socket.destroyed) return;
        for (const reply of replies) control.push(reply);
      }
    });

    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  /** Drop every connected client. */
  disconnectAll() {
    for (const socket of this.clients) socket.destroy();
  }

  async stop(): Promise<void> {
    this.disconnectAll();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

// Allow running as a standalone process: `tsx packages/mock-device/src/index.ts`
if (process.argv[1] && process.argv[1].endsWith('mock-device/src/index.ts')) {
  const port = Number(process.env.CYPHEROCK_SIM_PORT ?? 52640);
  MockDevice.start({ port }).then((device) => {
    // eslint-disable-next-line no-console
    console.log(`Mock X1 (echo) listening on 127.0.0.1:${device.port}`);
  });
}
