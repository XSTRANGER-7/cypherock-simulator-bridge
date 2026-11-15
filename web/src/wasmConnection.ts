/**
 * IDeviceConnection for the X1 firmware compiled to WebAssembly and running
 * in the same browser tab. Same contract as @cypherock/sdk-hw-simulator's
 * TCP DeviceConnection (64-byte frames, a pool the SDK peeks and receives
 * from, sequence numbers += 1); only the wire differs: frames go straight
 * into the firmware's memory via sim_wasm_host_write(), and come back through
 * Module.x1OnFrame (x1_wallet_firmware/simulator/transport/sim_socket_wasm.c).
 */
import { FrameAccumulator, toFrames } from '../../packages/hw-simulator/src/framing';
import { DeviceState, type IDeviceConnection, type PoolData } from '../../packages/hw-simulator/src/types';

export const FRAME_SIZE = 64;

/** The parts of the Emscripten module this connection uses. */
export interface X1Module {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _sim_wasm_host_write(ptr: number, len: number): number;
  _sim_wasm_host_connect(connected: number): void;
  x1OnFrame?: (bytes: Uint8Array) => void;
}

export class WasmDeviceConnection implements IDeviceConnection {
  private sequenceNumber = 0;
  private destroyed = false;
  private nextId = 1;
  private readonly pool: PoolData[] = [];
  private readonly accumulator = new FrameAccumulator(FRAME_SIZE);
  private readonly txBuffer: number;

  constructor(
    private readonly mod: X1Module,
    private readonly onFrame?: (direction: 'tx' | 'rx', frame: Uint8Array) => void,
  ) {
    this.txBuffer = mod._malloc(FRAME_SIZE);
    mod.x1OnFrame = (bytes) => {
      for (const frame of this.accumulator.push(bytes)) {
        this.onFrame?.('rx', frame);
        this.pool.push({ id: String(this.nextId++), data: frame });
      }
    };
    mod._sim_wasm_host_connect(1);
  }

  async getConnectionType(): Promise<string> {
    return 'simulator';
  }

  async isConnected(): Promise<boolean> {
    return !this.destroyed;
  }

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
    return DeviceState.MAIN;
  }

  async isInitialized(): Promise<boolean> {
    return !this.destroyed;
  }

  async send(data: Uint8Array): Promise<void> {
    if (this.destroyed) throw new Error('simulator connection closed');
    for (const frame of toFrames(data, FRAME_SIZE)) {
      this.onFrame?.('tx', frame);
      // Read HEAPU8 each time: memory growth replaces the view.
      this.mod.HEAPU8.set(frame, this.txBuffer);
      this.mod._sim_wasm_host_write(this.txBuffer, frame.length);
    }
  }

  async receive(): Promise<Uint8Array | undefined> {
    return this.pool.shift()?.data;
  }

  async peek(): Promise<PoolData[]> {
    return this.pool.map((item) => ({ id: item.id, data: item.data.slice() }));
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pool.length = 0;
    this.mod.x1OnFrame = undefined;
    this.mod._sim_wasm_host_connect(0);
    this.mod._free(this.txBuffer);
  }
}
