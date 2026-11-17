/**
 * Web playground for the Cypherock X1 firmware simulator.
 *
 *   npm run playground:web          then open http://127.0.0.1:3000
 *
 * Starts/stops the simulator, holds the one bridge connection, runs real SDK
 * operations one at a time, and streams every 64-byte frame (decoded) to the
 * page over Server-Sent Events. Localhost only: the page can make the
 * simulator sign, so the server binds to 127.0.0.1 and rejects requests whose
 * Host header is not local (DNS-rebinding protection) or whose body is not JSON.
 *
 * Env: PLAYGROUND_PORT (3000), PLAYGROUND_HOST (127.0.0.1), CYPHEROCK_SIM_BINARY,
 * SIM_STATE_DIR, CYPHEROCK_SIM_TEST_MNEMONIC (default: the published Hardhat
 * test mnemonic), PLAYGROUND_ALLOW_ANY_HOST=1 (Docker only).
 */
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { DeviceConnection } from '../packages/hw-simulator/src';
import { describeFrame } from '../examples/lib/packets';
import { waitIdle } from '../examples/lib/status';
import { loadApp } from '../examples/lib/sdk';
import { BTC, COINS, createOps, DEFAULT_TEST_MNEMONIC, EVM_CHAINS, hex, type Params } from './ops';

const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.PLAYGROUND_HOST ?? '127.0.0.1';
const PORT = Number(process.env.PLAYGROUND_PORT ?? 3000);
const SIM_PORT = Number(process.env.CYPHEROCK_SIM_PORT ?? 52640);
const STATE_DIR = process.env.SIM_STATE_DIR ?? path.join(ROOT, '.sim-state');
const SDK_DIR = process.env.SDK_DIR ?? path.resolve(ROOT, '../sdk');
const FIRMWARE_DIR = process.env.FIRMWARE_DIR ?? path.resolve(ROOT, '../x1_wallet_firmware');
const MNEMONIC = process.env.CYPHEROCK_SIM_TEST_MNEMONIC ?? DEFAULT_TEST_MNEMONIC;
const ALLOW_ANY_HOST = process.env.PLAYGROUND_ALLOW_ANY_HOST === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------- events (SSE)
const clients = new Set<http.ServerResponse>();
function broadcast(type: string, data: unknown) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
const log = (text: string) => broadcast('log', { at: Date.now(), text });

// ------------------------------------------------------------ simulator process
let sim: ChildProcess | undefined;
let simExternal = false;

function simulatorBinary(): string {
  if (process.env.CYPHEROCK_SIM_BINARY) return process.env.CYPHEROCK_SIM_BINARY;
  const recorded = path.join(FIRMWARE_DIR, 'build', 'Simulator', '.simulator-path');
  if (fs.existsSync(recorded)) {
    let p = fs.readFileSync(recorded, 'utf8').trim();
    if (process.platform === 'win32') p = p.replace(/^\/([a-z])\//i, '$1:/'); // MSYS path -> Windows path
    if (fs.existsSync(p)) return p;
  }
  const base = path.join(FIRMWARE_DIR, 'bin', 'Cypherock_Simulator');
  return fs.existsSync(`${base}.exe`) ? `${base}.exe` : base;
}

const portOpen = () =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(SIM_PORT, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });

