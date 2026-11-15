/**
 * M2 extended: the first Ethereum address of a simulator wallet, derived by
 * the firmware's own EVM app (apps/evm_family/evm_pub_key.c).
 *
 *   CYPHEROCK_SIM_TEST_MNEMONIC="test test test test test test test test test test test junk" \
 *     ./scripts/start-simulator.sh
 *   npx tsx examples/get-eth-address.ts            # add --verify to show it on screen
 *
 * The firmware rebuilds the seed before deriving a key. The simulator's card
 * emulation cannot do that, so this uses the SIMTEST wallet backed by
 * CYPHEROCK_SIM_TEST_MNEMONIC (see firmware-patch/simulator/testing).
 * Parameters: sdk/packages/app-evm/src/operations/runGetPublicKeys/types.ts.
 */
import { ethers } from 'ethers';
import { createConnection } from './lib/connection';
import { hex, loadEvmApp, loadManagerApp } from './lib/sdk';

const H = 0x80000000;
export const ETH_PATH = [44 + H, 60 + H, 0 + H, 0, 0]; // m/44'/60'/0'/0/0

async function main() {
  const ManagerApp = loadManagerApp();
  const { EvmApp, setEthersLib } = loadEvmApp();
  setEthersLib(ethers); // app-evm formats addresses with ethers v6

  const connection = await createConnection();
  const manager = await ManagerApp.create(connection); // do not destroy before EvmApp
  const { walletList } = await manager.getWallets();
  const wallet = walletList.find((w: any) => w.name === 'SIMTEST') ?? walletList[0];
  if (!wallet) throw new Error('No wallet on the simulator. Start it with CYPHEROCK_SIM_TEST_MNEMONIC set.');

  const evm = await EvmApp.create(connection);
  const doVerifyOnDevice = process.argv.includes('--verify');
  const { addresses, publicKeys } = await evm.getPublicKeys({
    walletId: wallet.id,
    derivationPaths: [{ path: ETH_PATH }],
    chainId: 1,
    doVerifyOnDevice,
    onEvent: (event: number) => console.log(`  device event ${event}`),
  });

  console.log(`wallet:  ${wallet.name} (${hex(wallet.id)})`);
  console.log(`path:    m/44'/60'/0'/0/0`);
  console.log(`pubkey:  ${publicKeys[0]}`);
  console.log(`address: ${addresses[0]}`);

  const mnemonic = process.env.CYPHEROCK_SIM_TEST_MNEMONIC;
  if (mnemonic && wallet.name === 'SIMTEST') {
    const expected = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0").address;
    const ok = expected.toLowerCase() === addresses[0].toLowerCase();
    console.log(`ethers:  ${expected}  ${ok ? 'MATCH' : 'MISMATCH'}`);
    if (!ok) process.exitCode = 2;
  }

  await evm.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
