/**
 * Lists wallets stored on the simulated X1.
 * A fresh simulator may have none: create one in the simulator UI first.
 *
 *   npx tsx examples/get-wallets.ts
 */
import { DeviceConnection } from '../packages/hw-simulator/src';
import { hex, loadManagerApp } from './lib/sdk';

async function main() {
  const ManagerApp = loadManagerApp();
  const connection = await DeviceConnection.create();
  const manager = await ManagerApp.create(connection);

  const result = await manager.getWallets();
  const wallets = result?.walletList ?? result ?? [];
  if (!wallets.length) {
    console.log('No wallets on the simulator yet.');
  }
  for (const wallet of wallets) {
    console.log(`- ${wallet.name}  id=${hex(wallet.id)}`);
  }

  await connection.destroy();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
