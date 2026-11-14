import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameAccumulator, toFrames } from '../src/framing';

test('toFrames pads a short payload to one full frame', () => {
  const frames = toFrames(new Uint8Array([1, 2, 3]), 8);
  assert.equal(frames.length, 1);
  assert.deepEqual([...frames[0]], [1, 2, 3, 0, 0, 0, 0, 0]);
});

test('toFrames splits a long payload across frames', () => {
  const data = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
  const frames = toFrames(data, 8);
  assert.equal(frames.length, 3);
  assert.deepEqual([...frames[2]], [17, 18, 19, 20, 0, 0, 0, 0]);
});

test('toFrames sends one empty frame for an empty payload', () => {
  const frames = toFrames(new Uint8Array(0), 4);
  assert.equal(frames.length, 1);
  assert.deepEqual([...frames[0]], [0, 0, 0, 0]);
});

test('toFrames rejects a non-positive frame size', () => {
  assert.throws(() => toFrames(new Uint8Array([1]), 0), RangeError);
});

test('FrameAccumulator rebuilds frames split across TCP chunks', () => {
  const acc = new FrameAccumulator(4);
  assert.equal(acc.push(new Uint8Array([1, 2])).length, 0);
  assert.equal(acc.pendingBytes, 2);
  const frames = acc.push(new Uint8Array([3, 4, 5]));
  assert.equal(frames.length, 1);
  assert.deepEqual([...frames[0]], [1, 2, 3, 4]);
  assert.equal(acc.pendingBytes, 1);
});

test('FrameAccumulator emits several frames from one chunk', () => {
  const acc = new FrameAccumulator(2);
  const frames = acc.push(new Uint8Array([1, 2, 3, 4, 5, 6]));
  assert.equal(frames.length, 3);
  assert.equal(acc.pendingBytes, 0);
});
