/**
 * Drives every web-playground operation through its HTTP API and checks the
 * results, the verification flags and the live frame stream.
 *
 *   npm run playground:web        (in another terminal)
 *   npx tsx tools/playground-smoke.ts [baseUrl]
 */
import http from 'node:http';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';

async function call(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

function countFrames(): { stop: () => number } {
  let frames = 0;
  const req = http.get(`${BASE}/api/events`, (res) => {
    res.on('data', (chunk: Buffer) => {
      frames += (chunk.toString().match(/event: frame/g) ?? []).length;
    });
  });
  return {
    stop: () => {
      req.destroy();
      return frames;
    },
  };
}

async function main() {
  const state = await call('/api/state');
  if (state.json.simulator !== 'running') {
    console.log('starting simulator through the playground...');
    const s = await call('/api/sim/start', {});
    if (s.status !== 200) throw new Error(`start failed: ${s.json.error}`);
  }
  const { coins } = (await call('/api/state')).json;
  const stream = countFrames();

  const plan: Array<[string, Record<string, unknown>]> = [
    ['raw-status', {}],
    ['device-info', {}],
    ['wallets', {}],
    ...coins.evm.map((chainId: number) => ['eth-address', { chainId }] as [string, Record<string, unknown>]),
    ['eth-address', { chainId: 1, index: 3 }],
    ['sign-tx', { chainId: 1 }],
    ['sign-tx', { chainId: 137 }],
    ['sign-tx', { chainId: 8453, valueEth: '0.5', to: '0x1111111111111111111111111111111111111111' }],
    ['sign-message', { text: 'playground smoke test' }],
    ['sign-typed-data', {}],
    ...coins.btc.map((coin: string) => ['btc-xpub', { coin }] as [string, Record<string, unknown>]),
    ...coins.other.map((coin: string) => ['coin-key', { coin }] as [string, Record<string, unknown>]),
  ];

  let failed = 0;
  for (const [op, params] of plan) {
    const r = await call(`/api/run/${op}`, params);
    const verified = r.json.result?.verified;
    const ok = r.status === 200 && r.json.ok && verified !== false;
    if (!ok) failed += 1;
    const label = `${op} ${Object.values(params).join(' ')}`.trim().padEnd(34);
    const note = verified === true ? 'verified' : ok ? 'ok' : r.json.error ?? `verified=${verified}`;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${String(r.json.ms ?? '').padStart(6)} ms  ${note}`);
  }

  await new Promise((r) => setTimeout(r, 300));
  const frames = stream.stop();
  console.log(`\n${plan.length - failed}/${plan.length} operations passed; ${frames} frames streamed to the page`);
  if (failed || frames === 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
