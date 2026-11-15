/**
 * Creates a simulator connection for the examples.
 *
 * Default: the bridge repo's own transport (packages/hw-simulator/src), so the
 * examples work without building the SDK transport.
 * USE_SDK_TRANSPORT=1: the package from your SDK fork
 * ($SDK_DIR/packages/hw-simulator, run `pnpm build` there first).
 */
import path from 'node:path';
import { DeviceConnection } from '../../packages/hw-simulator/src';

export async function createConnection(): Promise<any> {
  const logger = process.env.DEBUG ? (m: string) => console.log(m) : undefined;
  if (process.env.USE_SDK_TRANSPORT === '1') {
    const sdkDir = process.env.SDK_DIR ?? path.resolve(__dirname, '../../../sdk');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdkTransport = require(path.join(sdkDir, 'packages', 'hw-simulator'));
    return sdkTransport.DeviceConnection.create();
  }
  return DeviceConnection.create({ logger });
}
