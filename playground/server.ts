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
import { ethers } from 'ethers';
import { DeviceConnection } from '../packages/hw-simulator/src';
import { describeFrame, encodePacket, PACKET_TYPE } from '../examples/lib/packets';
import { decodeVarintFields, IDLE_STATE_NAMES, waitIdle } from '../examples/lib/status';
import { hex, loadApp, loadManagerApp } from '../examples/lib/sdk';

const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.PLAYGROUND_HOST ?? '127.0.0.1';
const PORT = Number(process.env.PLAYGROUND_PORT ?? 3000);
const SIM_PORT = Number(process.env.CYPHEROCK_SIM_PORT ?? 52640);
const STATE_DIR = process.env.SIM_STATE_DIR ?? path.join(ROOT, '.sim-state');
const SDK_DIR = process.env.SDK_DIR ?? path.resolve(ROOT, '../sdk');
const FIRMWARE_DIR = process.env.FIRMWARE_DIR ?? path.resolve(ROOT, '../x1_wallet_firmware');
const MNEMONIC =
  process.env.CYPHEROCK_SIM_TEST_MNEMONIC ?? 'test test test test test test test test test test test junk';
const ALLOW_ANY_HOST = process.env.PLAYGROUND_ALLOW_ANY_HOST === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const H = 0x80000000;

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
  walletId = undefined;
  return `wiped ${STATE_DIR}; ${await startSimulator()}`;
}

// ------------------------------------------------------------------ connection
let conn: DeviceConnection | undefined;
let walletId: Uint8Array | undefined;

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

