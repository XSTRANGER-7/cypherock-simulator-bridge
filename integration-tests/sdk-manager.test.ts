/**
 * Layer 4: the real Cypherock SDK against the real firmware simulator.
 * Skipped unless CYPHEROCK_SIM=1 and a simulator is listening.
 *
 *   ./scripts/build-simulator.sh
 *   CYPHEROCK_SIM=1 ./scripts/run-tests.sh
 *
 * Set CYPHEROCK_SIM_TEST_MNEMONIC (same value for the simulator and this
 * process) to also check the SIMTEST wallet and its ETH address.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceConnection } from '../packages/hw-simulator/src';
import { loadEvmApp, loadManagerApp } from '../examples/lib/sdk';
import { encodePacket, PACKET_TYPE } from '../examples/lib/packets';

const enabled = process.env.CYPHEROCK_SIM === '1';
const mnemonic = process.env.CYPHEROCK_SIM_TEST_MNEMONIC;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The bridge serves one client at a time, like one USB host: a new TCP
// connection closes the previous one. So the raw test runs first on its own
// connection, and the SDK connection is opened afterwards, on first use.
let connection: DeviceConnection;
let manager: any;

async function sdk() {
  if (!manager) {
    connection = await DeviceConnection.create();
    manager = await loadManagerApp().create(connection);
  }
  return manager;
}

after(async () => {
  if (!enabled) return;
  await manager?.destroy?.();
  await connection?.destroy();
});

test('raw STATUS_REQ gets a STATUS reply (no SDK involved)', { skip: !enabled }, async () => {
  const raw = await DeviceConnection.create();
  await raw.send(encodePacket({ type: PACKET_TYPE.STATUS_REQ, sequence: 0xffff }));
  let reply: Uint8Array | undefined;
  for (let i = 0; i < 1500 && !reply; i += 1) {
    reply = await raw.receive();
    if (!reply) await sleep(2);
  }
  await raw.destroy();
  assert.ok(reply, 'no reply within 3 s');
  assert.equal(reply[0], 0x55);
  assert.equal(reply[1], 0x55);
  assert.equal(reply[10], PACKET_TYPE.STATUS);
});

test('handshake: firmware reports SDK version 3.0.0', { skip: !enabled }, async () => {
  const m = await sdk();
  assert.equal(await connection.isConnected(), true);
  assert.equal(m.getSDKVersion(), '3.0.0');
});

test('getDeviceInfo returns the fields filled by get_device_info.c', { skip: !enabled }, async () => {
  const info = await (await sdk()).getDeviceInfo();
  // On a real X1 the bootloader writes the firmware version into permanent
  // flash; the simulator has no bootloader, so get_fwVer() is 0xFFFFFFFF and
  // get_device_info.c leaves the field out (docs/limitations.md).
  if (info.firmwareVersion) {
    assert.equal(typeof info.firmwareVersion.major, 'number');
  }
  assert.ok(info.deviceSerial instanceof Uint8Array);
  assert.equal(info.deviceSerial.length, 32);
  assert.equal(typeof info.isAuthenticated, 'boolean');
  assert.equal(typeof info.onboardingStep, 'number');
  assert.ok(info.firmwareVariantInfo?.variantStr);
});

test('two getDeviceInfo calls in a row on one connection', { skip: !enabled }, async () => {
  const m = await sdk();
  const a = await m.getDeviceInfo();
  const b = await m.getDeviceInfo();
  assert.deepEqual(Buffer.from(a.deviceSerial), Buffer.from(b.deviceSerial));
});

test('getWallets returns a list', { skip: !enabled }, async () => {
  const { walletList } = await (await sdk()).getWallets();
  assert.ok(Array.isArray(walletList));
  if (mnemonic) {
    const simtest = walletList.find((w: any) => w.name === 'SIMTEST');
    assert.ok(simtest, 'SIMTEST wallet expected when CYPHEROCK_SIM_TEST_MNEMONIC is set');
    assert.equal(simtest.isValid, true);
    assert.equal(simtest.id.length, 32);
  }
});

test('SIMTEST ETH address matches the mnemonic (firmware vs ethers)', { skip: !enabled || !mnemonic }, async () => {
  const { ethers } = await import('ethers');
  const { EvmApp, setEthersLib } = loadEvmApp();
  setEthersLib(ethers);
  const { walletList } = await (await sdk()).getWallets();
  const wallet = walletList.find((w: any) => w.name === 'SIMTEST');
  const evm = await EvmApp.create(connection);
  const H = 0x80000000;
  const { addresses } = await evm.getPublicKeys({
    walletId: wallet.id,
    derivationPaths: [{ path: [44 + H, 60 + H, 0 + H, 0, 0] }],
    chainId: 1,
  });
  const expected = ethers.HDNodeWallet.fromPhrase(mnemonic!, undefined, "m/44'/60'/0'/0/0").address;
  assert.equal(addresses[0].toLowerCase(), expected.toLowerCase());
});

test('a destroyed connection rejects sends instead of hanging', { skip: !enabled }, async () => {
  await sdk();
  await connection.destroy();
  manager = undefined;
  await assert.rejects(connection.send(new Uint8Array([0])));
});

test('a new connection works after the previous one closed (reconnect)', { skip: !enabled }, async () => {
  const info = await (await sdk()).getDeviceInfo();
  assert.equal(info.deviceSerial.length, 32);
});
