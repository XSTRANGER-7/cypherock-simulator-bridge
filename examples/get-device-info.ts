/**
 * Step 2 example: the first real SDK call against the firmware simulator.
 * This is the milestone that proves the whole stack works.
 *
 *   ./scripts/start-simulator.sh
 *   npx tsx examples/get-device-info.ts
 *
 * Method names follow the public SDK docs; check app-manager in your fork
 * if anything has been renamed.
 */
import { DeviceConnection } from '../packages/hw-simulator/src';
import { loadManagerApp } from './lib/sdk';

async function main() {
  const ManagerApp = loadManagerApp();
  const connection = await DeviceConnection.create();
  const manager = await ManagerApp.create(connection);

  const info = await manager.getDeviceInfo();
  console.log('Device info from firmware simulator:');
  console.log(JSON.stringify(info, (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v), 2));

  await manager.destroy?.();
  await connection.destroy();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
