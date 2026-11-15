/**
 * Step 1 example: open a connection and send one frame.
 * Works today against the mock or echo server; no SDK needed.
 *
 *   ./scripts/start-simulator.sh --echo
 *   npx tsx examples/connect.ts
 */
import { DeviceConnection } from '../packages/hw-simulator/src';

async function main() {
  const connection = await DeviceConnection.create({
    logger: process.env.DEBUG ? console.log : undefined,
  });
  console.log('Connected:', await connection.isConnected());
  console.log('Type:', await connection.getConnectionType());

  await connection.send(new TextEncoder().encode('hello x1'));
  for (let i = 0; i < 500; i += 1) {
    const frame = await connection.receive();
    if (frame) {
      console.log('Reply (first 16 bytes):', Buffer.from(frame.subarray(0, 16)).toString('hex'));
      break;
    }
    await new Promise((r) => setTimeout(r, 2)); // receive() never waits; yield to the socket
  }
  await connection.destroy();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
