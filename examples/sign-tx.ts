/**
 * M4: the firmware simulator signs an Ethereum transaction, and two
 * independent libraries check the signature.
 *
 *   CYPHEROCK_SIM_TEST_MNEMONIC="test test test test test test test test test test test junk" \
 *     ./scripts/start-simulator.sh
 *   npx tsx examples/sign-tx.ts      # approve on the simulator screen (arrows + Enter)
 *
 * Chain id 1, never broadcast: the firmware's ETH app rejects any other chain
 * id (apps/evm_family/evm_txn_helpers.c:316-317; eth_app.c chain_id = 1).
 * signTxn params: sdk/packages/app-evm/src/operations/signTxn/types.ts.
 */
import { ethers } from 'ethers';
import { createConnection } from './lib/connection';
import { loadEvmApp, loadManagerApp } from './lib/sdk';

const H = 0x80000000;
const ETH_PATH = [44 + H, 60 + H, 0 + H, 0, 0];

async function main() {
  // viem is ESM-only; load it dynamically from this CommonJS example
  const { parseEther, parseGwei, recoverTransactionAddress, serializeTransaction } = await import('viem');
  const { mnemonicToAccount } = await import('viem/accounts');

  const mnemonic = process.env.CYPHEROCK_SIM_TEST_MNEMONIC;
  if (!mnemonic) throw new Error('Set CYPHEROCK_SIM_TEST_MNEMONIC (same value as the simulator).');

  const ManagerApp = loadManagerApp();
  const { EvmApp, setEthersLib } = loadEvmApp();
  setEthersLib(ethers);

  const connection = await createConnection();
  const manager = await ManagerApp.create(connection);
  const { walletList } = await manager.getWallets();
  const wallet = walletList.find((w: any) => w.name === 'SIMTEST');
  if (!wallet) throw new Error('SIMTEST wallet not found: start the simulator with CYPHEROCK_SIM_TEST_MNEMONIC.');

  const unsigned = serializeTransaction({
    type: 'eip1559',
    chainId: 1,
    nonce: 0,
    gas: 21000n,
    to: '0x000000000000000000000000000000000000dEaD',
    value: parseEther('0.001'),
    maxFeePerGas: parseGwei('30'),
    maxPriorityFeePerGas: parseGwei('1'),
  });
  console.log(`unsigned: ${unsigned}`);
  console.log('Approve the transaction on the simulator screen...');

  const evm = await EvmApp.create(connection);
  const { signature, serializedTxn } = await evm.signTxn({
    walletId: wallet.id,
    derivationPath: ETH_PATH,
    txn: unsigned,
    serializeTxn: true,
    onEvent: (event: number) => console.log(`  device event ${event}`),
  });
  console.log('signature:', signature);

  const signed = (serializedTxn!.startsWith('0x') ? serializedTxn : `0x${serializedTxn}`) as `0x02${string}`;
  const signer = await recoverTransactionAddress({ serializedTransaction: signed });
  const expectedViem = mnemonicToAccount(mnemonic).address;
  const expectedEthers = ethers.Transaction.from(signed).from;

  console.log(`signed:        ${signed}`);
  console.log(`viem recover:  ${signer}`);
  console.log(`ethers recover:${expectedEthers}`);
  console.log(`mnemonic addr: ${expectedViem}`);
  const ok =
    signer.toLowerCase() === expectedViem.toLowerCase() &&
    (expectedEthers ?? '').toLowerCase() === expectedViem.toLowerCase();
  console.log(ok ? 'OK: firmware signature verified by viem and ethers' : 'MISMATCH');
  if (!ok) process.exitCode = 2;

  await evm.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
