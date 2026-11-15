import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceConnection } from '../src/deviceConnection';
import { SimulatorConnectionError, SimulatorErrorCode } from '../src/errors';
import { DeviceState } from '../src/types';
import { FRAME_SIZE } from '../src/constants';
import { MockDevice } from '../../mock-device/src';

let device: MockDevice;

beforeEach(async () => {
  device = await MockDevice.start();
});

afterEach(async () => {
  await device.stop();
});

const connect = () =>
  DeviceConnection.create({ port: device.port, retries: 3, retryDelayMs: 50 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls like sdk-core's waitForPacket (RECHECK_TIME = 2 ms). */
async function receiveWithin(connection: DeviceConnection, ms = 1000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const frame = await connection.receive();
    if (frame) return frame;
    await sleep(2);
  }
  return undefined;
}

test('connects and reports simulator metadata', async () => {
  const connection = await connect();
  assert.equal(await connection.isConnected(), true);
  assert.equal(await connection.isInitialized(), true);
  assert.equal(await connection.getConnectionType(), 'simulator');
  assert.equal(await connection.getDeviceState(), DeviceState.MAIN);
  await connection.destroy();
  assert.equal(await connection.isConnected(), false);
});

test('send then receive round-trips a full frame through the echo device', async () => {
  const connection = await connect();
  const payload = Uint8Array.from({ length: 10 }, (_, i) => 0xa0 + i);
  await connection.send(payload);

  const frame = await receiveWithin(connection);
  assert.ok(frame, 'expected a frame back');
  assert.equal(frame.length, FRAME_SIZE);
  assert.deepEqual([...frame.subarray(0, 10)], [...payload]);
  await connection.destroy();
});

test('a payload larger than one frame arrives as several frames', async () => {
  const connection = await connect();
  await connection.send(new Uint8Array(FRAME_SIZE * 2 + 5).fill(7));

  const frames: Uint8Array[] = [];
  for (let i = 0; i < 3; i += 1) {
    const frame = await receiveWithin(connection);
    assert.ok(frame);
    frames.push(frame);
  }
  assert.equal(device.received.length, 3);
  assert.equal(frames[2][4], 7);
  assert.equal(frames[2][5], 0);
  await connection.destroy();
});

test('receive returns undefined at once when nothing is pending (hw-hid contract)', async () => {
  const connection = await connect();
  const start = process.hrtime.bigint();
  assert.equal(await connection.receive(), undefined);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(elapsedMs < 5, `receive() took ${elapsedMs} ms`);
  await connection.destroy();
});

test('peek returns { id, data } items without consuming them, ids stay stable', async () => {
  const connection = await connect();
  await connection.send(new Uint8Array([1]));
  await sleep(100);
  const first = await connection.peek();
  const second = await connection.peek();
  assert.equal(first.length, 1);
  assert.equal(typeof first[0].id, 'string');
  assert.ok(first[0].data instanceof Uint8Array);
  assert.equal(first[0].data.length, FRAME_SIZE);
  assert.equal(first[0].id, second[0].id, 'sdk-core skips seen items by id');
  const frame = await connection.receive();
  assert.ok(frame);
  assert.equal(frame[0], 1);
  assert.equal((await connection.peek()).length, 0);
  await connection.destroy();
});

test('sequence numbers increase', async () => {
  const connection = await connect();
  const a = await connection.getNewSequenceNumber();
  const b = await connection.getNewSequenceNumber();
  assert.equal(b, a + 1);
  assert.equal(await connection.getSequenceNumber(), b);
  await connection.destroy();
});

test('device-side disconnect makes the connection report closed', async () => {
  device.setHandler((_frame, control) => control.disconnect());
  const connection = await connect();
  await connection.send(new Uint8Array([9]));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await connection.isConnected(), false);
  await assert.rejects(connection.send(new Uint8Array([1])), (error: unknown) => {
    assert.ok(error instanceof SimulatorConnectionError);
    assert.equal(error.code, SimulatorErrorCode.CONNECTION_CLOSED);
    return true;
  });
  await connection.destroy();
});

test('connecting to a closed port fails with CONNECTION_REFUSED', async () => {
  const port = device.port;
  await device.stop();
  await assert.rejects(
    DeviceConnection.create({ port, retries: 2, retryDelayMs: 20 }),
    (error: unknown) => {
      assert.ok(error instanceof SimulatorConnectionError);
      assert.equal(error.code, SimulatorErrorCode.CONNECTION_REFUSED);
      return true;
    },
  );
  device = await MockDevice.start(); // so afterEach can stop it
});

test('list() finds a running simulator and returns [] when none is running', async () => {
  const found = await DeviceConnection.list({ port: device.port });
  assert.deepEqual(found, [{ host: '127.0.0.1', port: device.port }]);
  const port = device.port;
  await device.stop();
  assert.deepEqual(await DeviceConnection.list({ port, retryDelayMs: 10 }), []);
  device = await MockDevice.start();
});

test('a destroyed connection: send throws NOT_CONNECTED, receive returns undefined', async () => {
  const connection = await connect();
  await connection.destroy();
  assert.equal(await connection.isConnected(), false);
  assert.equal(await connection.receive(), undefined);
  await assert.rejects(connection.send(new Uint8Array([1])), (error: unknown) => {
    assert.ok(error instanceof SimulatorConnectionError);
    assert.equal(error.code, SimulatorErrorCode.NOT_CONNECTED);
    return true;
  });
});

test('onFrame sees every tx and rx frame', async () => {
  const seen: string[] = [];
  const connection = await DeviceConnection.create({
    port: device.port,
    retries: 3,
    retryDelayMs: 50,
    onFrame: (dir, frame) => seen.push(`${dir}:${frame[0]}`),
  });
  await connection.send(new Uint8Array([42]));
  assert.ok(await receiveWithin(connection));
  assert.deepEqual(seen, ['tx:42', 'rx:42']);
  await connection.destroy();
});