async function recover() {
  try {
    await loadApp('core').SDK.sendAbort(await connection());
  } catch {
    /* nothing running */
  }
  const c = await connection();
  for (let i = 0; i < 200 && (await c.receive()); i += 1) {
    /* drain */
  }
  await waitIdle(c, { timeoutMs: 20000 });
}

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000} s`)), ms))]);

const appModule = (folder: string, mod: string) => require(path.join(SDK_DIR, 'packages', folder, 'node_modules', mod));
const evmExpected = (p: string) => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, p).address;
const sig0x = (s: string) => (s.startsWith('0x') ? s : `0x${s}`);

async function simtest(): Promise<Uint8Array> {
  if (walletId) return walletId;
  const m = await loadManagerApp().create(await connection());
  const { walletList } = await m.getWallets();
  const w = walletList.find((x: any) => x.name === 'SIMTEST');
  if (!w) throw new Error('SIMTEST wallet not found (the simulator must be started with CYPHEROCK_SIM_TEST_MNEMONIC)');
  walletId = w.id;
  return w.id;
}

function evm() {
  const mod = loadApp('app-evm');
  mod.setEthersLib(ethers);
  return mod;
}

const COINS: Record<string, { folder: string; cls: string; path: number[]; setup?: (m: any) => void }> = {
  solana: { folder: 'app-solana', cls: 'SolanaApp', path: [44 + H, 501 + H, H] },
  near: { folder: 'app-near', cls: 'NearApp', path: [44 + H, 397 + H, H, H, 1 + H] },
  tron: {
    folder: 'app-tron',
    cls: 'TronApp',
    path: [44 + H, 195 + H, H, 0, 0],
    setup: (m) => {
      const tw = appModule('app-tron', 'tronweb');
      const TronWeb = tw.TronWeb ?? tw.default ?? tw;
      m.setTronWeb(new TronWeb({ fullHost: 'http://127.0.0.1:9' }));
    },
  },
  xrp: { folder: 'app-xrp', cls: 'XrpApp', path: [44 + H, 144 + H, H, 0, 0], setup: (m) => m.setXrpLib(appModule('app-xrp', 'xrpl')) },
  starknet: { folder: 'app-starknet', cls: 'StarknetApp', path: [0xa55 + H, 0x4741e9c9 + H, 0x447a6028 + H, H, H, 0] },
  icp: { folder: 'app-icp', cls: 'IcpApp', path: [44 + H, 223 + H, H, 0, 0] },
  stellar: { folder: 'app-stellar', cls: 'StellarApp', path: [44 + H, 148 + H, H], setup: (m) => m.setStellarLib(appModule('app-stellar', 'stellar-sdk')) },
  constellation: { folder: 'app-constellation', cls: 'ConstellationApp', path: [44 + H, 1137 + H, H, 0, 0], setup: (m) => m.setDag4Lib(appModule('app-constellation', '@stardust-collective/dag4')) },
  sia: { folder: 'app-sia', cls: 'SiaApp', path: [0] },
  canton: { folder: 'app-canton', cls: 'CantonApp', path: [44 + H, 6767 + H, H, H, H], setup: (m) => m.setCantonLib(appModule('app-canton', '@canton-network/core-ledger-proto')) },
};
const BTC: Record<string, [number, number]> = { btc: [44, 0], 'btc-segwit': [84, 0], ltc: [44, 2], doge: [44, 3], dash: [44, 5] };

// ------------------------------------------------------------------ operations
type Params = Record<string, any>;
const OPS: Record<string, (p: Params) => Promise<unknown>> = {
  async 'raw-status'() {
    // One STATUS_REQ packet straight onto the wire (no SDK), and the exact reply bytes.
    const c = await connection();
    for (let i = 0; i < 200 && (await c.receive()); i += 1) {
      /* drop stale frames */
    }
    const request = encodePacket({ type: PACKET_TYPE.STATUS_REQ, sequence: 0xffff });
    await c.send(request);
    let reply: Uint8Array | undefined;
    for (let i = 0; i < 1500 && !reply; i += 1) {
      const f = await c.receive();
      if (f && f[0] === 0x55 && f[10] === PACKET_TYPE.STATUS) reply = f;
      else if (!f) await new Promise((r) => setTimeout(r, 2));
    }
    if (!reply) throw new Error('no STATUS reply');
    const replyPacket = reply.subarray(0, 16 + reply[15]);
    const payload = reply.subarray(16, 16 + reply[15]);
    const status = decodeVarintFields(payload.subarray(4, 4 + ((payload[0] << 8) | payload[1])));
    return {
      requestHex: hex(request),
      replyHex: hex(replyPacket),
      request: describeFrame(request),
      reply: describeFrame(reply),
      status,
      idle: IDLE_STATE_NAMES[status?.[2] ?? 0],
    };
  },
  async 'device-info'() {
    const m = await loadManagerApp().create(await connection());
    return { sdkVersion: m.getSDKVersion(), ...(await m.getDeviceInfo()) };
  },
  async wallets() {
    const m = await loadManagerApp().create(await connection());
    return m.getWallets();
  },
  async 'eth-address'(p) {
    const chainId = Number(p.chainId ?? 1);
    const index = Number(p.index ?? 0);
    const derivation = `m/44'/60'/0'/0/${index}`;
    const app = await evm().EvmApp.create(await connection());
    const r = await app.getPublicKeys({ walletId: await simtest(), derivationPaths: [{ path: [44 + H, 60 + H, H, 0, index] }], chainId });
    const expected = evmExpected(derivation);
    return { chainId, derivation, address: r.addresses[0], publicKey: r.publicKeys[0], verified: r.addresses[0].toLowerCase() === expected.toLowerCase(), expectedFromMnemonic: expected };
  },
  async 'sign-tx'(p) {
    const chainId = Number(p.chainId ?? 1);
    const unsigned = ethers.Transaction.from({
      type: 2,
      chainId,
      nonce: Number(p.nonce ?? 0),
      gasLimit: 21000,
      to: p.to || '0x000000000000000000000000000000000000dEaD',
      value: ethers.parseEther(String(p.valueEth ?? '0.001')),
      maxFeePerGas: ethers.parseUnits('30', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
    }).unsignedSerialized;
    const app = await evm().EvmApp.create(await connection());
    const r = await app.signTxn({ walletId: await simtest(), derivationPath: [44 + H, 60 + H, H, 0, 0], txn: unsigned, serializeTxn: true });
    const signed = sig0x(r.serializedTxn);
    const from = ethers.Transaction.from(signed).from ?? '';
    const expected = evmExpected("m/44'/60'/0'/0/0");
    return { chainId, unsigned, signature: r.signature, signed, recoveredSigner: from, verified: from.toLowerCase() === expected.toLowerCase(), note: 'Never broadcast: test mnemonic' };
  },
  async 'sign-message'(p) {
    const text = String(p.text ?? 'Hello from the Cypherock X1 simulator');
    const app = await evm().EvmApp.create(await connection());
    const r = await app.signPersonalMsg({ walletId: await simtest(), derivationPath: [44 + H, 60 + H, H, 0, 0], message: ethers.hexlify(ethers.toUtf8Bytes(text)).slice(2) });
    const signer = ethers.verifyMessage(text, sig0x(r.serializedSignature));
    return { text, signature: sig0x(r.serializedSignature), recoveredSigner: signer, verified: signer.toLowerCase() === evmExpected("m/44'/60'/0'/0/0").toLowerCase() };
  },
  async 'sign-typed-data'() {
    const domain = { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' };
    const types = {
      Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
      Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
    };
    const message = {
      from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
      to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
      contents: 'Hello, Bob!',
    };
    const typed = {
      domain,
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
        ],
        ...types,
      },
      primaryType: 'Mail',
      message,
    };
    const app = await evm().EvmApp.create(await connection());
    const r = await app.signTypedMsg({ walletId: await simtest(), derivationPath: [44 + H, 60 + H, H, 0, 0], message: typed });
    const signer = ethers.verifyTypedData(domain, types, message, sig0x(r.serializedSignature));
    return { typedData: typed, signature: sig0x(r.serializedSignature), recoveredSigner: signer, verified: signer.toLowerCase() === evmExpected("m/44'/60'/0'/0/0").toLowerCase() };
  },
  async 'btc-xpub'(p) {
    const coin = String(p.coin ?? 'btc');
    const [purpose, coinType] = BTC[coin] ?? BTC.btc;
    const mod = loadApp('app-btc');
    mod.setBitcoinJSLib(appModule('app-btc', 'bitcoinjs-lib'));
    const app = await mod.BtcApp.create(await connection());
    const r = await app.getXpubs({ walletId: await simtest(), derivationPaths: [{ path: [purpose + H, coinType + H, H] }] });
    const out: Record<string, unknown> = { coin, derivation: `m/${purpose}'/${coinType}'/0'`, xpub: r.xpubs[0] };
    if (coin === 'btc') {
      const expected = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/0'/0'").neuter().extendedKey;
      out.verified = expected === r.xpubs[0];
    }
    return out;
  },
  async 'coin-key'(p) {
    const name = String(p.coin ?? 'solana');
    const c = COINS[name];
    if (!c) throw new Error(`unknown coin ${name}`);
    const mod = loadApp(c.folder);
    c.setup?.(mod);
    const app = await mod[c.cls].create(await connection());
    const r = await app.getPublicKeys({ walletId: await simtest(), derivationPaths: [{ path: c.path }] });
    return { coin: name, path: c.path.map((n) => (n >= H ? `${n - H}'` : String(n))).join('/'), ...r };
  },
};

// ------------------------------------------------------------------- HTTP server
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

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
      coins: { evm: [1, 137, 56, 250, 43114, 10, 42161, 8453, 999], btc: Object.keys(BTC), other: Object.keys(COINS) },
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
