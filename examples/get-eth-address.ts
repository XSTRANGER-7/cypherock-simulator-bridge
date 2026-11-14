/**
 * Derives the first Ethereum address of the first wallet on the simulator.
 * Real firmware code derives the key; nothing is mocked.
 *
 *   npx tsx examples/get-eth-address.ts
 *
 * The EvmApp API below follows docs-sdk.cypherock.com. Verify argument
 * names against packages/app-evm in your SDK fork.
 */
import { DeviceConnection } from '../packages/hw-simulator/src';
import { hex, loadEvmApp, loadManagerApp } from './lib/sdk';

const HARDENED = 0x80000000;
const ETH_PATH = [44 + HARDENED, 60 + HARDENED, 0 + HARDENED, 0, 0]; // m/44'/60'/0'/0/0

async function main() {
  const ManagerApp = loadManagerApp();
  const evm = loadEvmApp();
  const connection = await DeviceConnection.create();

  const manager = await ManagerApp.create(connection);
  const { walletList } = await manager.getWallets();
  if (!walletList?.length) throw new Error('Create a wallet in the simulator first');

  // The EVM app needs an ethers instance for address formatting.
  try {
    evm.setEthersLib?.(require('ethers'));
  } catch {
    console.warn('ethers not installed; run "npm i ethers" if the EVM app asks for it');
  }

  const app = await evm.EvmApp.create(connection);
  const result = await app.getPublicKeys({
    walletId: walletList[0].id,
    derivationPaths: [{ path: ETH_PATH }],
    chainId: 1,
  });

  console.log(`Wallet: ${walletList[0].name} (${hex(walletList[0].id)})`);
  console.log('Address:', result.addresses?.[0] ?? result);
  console.log('Confirm the same address is shown on the simulator screen.');

  await app.destroy?.();
  await connection.destroy();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
