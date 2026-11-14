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

async function receiveWithin(connection: DeviceConnection, ms = 1000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const frame = await connection.receive();
    if (frame) return frame;
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

test('receive returns undefined quickly when nothing is pending', async () => {
  const connection = await connect();
  const start = Date.now();
  assert.equal(await connection.receive(), undefined);
  assert.ok(Date.now() - start < 200);
  await connection.destroy();
});

test('peek shows queued frames without consuming them', async () => {
  const connection = await connect();
  await connection.send(new Uint8Array([1]));
  await new Promise((r) => setTimeout(r, 100));
  const peeked = await connection.peek();
  assert.equal(peeked.length, 1);
  const frame = await connection.receive();
  assert.ok(frame);
  assert.equal(frame[0], 1);
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

test('using a destroyed connection throws NOT_CONNECTED', async () => {
  const connection = await connect();
  await connection.destroy();
  await assert.rejects(connection.receive(), (error: unknown) => {
    assert.ok(error instanceof SimulatorConnectionError);
    assert.equal(error.code, SimulatorErrorCode.NOT_CONNECTED);
    return true;
  });
});
