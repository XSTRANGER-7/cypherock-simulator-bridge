/**
 * Minimal encoder/decoder for Cypherock v3 USB packets, for logs and raw
 * checks. Mirrors x1_wallet_firmware usb_internals.c (comm_write_packet) and
 * sdk/packages/core/src/encoders/packet/packet.ts.
 */

export const PACKET_TYPE = {
  STATUS_REQ: 1,
  CMD: 2,
  CMD_OUTPUT_REQ: 3,
  STATUS: 4,
  CMD_ACK: 5,
  CMD_OUTPUT: 6,
  ERROR: 7,
  ABORT: 8,
} as const;

const TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(PACKET_TYPE).map(([name, value]) => [value, name]),
);

/** Error codes, usb_api_priv.h:40-54. */
const ERROR_NAMES: Record<number, string> = {
  1: 'CHECKSUM_ERROR',
  2: 'BUSY_PREVIOUS_CMD',
  3: 'OUT_OF_ORDER_CHUNK',
  4: 'INVALID_CHUNK_COUNT',
  5: 'INVALID_SEQUENCE_NO',
  6: 'INVALID_PAYLOAD_LENGTH',
  7: 'APP_BUFFER_BLOCKED',
  8: 'NO_MORE_CHUNKS',
  9: 'INVALID_PACKET_TYPE',
  10: 'INVALID_CHUNK_NO',
  11: 'INCOMPLETE_PACKET',
  12: 'APP_BUSY_WITH_OTHER_INTERFACE',
};

/** CRC-16/XMODEM (poly 0x1021, init 0), same value as the firmware's update_crc16 + two zero bytes. */
export function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function encodePacket(params: {
  type: number;
  sequence: number;
  chunk?: number;
  total?: number;
  payload?: Uint8Array;
  timestamp?: number;
}): Uint8Array {
  const payload = params.payload ?? new Uint8Array(0);
  if (payload.length > 48) throw new RangeError('payload must be <= 48 bytes');
  const body = new Uint8Array(12 + payload.length);
  const view = new DataView(body.buffer);
  view.setUint16(0, params.chunk ?? 1);
  view.setUint16(2, params.total ?? 1);
  view.setUint16(4, params.sequence);
  body[6] = params.type;
  view.setUint32(7, params.timestamp ?? 0);
  body[11] = payload.length;
  body.set(payload, 12);
  const crc = crc16(body);
  const packet = new Uint8Array(4 + body.length);
  packet[0] = 0x55;
  packet[1] = 0x55;
  packet[2] = crc >> 8;
  packet[3] = crc & 0xff;
  packet.set(body, 4);
  return packet;
}

/** One-line description of a 64-byte frame, e.g. "CMD_ACK seq=3 chunk 1/1 len=6". */
export function describeFrame(frame: Uint8Array): string {
  const hex = Buffer.from(frame).toString('hex');
  if (frame[0] === 0xaa) return `LEGACY(v1) ${hex.replace(/(00)+$/, '')}`;
  if (frame[0] !== 0x55 || frame[1] !== 0x55) return `raw ${hex}`;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const chunk = view.getUint16(4);
  const total = view.getUint16(6);
  const seq = view.getUint16(8);
  const type = frame[10];
  const len = frame[15];
  const payload = frame.subarray(16, 16 + len);
  const crcOk = crc16(frame.subarray(4, 16 + len)) === view.getUint16(2);
  let text = `${TYPE_NAMES[type] ?? `type${type}`} seq=${seq === 0xffff ? 'FFFF' : seq} chunk ${chunk}/${total} len=${len}${crcOk ? '' : ' BAD-CRC'}`;
  if (type === PACKET_TYPE.ERROR && len >= 6) {
    const code = (payload[4] << 8) | payload[5];
    text += ` error=${ERROR_NAMES[code] ?? code}`;
  }
  return `${text} | ${Buffer.from(frame.subarray(0, 16 + len)).toString('hex')}`;
}
