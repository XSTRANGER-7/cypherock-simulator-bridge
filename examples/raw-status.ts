/**
 * Smallest end-to-end check, no SDK involved: sends one v3 STATUS_REQ packet
 * and decodes the firmware's reply.
 *
 *   ./scripts/start-simulator.sh
 *   npx tsx examples/raw-status.ts
 *
 * Packet layout (big endian), from x1_wallet_firmware
 * common/interfaces/desktop_app_interface/usb_internals.c:89-97:
 *   0  55 55        start of frame
 *   2  crc16        CRC-16/XMODEM over bytes 4..end of payload
 *   4  chunk no     6  total chunks   8  sequence no (FFFF for status)
 *   10 packet type  11 timestamp (4)  15 payload length  16 payload
 */
import { DeviceConnection } from '../packages/hw-simulator/src';
import { describeFrame, encodePacket, PACKET_TYPE } from './lib/packets';

async function main() {
  const connection = await DeviceConnection.create({ retries: 3 });
  const request = encodePacket({ type: PACKET_TYPE.STATUS_REQ, sequence: 0xffff });
  console.log('tx', describeFrame(request));
  await connection.send(request);

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const frame = await connection.receive();
    if (frame) {
      console.log('rx', describeFrame(frame));
      const type = frame[10];
      await connection.destroy();
      if (type !== PACKET_TYPE.STATUS) {
        throw new Error(`expected a STATUS (4) reply, got type ${type}`);
      }
      console.log('OK: the firmware simulator answered a raw STATUS_REQ');
      return;
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  await connection.destroy();
  throw new Error('no reply within 3 s');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
