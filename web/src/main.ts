/**
 * X1 Quest without a server: the X1 firmware (compiled to WebAssembly) and
 * the Cypherock SDK both run in this tab. This file gives the game the same
 * API the Node server (playground/server.ts) offers over HTTP and SSE, as
 * window.X1Local, and runs the same operations (playground/ops.ts).
 */
import { describeFrame } from '../../examples/lib/packets';
import { waitIdle } from '../../examples/lib/status';
import { BTC, COINS, createOps, DEFAULT_TEST_MNEMONIC, EVM_CHAINS, hex, type Params } from '../../playground/ops';
import { APPS, LIBS } from './sdk-map';
import { WasmDeviceConnection, type X1Module } from './wasmConnection';

type Listener = (type: string, data: any) => void;

const MNEMONIC = DEFAULT_TEST_MNEMONIC;
const AUTOSTART_KEY = 'x1quest.autostart';
const base = new URL('.', document.baseURI);

const listeners = new Set<Listener>();
function emit(type: string, data: unknown) {
  for (const l of listeners) {
    try {
      l(type, data);
    } catch {
      /* a broken listener must not stop the others */
    }
  }
}
const log = (text: string) => emit('log', { at: Date.now(), text });

// ------------------------------------------------------------------ the X1 display
/** A card above the live wire: the firmware's own display, drawn by SDL. */
function displayCard(): HTMLElement {
  let card = document.getElementById('x1-display');
  if (card) return card;
  card = document.createElement('div');
  card.id = 'x1-display';
  card.className = 'card x1-display';
  const head = document.createElement('div');
  head.className = 'card-title';
  const h = document.createElement('h3');
  h.textContent = 'X1 screen';
  const tag = document.createElement('span');
  tag.className = 'muted';
  tag.textContent = 'real firmware · WebAssembly';
  head.append(h, tag);
  const empty = document.createElement('div');
  empty.className = 'x1-empty';
  empty.textContent = 'Powered off. Level 0 boots the firmware here.';
  card.append(head, empty);
  document.querySelector('aside')?.prepend(card);
  return card;
}

function displayCanvas(): HTMLCanvasElement {
  const existing = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (existing) return existing;
  const card = displayCard();
  card.querySelector('.x1-empty')?.remove();
  const canvas = document.createElement('canvas');
  canvas.id = 'canvas'; // Emscripten's SDL2 port finds its window by the selector #canvas
  canvas.tabIndex = 0;
  canvas.width = 512;
  canvas.height = 256;
  canvas.setAttribute('aria-label', 'X1 device screen. Click it, then use the arrow keys, Enter and Esc as the joystick.');
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const hint = document.createElement('p');
  hint.className = 'x1-hint';
  hint.textContent = 'Click the screen, then arrow keys = joystick, Enter = select, Esc = back.';
  card.append(canvas, hint);
  return canvas;
}

/** Labels on the live wire that describe the desktop setup. */
function relabelForBrowser() {
  const bridge = document.querySelector('#bridge-node small');
  if (bridge) bridge.textContent = 'in-page';
  const device = document.querySelector('.node.device small');
  if (device) device.textContent = 'WebAssembly';
  document.querySelector('a[href="/classic.html"]')?.remove(); // needs the Node server
}

// ------------------------------------------------------------------ simulator
let mod: (X1Module & Record<string, any>) | undefined;
let conn: WasmDeviceConnection | undefined;
let starting: Promise<string> | undefined;
let running = false;

async function boot(): Promise<string> {
  const t0 = performance.now();
  log('Loading the X1 firmware (WebAssembly)…');
  const url = new URL('x1/Cypherock_Simulator.js', base).href;
  const { default: createX1Simulator } = await import(/* @vite-ignore */ url);
  const canvas = displayCanvas();
  const options: Record<string, any> = {
    canvas,
    locateFile: (file: string) => new URL(`x1/${file}`, base).href,
    print: (text: string) => text && !text.startsWith('used:') && log(text),
    printErr: (text: string) => text && log(text),
    preRun: [
      (m: any) => {
        const env = (m ?? options).ENV;
        env.CYPHEROCK_SIM_TEST_MNEMONIC = MNEMONIC; // loads the SIMTEST wallet
        env.SDL_EMSCRIPTEN_KEYBOARD_ELEMENT = '#canvas'; // keys only while the screen has focus
      },
    ],
  };
  mod = await createX1Simulator(options);
  conn = new WasmDeviceConnection(mod as X1Module, (dir, frame) => emit('frame', { at: Date.now(), dir, text: describeFrame(frame) }));
  const ready = await waitIdle(conn, { timeoutMs: 60000, streak: 5, log: (s) => log(`[ready] ${s}`) });
  if (!ready) throw new Error('the firmware did not become idle');
  running = true;
  emit('state', { simulator: 'running' });
  return `X1 firmware booted in your browser (WebAssembly) in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
}

// ------------------------------------------------------------------ operations
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000} s`)), ms))]);

