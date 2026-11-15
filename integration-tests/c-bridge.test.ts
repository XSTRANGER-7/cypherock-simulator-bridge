/**
 * Cross-language test: the TypeScript transport (packages/hw-simulator)
 * against the real C socket bridge (firmware-patch) in loopback mode.
 *
 * Proves both halves agree on framing, padding and connection lifecycle
 * before either is wired into Cypherock's code.
 *
 * Requires: make -C firmware-patch
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DeviceConnection, FRAME_SIZE } from '../packages/hw-simulator/src';

const binary = path.resolve(
  __dirname,
  `../firmware-patch/build/echo_server${process.platform === 'win32' ? '.exe' : ''}`,
);
let server: ChildProcess | undefined;
let port = 0;

before(async () => {
  if (!existsSync(binary)) return;
  server = spawn(binary, [], { env: { ...process.env, CYPHEROCK_SIM_PORT: '0' } });
  port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('echo_server did not start')), 3000);
    server!.stderr!.on('data', (chunk: Buffer) => {
      const match = /listening on 127\.0\.0\.1:(\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
});

after(() => {
  server?.kill('SIGTERM');
});

async function receiveWithin(connection: DeviceConnection, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const frame = await connection.receive();
    if (frame) return frame;
    await new Promise((r) => setTimeout(r, 2)); // like sdk-core's RECHECK_TIME
  }
  return undefined;
}

test('TS transport round-trips frames through the C bridge', { skip: !existsSync(binary) && 'run: make -C firmware-patch' }, async () => {
  const connection = await DeviceConnection.create({ port, retries: 5, retryDelayMs: 100 });
  const payload = Uint8Array.from({ length: FRAME_SIZE + 6 }, (_, i) => (i * 7) & 0xff);
  await connection.send(payload);

  const first = await receiveWithin(connection);
  const second = await receiveWithin(connection);
  assert.ok(first && second, 'expected two frames back');
  assert.deepEqual([...first], [...payload.subarray(0, FRAME_SIZE)]);
  assert.deepEqual([...second.subarray(0, 6)], [...payload.subarray(FRAME_SIZE)]);
  assert.ok(second.subarray(6).every((b) => b === 0), 'last frame must be zero-padded');
  await connection.destroy();
});

test('C bridge accepts a fresh client after the previous one leaves', { skip: !existsSync(binary) && 'run: make -C firmware-patch' }, async () => {
  for (let round = 0; round < 3; round += 1) {
    const connection = await DeviceConnection.create({ port, retries: 5, retryDelayMs: 100 });
    await connection.send(new Uint8Array([round + 1]));
    const frame = await receiveWithin(connection);
    assert.ok(frame);
    assert.equal(frame[0], round + 1);
    await connection.destroy();
  }
});
