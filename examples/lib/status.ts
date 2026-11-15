/**
 * Raw device status helpers (no SDK): send STATUS_REQ, decode core.Status.
 * core.Status (cypherock-common proto/core.proto):
 *   1 device_waiting_on, 2 device_idle_state (1 IDLE, 2 USB, 3 DEVICE),
 *   3 abort_disabled, 4 current_cmd_seq, 5 cmd_state, 6 flow_status
 */
import { encodePacket, PACKET_TYPE } from './packets';

export const IDLE_STATE_NAMES = ['NULL', 'IDLE', 'USB', 'DEVICE'];

export interface RawConnection {
  send(data: Uint8Array): Promise<void>;
  receive(): Promise<Uint8Array | undefined>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Decodes the varint fields of a small protobuf message. */
export function decodeVarintFields(bytes: Uint8Array): Record<number, number> {
  const fields: Record<number, number> = {};
  let i = 0;
  while (i < bytes.length) {
    const key = bytes[i++];
    if ((key & 7) !== 0) break; // core.Status only has varint fields
    let value = 0;
    let shift = 0;
    while (i < bytes.length) {
      const b = bytes[i++];
      value += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    fields[key >> 3] = value;
  }
  return fields;
}

/** Sends one STATUS_REQ and returns the decoded core.Status, or undefined. */
export async function readStatus(connection: RawConnection): Promise<Record<number, number> | undefined> {
  await connection.send(encodePacket({ type: PACKET_TYPE.STATUS_REQ, sequence: 0xffff }));
  for (let i = 0; i < 500; i += 1) {
    const frame = await connection.receive();
    if (frame && frame[0] === 0x55 && frame[10] === PACKET_TYPE.STATUS) {
      const payload = frame.subarray(16, 16 + frame[15]);
      const protoLen = (payload[0] << 8) | payload[1];
      return decodeVarintFields(payload.subarray(4, 4 + protoLen));
    }
    if (!frame) await sleep(2);
  }
  return undefined;
}

/** Waits until device_idle_state == IDLE for `streak` polls in a row. */
export async function waitIdle(
  connection: RawConnection,
  { timeoutMs = 30000, streak = 3, log }: { timeoutMs?: number; streak?: number; log?: (s: string) => void } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let run = 0;
  let last = '';
  while (Date.now() < deadline) {
    const status = await readStatus(connection);
    const idle = status?.[2] ?? 0;
    const text = status ? `device_idle_state=${IDLE_STATE_NAMES[idle] ?? idle}` : 'no status';
    if (log && text !== last) log(text);
    last = text;
    run = idle === 1 ? run + 1 : 0;
    if (run >= streak) return true;
    await sleep(200);
  }
  return false;
}
