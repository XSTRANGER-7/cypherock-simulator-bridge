/**
 * Waits until the firmware simulator is idle and ready for SDK commands.
 *
 * The socket opens during application_init(), before the boot logo and the
 * main engine start. Commands sent that early are acknowledged by the comm
 * layer but rejected by sdk-core as "executing some other command"
 * (core/src/operations/proto/waitForResult.ts). This polls raw STATUS_REQ
 * packets until core.Status.device_idle_state == DEVICE_IDLE_STATE_IDLE (1)
 * several times in a row.
 *
 *   npx tsx scripts/wait-ready.ts [timeoutMs]
 */
import { DeviceConnection } from '../packages/hw-simulator/src';
import { encodePacket, PACKET_TYPE } from '../examples/lib/packets';

const IDLE_STATE_NAMES = ['NULL', 'IDLE', 'USB', 'DEVICE'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Decodes the varint fields of a small protobuf message (core.Status). */
function decodeVarintFields(bytes: Uint8Array): Record<number, number> {
  const fields: Record<number, number> = {};
  let i = 0;
  while (i < bytes.length) {
    const key = bytes[i++];
    const field = key >> 3;
    if ((key & 7) !== 0) break; // Status only has varint fields
    let value = 0;
    let shift = 0;
    while (i < bytes.length) {
      const b = bytes[i++];
      value += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(b & 0x80)) break;
    }
    fields[field] = value;
  }
  return fields;
}

async function readStatus(connection: DeviceConnection): Promise<Record<number, number> | undefined> {
  await connection.send(encodePacket({ type: PACKET_TYPE.STATUS_REQ, sequence: 0xffff }));
  for (let i = 0; i < 250; i += 1) {
    const frame = await connection.receive();
    if (frame && frame[10] === PACKET_TYPE.STATUS) {
      const payload = frame.subarray(16, 16 + frame[15]);
      const protoLen = (payload[0] << 8) | payload[1];
      return decodeVarintFields(payload.subarray(4, 4 + protoLen));
    }
    if (!frame) await sleep(2);
  }
  return undefined;
}

async function main() {
  const timeoutMs = Number(process.argv[2] ?? 30000);
  const deadline = Date.now() + timeoutMs;
  const connection = await DeviceConnection.create({ retries: 20, retryDelayMs: 250 });
  let idleStreak = 0;
  let last = '';
  try {
    while (Date.now() < deadline) {
      const status = await readStatus(connection);
      const idle = status?.[2] ?? 0;
      const text = status ? `device_idle_state=${IDLE_STATE_NAMES[idle] ?? idle}` : 'no status';
      if (text !== last) {
        console.log(`[wait-ready] ${text}`);
        last = text;
      }
      idleStreak = idle === 1 ? idleStreak + 1 : 0;
      if (idleStreak >= 5) {
        console.log('[wait-ready] simulator is idle and ready');
        return;
      }
      await sleep(200);
    }
    throw new Error(`simulator not idle within ${timeoutMs} ms`);
  } finally {
    await connection.destroy();
  }
}

main().catch((error) => {
  console.error(`[wait-ready] ${error.message}`);
  process.exit(1);
});
