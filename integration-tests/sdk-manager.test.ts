/**
 * Layer 4: the real Cypherock SDK against the real firmware simulator.
 * Skipped unless CYPHEROCK_SIM=1 and a simulator is listening.
 *
 *   ./scripts/build-simulator.sh
 *   CYPHEROCK_SIM=1 ./scripts/run-tests.sh
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceConnection } from '../packages/hw-simulator/src';
import { loadManagerApp } from '../examples/lib/sdk';

const enabled = process.env.CYPHEROCK_SIM === '1';
let connection: DeviceConnection;
let manager: any;

before(async () => {
  if (!enabled) return;
  connection = await DeviceConnection.create();
  manager = await loadManagerApp().create(connection);
});

after(async () => {
  if (!enabled) return;
  await manager?.destroy?.();
  await connection?.destroy();
});

test('handshake: SDK can open a session with the simulator', { skip: !enabled }, async () => {
  assert.equal(await connection.isConnected(), true);
  assert.ok(manager, 'ManagerApp.create should succeed');
});

test('device info comes back from real firmware code', { skip: !enabled }, async () => {
  const info = await manager.getDeviceInfo();
  assert.ok(info, 'expected device info');
  // Exact fields depend on the firmware version; record what you see in
  // docs/protocol.md and tighten these assertions.
  assert.equal(typeof info, 'object');
});

test('wallet list request returns a list (possibly empty)', { skip: !enabled }, async () => {
  const result = await manager.getWallets();
  const list = result?.walletList ?? result;
  assert.ok(Array.isArray(list));
});

test('disconnect mid-session surfaces an error instead of hanging', { skip: !enabled }, async () => {
  const extra = await DeviceConnection.create();
  await extra.destroy();
  await assert.rejects(extra.send(new Uint8Array([0])));
});