async function startSimulator(): Promise<string> {
  if (sim && sim.exitCode === null) return 'already running';
  if (await portOpen()) {
    simExternal = true;
    return 'a simulator is already listening; attached to it';
  }
  const binary = simulatorBinary();
  if (!fs.existsSync(binary)) throw new Error(`simulator not built: ${binary} (run ./scripts/build-simulator.sh)`);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  simExternal = false;
  sim = spawn(binary, [], {
    cwd: STATE_DIR,
    env: { ...process.env, CYPHEROCK_SIM_PORT: String(SIM_PORT), CYPHEROCK_SIM_TEST_MNEMONIC: MNEMONIC },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const forward = (chunk: Buffer) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('used:'))
      .forEach((l) => log(l));
  sim.stdout?.on('data', forward);
  sim.stderr?.on('data', forward);
  sim.on('exit', (code) => {
    log(`simulator exited (${code})`);
    broadcast('state', { simulator: 'stopped' });
  });
  for (let i = 0; i < 300 && !(await portOpen()); i += 1) {
    if (sim.exitCode !== null) throw new Error('simulator exited during start-up; see the log');
    await new Promise((r) => setTimeout(r, 100));
  }
  await dropConnection();
  const c = await connection();
  const ready = await waitIdle(c, { timeoutMs: 60000, streak: 5, log: (s) => log(`[ready] ${s}`) });
  if (!ready) throw new Error('simulator did not become idle');
  broadcast('state', { simulator: 'running' });
  return `started ${path.basename(binary)} (state in ${STATE_DIR})`;
}

async function stopSimulator(): Promise<string> {
  await dropConnection();
  if (simExternal) return 'attached to an external simulator; stop it where it was started';
  if (!sim || sim.exitCode !== null) return 'not running';
  sim.kill();
  await new Promise((r) => setTimeout(r, 500));
  return 'stopped';
}

async function resetSimulator(): Promise<string> {
  await stopSimulator();
  if (fs.existsSync(STATE_DIR)) {
    for (const f of fs.readdirSync(STATE_DIR)) fs.rmSync(path.join(STATE_DIR, f), { force: true, recursive: true });
  }
  ops.forgetWallet();
  return `wiped ${STATE_DIR}; ${await startSimulator()}`;
}

// ------------------------------------------------------------------ connection
let conn: DeviceConnection | undefined;

async function connection(): Promise<DeviceConnection> {
  if (conn && (await conn.isConnected())) return conn;
  conn = await DeviceConnection.create({
    port: SIM_PORT,
    retries: 5,
    onFrame: (dir, frame) => broadcast('frame', { at: Date.now(), dir, text: describeFrame(frame) }),
  });
  return conn;
}

async function dropConnection() {
  const c = conn;
  conn = undefined;
  await c?.destroy().catch(() => undefined);
}

// One operation at a time: the firmware serves one command, like one USB host.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000} s`)), ms))]);

// ------------------------------------------------------------------ operations (playground/ops.ts)
const ops = createOps({
  mnemonic: MNEMONIC,
  connection,
  app: async (folder) => loadApp(folder),
  lib: async (folder, name) => require(path.join(SDK_DIR, 'packages', folder, 'node_modules', name)),
});
const { OPS, recover } = ops;

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, (_k, v) => (v instanceof Uint8Array ? hex(v) : typeof v === 'bigint' ? v.toString() : v), 2));
}

function readJson(req: http.IncomingMessage): Promise<Params> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
  });
}

const localHost = (h?: string) => !!h && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);

const server = http.createServer(async (req, res) => {
  if (!ALLOW_ANY_HOST && !localHost(req.headers.host)) {
    res.writeHead(403).end('forbidden host');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://local');

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    send(res, 200, {
      simulator: (sim && sim.exitCode === null) || simExternal || (await portOpen()) ? 'running' : 'stopped',
      managed: !!sim && sim.exitCode === null,
      bridge: { host: '127.0.0.1', port: SIM_PORT },
      binary: simulatorBinary(),
      testMnemonic: MNEMONIC,
      operations: Object.keys(OPS),
      coins: { evm: EVM_CHAINS, btc: Object.keys(BTC), other: Object.keys(COINS) },
    });
    return;
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      send(res, 415, { error: 'send application/json' });
      return;
    }
    let params: Params;
    try {
      params = await readJson(req);
    } catch (e) {
      send(res, 400, { error: (e as Error).message });
      return;
    }
    const simAction = /^\/api\/sim\/(start|stop|reset)$/.exec(url.pathname);
    const op = /^\/api\/run\/([a-z-]+)$/.exec(url.pathname);
    const started = Date.now();
    try {
      if (simAction) {
        const action = { start: startSimulator, stop: stopSimulator, reset: resetSimulator }[simAction[1] as 'start' | 'stop' | 'reset'];
        const message = await serial(action);
        send(res, 200, { ok: true, message, ms: Date.now() - started });
      } else if (op && OPS[op[1]]) {
        log(`run ${op[1]} ${JSON.stringify(params)}`);
        const result = await serial(async () => {
          try {
            return await timeout(OPS[op[1]](params), 90000);
          } catch (error) {
            await recover().catch(() => undefined);
            throw error;
          }
        });
        send(res, 200, { ok: true, op: op[1], ms: Date.now() - started, result });
      } else {
        send(res, 404, { error: 'unknown endpoint' });
      }
    } catch (error) {
      log(`error: ${(error as Error).message}`);
      send(res, 500, { ok: false, error: (error as Error).message, ms: Date.now() - started });
    }
    return;
  }
  if (req.method === 'GET') {
    const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, ''));
    if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'",
        'x-frame-options': 'DENY',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }
  res.writeHead(404).end('not found');
});

setInterval(() => broadcast('ping', Date.now()), 15000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Cypherock simulator playground: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
  console.log(`simulator binary: ${simulatorBinary()}`);
  if (process.env.PLAYGROUND_AUTOSTART === '1') {
    serial(startSimulator).then((m) => console.log(m), (e) => console.error(`autostart failed: ${e.message}`));
  }
});

const shutdown = async () => {
  await stopSimulator().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
