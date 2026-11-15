/**
 * M2: lists the wallets stored on the simulated X1.
 *
 *   ./scripts/start-simulator.sh
 *   npx tsx examples/get-wallets.ts
 *
 * Firmware handler: apps/manager_app/export_wallets.c (manager_export_wallets).
 * For each wallet it fills id (32 bytes), name, hasPin, hasPassphrase and
 * isValid. A fresh simulator returns an empty list. Start the simulator with
 * CYPHEROCK_SIM_TEST_MNEMONIC set to get the "SIMTEST" test wallet.
 */
import { createConnection } from './lib/connection';
import { hex, loadManagerApp } from './lib/sdk';

async function main() {
  const ManagerApp = loadManagerApp();
  const connection = await createConnection();
  const manager = await ManagerApp.create(connection);

  const { walletList } = await manager.getWallets();
  console.log(`wallets: ${walletList.length}`);
  for (const w of walletList) {
    console.log(
      `- ${w.name}  id=${hex(w.id)}  pin=${w.hasPin}  passphrase=${w.hasPassphrase}  valid=${w.isValid}`,
    );
  }

  await manager.destroy(); // also closes the connection
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
