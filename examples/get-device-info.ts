/**
 * M1: the first real SDK call against the firmware simulator.
 *
 *   ./scripts/start-simulator.sh
 *   npx tsx examples/get-device-info.ts
 *
 * ManagerApp.create() runs sdk-core's SDK-version handshake (legacy command
 * 88, answered in usb_rx_parser.c); getDeviceInfo() is answered by
 * apps/manager_app/get_device_info.c in the firmware.
 */
import { createConnection } from './lib/connection';
import { loadManagerApp } from './lib/sdk';

const show = (_key: string, value: unknown) =>
  value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value;

async function main() {
  const ManagerApp = loadManagerApp();
  const connection = await createConnection();
  const manager = await ManagerApp.create(connection);

  console.log(`SDK version reported by firmware: ${manager.getSDKVersion()}`);
  const info = await manager.getDeviceInfo();
  console.log('Device info from the X1 firmware simulator:');
  console.log(JSON.stringify(info, show, 2));

  await manager.destroy(); // also closes the connection
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
