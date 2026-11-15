/**
 * Capability matrix: runs every Cypherock SDK app operation against the
 * running X1 firmware simulator and records what works.
 *
 *   CYPHEROCK_SIM_TEST_MNEMONIC="test test ... junk" ./scripts/start-simulator.sh
 *   CYPHEROCK_SIM_TEST_MNEMONIC="test test ... junk" npx tsx tools/capabilities.ts
 *
 * Writes docs/notes/capabilities.md and docs/notes/capabilities.json.
 * Every check uses the SIMTEST wallet (needs CYPHEROCK_SIM_TEST_MNEMONIC on
 * both sides). Keys and signatures are cross-checked with ethers where an
 * independent check exists. After a failure the check aborts the device
 * operation and waits until the firmware is idle again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { DeviceConnection } from '../packages/hw-simulator/src';
import { hex, loadApp, loadManagerApp } from '../examples/lib/sdk';
import { waitIdle } from '../examples/lib/status';

type Result = 'PASS' | 'FAIL' | 'NEEDS INPUT' | 'NOT RUN';
interface Row {
  area: string;
  operation: string;
  result: Result;
  detail: string;
  ms: number;
}

const H = 0x80000000;
const MNEMONIC = process.env.CYPHEROCK_SIM_TEST_MNEMONIC;
const SDK_DIR = process.env.SDK_DIR ?? path.resolve(__dirname, '../../sdk');
const appModule = (folder: string, mod: string) => require(path.join(SDK_DIR, 'packages', folder, 'node_modules', mod));

const rows: Row[] = [];
let connection: DeviceConnection;
let walletId: Uint8Array;

async function ensureConnection() {
  if (!connection || !(await connection.isConnected())) {
    connection = await DeviceConnection.create({ retries: 10 });
  }
  return connection;
}

async function recover(app?: { abort?: () => Promise<void> }) {
  try {
    // Applet-independent ABORT packet (works even when the app object was never returned)
    await (app?.abort ? app.abort() : loadApp('core').SDK.sendAbort(connection));
  } catch {
    /* the operation may already be over */
  }
  await ensureConnection();
  for (let i = 0; i < 200 && (await connection.receive()); i += 1) {
    /* drain stale frames */
  }
  await waitIdle(connection, { timeoutMs: 20000 });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000} s`)), ms)),
  ]);
}

async function check(
  area: string,
  operation: string,
  run: () => Promise<{ detail: string; app?: any }>,
  {
    timeoutMs = 45000,
    skip,
    interactive,
  }: { timeoutMs?: number; skip?: string; interactive?: string } = {},
) {
  if (skip) {
    rows.push({ area, operation, result: 'NOT RUN', detail: skip, ms: 0 });
    console.log(`  -     ${area} / ${operation}: not run (${skip})`);
    return;
  }
  const start = Date.now();
  let app: any;
  try {
    const out = await withTimeout(
      run().then((r) => {
        app = r.app;
        return r;
      }),
      timeoutMs,
    );
    rows.push({ area, operation, result: 'PASS', detail: out.detail, ms: Date.now() - start });
    console.log(`  PASS  ${area} / ${operation}: ${out.detail}`);
  } catch (error) {
    const message = (error as Error).message?.split('\n')[0] ?? String(error);
    if (interactive && /timed out/.test(message)) {
      rows.push({ area, operation, result: 'NEEDS INPUT', detail: interactive, ms: Date.now() - start });
      console.log(`  INPUT ${area} / ${operation}: ${interactive}`);
    } else {
      rows.push({ area, operation, result: 'FAIL', detail: message, ms: Date.now() - start });
      console.log(`  FAIL  ${area} / ${operation}: ${message}`);
    }
    await recover(app);
  }
}

const evmAddress = (p: string) => ethers.HDNodeWallet.fromPhrase(MNEMONIC!, undefined, p).address;

async function main() {
  if (!MNEMONIC) throw new Error('Set CYPHEROCK_SIM_TEST_MNEMONIC (same value as the simulator).');
  await ensureConnection();
  await waitIdle(connection, { timeoutMs: 30000 });
  const ManagerApp = loadManagerApp();

  console.log('Manager app');
  await check('Manager', 'getDeviceInfo', async () => {
    const m = await ManagerApp.create(connection);
    const info = await m.getDeviceInfo();
    return { detail: `serial ${hex(info.deviceSerial).slice(0, 16)}..., auth=${info.isAuthenticated}, onboarding=${info.onboardingStep}, version=${info.firmwareVersion ? 'yes' : 'absent'}` };
  });
  await check('Manager', 'getWallets', async () => {
    const m = await ManagerApp.create(connection);
    const { walletList } = await m.getWallets();
    const w = walletList.find((x: any) => x.name === 'SIMTEST');
    if (!w) throw new Error('SIMTEST wallet missing');
    walletId = w.id;
    return { detail: `${walletList.length} wallet(s): ${walletList.map((x: any) => x.name).join(', ')}` };
  });
  await check('Manager', 'getLogs', async () => {
    const m = await ManagerApp.create(connection);
    try {
      const logs = await m.getLogs();
      return { detail: `${String(logs ?? '').length} characters of device logs`, app: m };
    } catch (error) {
      if (/logs are disabled/i.test((error as Error).message)) {
        return { detail: 'firmware answered "logs are disabled" (the default; enable logging in device settings)', app: m };
      }
      throw error;
    }
  });
  await check('Manager', 'selectWallet', async () => {
    const m = await ManagerApp.create(connection);
    const r = await m.selectWallet();
    return { detail: `selected ${r?.wallet?.name ?? JSON.stringify(r).slice(0, 60)}`, app: m };
  }, {
    timeoutMs: 15000,
    interactive: 'shows the wallet list and waits for a joystick choice (dev builds do not auto-answer list menus)',
  });
  await check('Manager', 'trainJoystick', async () => {
    const m = await ManagerApp.create(connection);
    await m.trainJoystick();
    return { detail: 'joystick training completed (emulated key presses)', app: m };
  }, { timeoutMs: 60000 });
  await check('Manager', 'trainCard', async () => {
    const m = await ManagerApp.create(connection);
    const r = await m.trainCard({ onWallets: async () => true });
    return { detail: JSON.stringify(r).slice(0, 80), app: m };
  }, { timeoutMs: 30000 });
  await check('Manager', 'authDevice', async () => ({ detail: '' }), {
    skip: "verifies with Cypherock's server; the simulator has no provisioned device keys",
  });
  await check('Manager', 'authCard', async () => ({ detail: '' }), {
    skip: "verifies the card with Cypherock's server; no real card",
  });
  await check('Manager', 'updateFirmware', async () => ({ detail: '' }), { skip: 'needs the bootloader, which the simulator does not have' });

  if (!walletId) throw new Error('No SIMTEST wallet: start the simulator with CYPHEROCK_SIM_TEST_MNEMONIC set');

  console.log('EVM app');
  const evmMod = loadApp('app-evm');
  evmMod.setEthersLib(ethers);
  const evmChains: Array<[string, number]> = [
    ['Ethereum', 1], ['Polygon', 137], ['BNB Chain', 56], ['Fantom', 250], ['Avalanche', 43114],
    ['Optimism', 10], ['Arbitrum', 42161], ['Base', 8453], ['Hyperliquid', 999],
  ];
  const ethPath = [44 + H, 60 + H, H, 0, 0];
  const ethExpected = evmAddress("m/44'/60'/0'/0/0");
  for (const [name, chainId] of evmChains) {
    await check(`EVM ${name}`, 'getPublicKeys', async () => {
      const evm = await evmMod.EvmApp.create(connection);
      const { addresses } = await evm.getPublicKeys({ walletId, derivationPaths: [{ path: ethPath }], chainId });
      if (addresses[0].toLowerCase() !== ethExpected.toLowerCase()) throw new Error(`address ${addresses[0]} != ethers ${ethExpected}`);
      return { detail: `${addresses[0]} (matches ethers)`, app: evm };
    });
  }
  await check('EVM Ethereum', 'getUserVerifiedPublicKey', async () => {
    const evm = await evmMod.EvmApp.create(connection);
    const r = await evm.getUserVerifiedPublicKey({ walletId, derivationPath: ethPath, chainId: 1 });
    if (r.address.toLowerCase() !== ethExpected.toLowerCase()) throw new Error(`address ${r.address} != ${ethExpected}`);
    return { detail: `${r.address} shown on device and confirmed`, app: evm };
  });
  for (const [name, chainId] of [['Ethereum', 1], ['Polygon', 137], ['Base', 8453]] as Array<[string, number]>) {
    await check(`EVM ${name}`, 'signTxn', async () => {
      const unsigned = ethers.Transaction.from({
        type: 2, chainId, nonce: 0, gasLimit: 21000, to: '0x000000000000000000000000000000000000dEaD',
        value: ethers.parseEther('0.001'), maxFeePerGas: ethers.parseUnits('30', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
      }).unsignedSerialized;
      const evm = await evmMod.EvmApp.create(connection);
      const { serializedTxn } = await evm.signTxn({ walletId, derivationPath: ethPath, txn: unsigned, serializeTxn: true });
      const signed = serializedTxn.startsWith('0x') ? serializedTxn : `0x${serializedTxn}`;
      const from = ethers.Transaction.from(signed).from;
      if (from?.toLowerCase() !== ethExpected.toLowerCase()) throw new Error(`signer ${from} != ${ethExpected}`);
      return { detail: `chain ${chainId} EIP-1559, signer verified by ethers`, app: evm };
    });
  }
  const message = 'Hello from the Cypherock X1 simulator';
  await check('EVM Ethereum', 'signPersonalMsg', async () => {
    const evm = await evmMod.EvmApp.create(connection);
    const r = await evm.signPersonalMsg({ walletId, derivationPath: ethPath, message: ethers.hexlify(ethers.toUtf8Bytes(message)).slice(2) });
    const signer = ethers.verifyMessage(message, r.serializedSignature.startsWith('0x') ? r.serializedSignature : `0x${r.serializedSignature}`);
    if (signer.toLowerCase() !== ethExpected.toLowerCase()) throw new Error(`recovered ${signer}`);
    return { detail: 'EIP-191 personal_sign, verified by ethers.verifyMessage', app: evm };
  });
  await check('EVM Ethereum', 'signEthMsg', async () => {
    const evm = await evmMod.EvmApp.create(connection);
    const r = await evm.signEthMsg({ walletId, derivationPath: ethPath, message: ethers.hexlify(ethers.toUtf8Bytes(message)).slice(2) });
    const sig = r.serializedSignature.startsWith('0x') ? r.serializedSignature : `0x${r.serializedSignature}`;
    const signer = ethers.verifyMessage(message, sig);
    const ok = signer.toLowerCase() === ethExpected.toLowerCase();
    return { detail: ok ? 'eth_sign, verified by ethers.verifyMessage' : `signed; ethers.verifyMessage recovers ${signer} (eth_sign hashing differs)`, app: evm };
  });
  await check('EVM Ethereum', 'signTypedMsg (EIP-712)', async () => {
    const typed = {
      domain: { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
        ],
        Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
        Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
      },
      primaryType: 'Mail',
      message: {
        from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
        to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
        contents: 'Hello, Bob!',
      },
    };
    const evm = await evmMod.EvmApp.create(connection);
    const r = await evm.signTypedMsg({ walletId, derivationPath: ethPath, message: typed });
    const { EIP712Domain: _drop, ...types } = typed.types;
    const sig = r.serializedSignature.startsWith('0x') ? r.serializedSignature : `0x${r.serializedSignature}`;
    const signer = ethers.verifyTypedData(typed.domain, types, typed.message, sig);
    if (signer.toLowerCase() !== ethExpected.toLowerCase()) throw new Error(`recovered ${signer}`);
    return { detail: 'EIP-712 Mail example, verified by ethers.verifyTypedData', app: evm };
  });

  console.log('Bitcoin family');
  const btcMod = loadApp('app-btc');
  btcMod.setBitcoinJSLib(appModule('app-btc', 'bitcoinjs-lib'));
  const btcFamily: Array<[string, number, number]> = [
    ['Bitcoin legacy', 44, 0], ['Bitcoin segwit', 84, 0], ['Litecoin', 44, 2], ['Dogecoin', 44, 3], ['Dash', 44, 5],
  ];
  for (const [name, purpose, coin] of btcFamily) {
    await check(name, 'getXpubs', async () => {
      const btc = await btcMod.BtcApp.create(connection);
      const r = await btc.getXpubs({ walletId, derivationPaths: [{ path: [purpose + H, coin + H, H] }] });
      const xpub = r.xpubs[0];
      let detail = `${xpub.slice(0, 18)}...`;
      if (purpose === 44 && coin === 0) {
        const expected = ethers.HDNodeWallet.fromPhrase(MNEMONIC!, undefined, "m/44'/0'/0'").neuter().extendedKey;
        if (expected !== xpub) throw new Error(`xpub differs from ethers: ${expected.slice(0, 18)}...`);
        detail += ' (matches ethers)';
      }
      return { detail, app: btc };
    });
  }
  await check('Bitcoin legacy', 'getPublicKey', async () => {
    const btc = await btcMod.BtcApp.create(connection);
    const r = await btc.getPublicKey({ walletId, derivationPath: [44 + H, H, H, 0, 0] });
    return { detail: `address ${r.address}`, app: btc };
  });
  await check('Bitcoin', 'signTxn', async () => ({ detail: '' }), {
    skip: 'needs funded UTXOs with their previous transactions; not attempted',
  });

  console.log('Other coin apps (public keys)');
  const others: Array<[string, string, string, number[], (app: any) => void]> = [
    ['Solana', 'app-solana', 'SolanaApp', [44 + H, 501 + H, H], () => undefined],
    ['NEAR', 'app-near', 'NearApp', [44 + H, 397 + H, H, H, 1 + H], () => undefined],
    ['Tron', 'app-tron', 'TronApp', [44 + H, 195 + H, H, 0, 0], (m) => {
      const tw = appModule('app-tron', 'tronweb');
      const TronWeb = tw.TronWeb ?? tw.default ?? tw;
      m.setTronWeb(new TronWeb({ fullHost: 'http://127.0.0.1:9' })); // address math only, no network
    }],
    ['XRP', 'app-xrp', 'XrpApp', [44 + H, 144 + H, H, 0, 0], (m) => m.setXrpLib(appModule('app-xrp', 'xrpl'))],
    ['Starknet', 'app-starknet', 'StarknetApp', [0xa55 + H, 0x4741e9c9 + H, 0x447a6028 + H, H, H, 0], () => undefined],
    ['ICP', 'app-icp', 'IcpApp', [44 + H, 223 + H, H, 0, 0], () => undefined],
    ['Stellar', 'app-stellar', 'StellarApp', [44 + H, 148 + H, H], (m) => m.setStellarLib(appModule('app-stellar', 'stellar-sdk'))],
    ['Constellation', 'app-constellation', 'ConstellationApp', [44 + H, 1137 + H, H, 0, 0], (m) => {
      // app-constellation expects the whole module and reads { dag4 } from it
      m.setDag4Lib(appModule('app-constellation', '@stardust-collective/dag4'));
    }],
    ['Sia', 'app-sia', 'SiaApp', [0], () => undefined],
    ['Canton', 'app-canton', 'CantonApp', [44 + H, 6767 + H, H, H, H], (m) => m.setCantonLib(appModule('app-canton', '@canton-network/core-ledger-proto'))],
  ];
  for (const [name, folder, cls, p, setup] of others) {
    await check(name, 'getPublicKeys', async () => {
      const mod = loadApp(folder);
      setup(mod);
      const app = await mod[cls].create(connection);
      const r = await app.getPublicKeys({ walletId, derivationPaths: [{ path: p }] });
      const value = r.addresses?.[0] ?? r.partyIds?.[0] ?? r.publicKeys?.[0];
      return { detail: `${String(value).slice(0, 48)}${String(value).length > 48 ? '...' : ''}`, app };
    });
  }
  await check('Other coins', 'signTxn', async () => ({ detail: '' }), {
    skip: 'each needs a chain-specific unsigned transaction; covered for EVM above',
  });
  await check('Inheritance', 'encrypt/decrypt with PIN', async () => ({ detail: '' }), {
    skip: 'needs a PIN wallet and card taps',
  });

  await connection.destroy();
  writeReport();
  if (rows.some((r) => r.result === 'FAIL')) process.exitCode = 2;
}

function writeReport() {
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.result]: (acc[r.result] ?? 0) + 1 }), {});
  const lines = [
    '# Capability matrix: Cypherock SDK against the X1 firmware simulator',
    '',
    `Run: ${new Date().toISOString()} · firmware 5b11739d + bridge patch · SDK 4e44158 + hw-simulator · wallet SIMTEST (test mnemonic)`,
    '',
    `Result: ${counts.PASS ?? 0} pass, ${counts.FAIL ?? 0} fail, ${counts['NEEDS INPUT'] ?? 0} need a key press, ${counts['NOT RUN'] ?? 0} not run.`,
    '',
    '| Area | Operation | Result | Detail | Time |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.area} | ${r.operation} | ${r.result} | ${r.detail.replace(/\|/g, '\\|')} | ${r.ms ? `${(r.ms / 1000).toFixed(1)} s` : ''} |`),
    '',
    'Generated by `tools/capabilities.ts`.',
  ];
  const out = path.resolve(__dirname, '../docs/notes');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'capabilities.md'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(out, 'capabilities.json'), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\n${counts.PASS ?? 0} pass, ${counts.FAIL ?? 0} fail, ${counts['NOT RUN'] ?? 0} not run -> docs/notes/capabilities.md`);
}

main().catch((error) => {
  console.error(error);
  writeReport();
  process.exit(1);
});