/**
 * A lazily loaded CommonJS package arrives as { default: module.exports };
 * hand the SDK what Node's require() would give it.
 */
function asRequire(mod: any): any {
  const keys = Object.keys(mod ?? {}).filter((k) => k !== '__esModule');
  return keys.length === 1 && keys[0] === 'default' && mod.default != null ? mod.default : mod;
}

const ops = createOps({
  mnemonic: MNEMONIC,
  async connection() {
    if (!conn) throw new Error('Power on the simulator first (level 0)');
    return conn;
  },
  async app(folder) {
    const load = APPS[folder];
    if (!load) throw new Error(`SDK package ${folder} is not in this build`);
    return asRequire(await load());
  },
  async lib(folder, name) {
    const load = LIBS[`${folder}/${name}`];
    if (!load) throw new Error(`${name} is not in this build`);
    return asRequire(await load());
  },
});

/** Same JSON the server sends: bytes as hex, bigints as strings. */
const plain = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_k, v) => (v instanceof Uint8Array ? hex(v) : typeof v === 'bigint' ? v.toString() : v)));

function reloadPage(autostart: boolean): Promise<never> {
  try {
    if (autostart) sessionStorage.setItem(AUTOSTART_KEY, '1');
  } catch {
    /* storage blocked: the user presses Power on again */
  }
  location.reload();
  return new Promise<never>(() => undefined);
}

async function request(path: string, body?: Params): Promise<any> {
  const started = Date.now();
  if (path === '/api/state') {
    return {
      simulator: running ? 'running' : 'stopped',
      managed: running,
      bridge: { host: 'in-page', port: 0 },
      binary: 'x1/Cypherock_Simulator.wasm',
      testMnemonic: MNEMONIC,
      operations: Object.keys(ops.OPS),
      coins: { evm: EVM_CHAINS, btc: Object.keys(BTC), other: Object.keys(COINS) },
      mode: 'browser',
    };
  }
  if (path === '/api/sim/start') {
    if (running) return { ok: true, message: 'already running', ms: 0 };
    starting ??= boot();
    try {
      return { ok: true, message: await starting, ms: Date.now() - started };
    } catch (error) {
      starting = undefined;
      throw error;
    }
  }
  // Wiping or stopping an in-memory device = a fresh page (flash lives in memory).
  if (path === '/api/sim/reset') return reloadPage(true);
  if (path === '/api/sim/stop') return reloadPage(false);

  const m = /^\/api\/run\/([a-z-]+)$/.exec(path);
  const fn = m && ops.OPS[m[1]];
  if (!m || !fn) throw new Error('unknown endpoint');
  log(`run ${m[1]} ${JSON.stringify(body ?? {})}`);
  const result = await serial(async () => {
    try {
      return await timeout(fn(body ?? {}), 90000);
    } catch (error) {
      await ops.recover().catch(() => undefined);
      throw error;
    }
  });
  return { ok: true, op: m[1], ms: Date.now() - started, result: plain(result) };
}

declare global {
  interface Window {
    X1Local?: {
      mode: 'browser';
      request(path: string, body?: Params): Promise<any>;
      subscribe(listener: Listener): () => void;
    };
  }
}

window.X1Local = {
  mode: 'browser',
  async request(path, body) {
    try {
      return await request(path, body);
    } catch (error) {
      log(`error: ${(error as Error).message}`);
      throw error;
    }
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

relabelForBrowser();
displayCard();

// After "Reset device": boot straight away again.
try {
  if (sessionStorage.getItem(AUTOSTART_KEY)) {
    sessionStorage.removeItem(AUTOSTART_KEY);
    setTimeout(() => window.X1Local?.request('/api/sim/start', {}).catch(() => undefined), 0);
  }
} catch {
  /* storage blocked */
}
