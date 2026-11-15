/**
 * Waits until the firmware simulator is idle and ready for SDK commands.
 *
 * The socket opens during application_init(), before the boot logo and the
 * main engine start. Commands sent that early are acknowledged by the comm
 * layer but rejected by sdk-core as "executing some other command"
 * (core/src/operations/proto/waitForResult.ts). This polls raw STATUS_REQ
 * packets until core.Status.device_idle_state == IDLE (1) five times in a row.
 *
 *   npx tsx scripts/wait-ready.ts [timeoutMs]
 */
import { DeviceConnection } from '../packages/hw-simulator/src';
import { waitIdle } from '../examples/lib/status';

async function main() {
  const timeoutMs = Number(process.argv[2] ?? 30000);
  const connection = await DeviceConnection.create({ retries: 20, retryDelayMs: 250 });
  try {
    const ok = await waitIdle(connection, {
      timeoutMs,
      streak: 5,
      log: (s) => console.log(`[wait-ready] ${s}`),
    });
    if (!ok) throw new Error(`simulator not idle within ${timeoutMs} ms`);
    console.log('[wait-ready] simulator is idle and ready');
  } finally {
    await connection.destroy();
  }
}

main().catch((error) => {
  console.error(`[wait-ready] ${error.message}`);
  process.exit(1);
});
