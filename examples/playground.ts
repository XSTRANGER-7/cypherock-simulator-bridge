/**
 * Interactive terminal playground. Pick an operation, see the raw frames
 * and the decoded result.
 *
 *   npx tsx examples/playground.ts
 *
 * Operations that need the SDK are hidden until it can be loaded.
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { DeviceConnection } from '../packages/hw-simulator/src';
import { hex, loadManagerApp } from './lib/sdk';

type Op = { label: string; run: () => Promise<unknown> };

async function main() {
  const rl = readline.createInterface({ input, output });
  const traffic: string[] = [];
  const connection = await DeviceConnection.create({
    logger: (line) => traffic.push(line),
  });

  let manager: any;
  try {
    manager = await loadManagerApp().create(connection);
  } catch (error) {
    console.log(`SDK not loaded (${(error as Error).message.split('.')[0]}). Raw mode only.\n`);
  }

  const ops: Op[] = [
    {
      label: 'Send raw bytes (hex)',
      run: async () => {
        const text = await rl.question('hex> ');
        await connection.send(Uint8Array.from(Buffer.from(text.replace(/\s/g, ''), 'hex')));
        for (let i = 0; i < 500; i += 1) {
          const frame = await connection.receive();
          if (frame) return hex(frame);
          await new Promise((r) => setTimeout(r, 2)); // receive() never waits
        }
        return 'no reply';
      },
    },
  ];
  if (manager) {
    ops.push(
      { label: 'Get device info', run: () => manager.getDeviceInfo() },
      { label: 'List wallets', run: () => manager.getWallets() },
    );
  }

  for (;;) {
    console.log('\nCypherock X1 simulator playground');
    ops.forEach((op, i) => console.log(`  ${i + 1}. ${op.label}`));
    console.log('  q. Quit');
    const choice = (await rl.question('> ')).trim();
    if (choice === 'q') break;
    const op = ops[Number(choice) - 1];
    if (!op) continue;

    traffic.length = 0;
    try {
      const result = await op.run();
      console.log('\nResult:', typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    } catch (error) {
      console.log('\nError:', (error as Error).message);
    }
    console.log(`\nFrames (${traffic.length}):`);
    traffic.slice(0, 20).forEach((line) => console.log('  ' + line));
  }

  rl.close();
  await connection.destroy();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
