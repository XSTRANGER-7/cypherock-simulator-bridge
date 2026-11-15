/**
 * Browser test of the web playground: opens the page in headless Edge/Chrome
 * through the DevTools protocol, clicks buttons like a user, waits for the
 * results and the live frame log, and saves a screenshot.
 *
 *   npm run playground:web      (simulator running or started from the page)
 *   npx tsx tools/playground-ui-test.ts [baseUrl]
 *
 * Browser: $BROWSER, else Edge or Chrome in their default locations.
 * Needs Node 22+ (built-in WebSocket).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const OUT = path.resolve(__dirname, '../docs/notes/playground.png');
const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean) as string[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = CANDIDATES.find((p) => fs.existsSync(p));
  if (!browser) throw new Error('no Edge/Chrome found; set BROWSER=/path/to/browser');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'x1-playground-'));
  const port = 9333;
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1500,1100', BASE,
  ], { stdio: 'ignore' });

  try {
    let wsUrl = '';
    for (let i = 0; i < 50 && !wsUrl; i += 1) {
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[];
        wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? '';
      } catch {
        /* browser still starting */
      }
      if (!wsUrl) await sleep(200);
    }
    if (!wsUrl) throw new Error('could not reach the browser DevTools endpoint');

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 0;
    const pending = new Map<number, (v: any) => void>();
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    };
    const cdp = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((resolve) => {
        id += 1;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const js = async (expression: string) =>
      (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
    const waitFor = async (expression: string, ms: number, what: string) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (await js(expression)) return;
        await sleep(250);
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click(), true`);

    await cdp('Page.enable');
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('#sim-pill')`, 10000, 'page load');
    const pill = await js(`document.querySelector('#sim-pill').textContent`);
    console.log(`page loaded: ${pill}`);
    if (!/running/.test(pill)) {
      await click('#btn-start');
      await waitFor(`/running/.test(document.querySelector('#sim-pill').textContent)`, 90000, 'simulator start');
      console.log('started the simulator from the page');
    }

    const steps: Array<[string, string, (r: any) => boolean]> = [
      ['[data-op="device-info"]', 'Device info', (r) => r.result.deviceSerial?.length === 64],
      ['[data-op="eth-address"]', 'Get address', (r) => r.result.verified === true],
      ['[data-op="sign-tx"]', 'Sign transaction', (r) => r.result.verified === true],
      ['[data-op="sign-message"]', 'Sign message', (r) => r.result.verified === true],
      ['[data-op="coin-key"]', 'Other coin key', (r) => !!r.result.publicKeys || !!r.result.addresses],
    ];
    for (const [selector, name, ok] of steps) {
      await click(selector);
      await waitFor(`!document.querySelector('${selector}').disabled && document.querySelector('#result-badge').textContent !== 'running'`, 90000, name);
      const badge = await js(`document.querySelector('#result-badge').textContent`);
      const text = await js(`document.querySelector('#result').textContent`);
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const pass = !!parsed && ok(parsed);
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} badge="${badge}"`);
      if (!pass) throw new Error(`${name}: ${text.slice(0, 300)}`);
    }

    const frames = await js(`document.querySelectorAll('#frames li').length`);
    const firstFrames = await js(`[...document.querySelectorAll('#frames li')].slice(-3).map(li => li.textContent).join('\\n')`);
    console.log(`frame log shows ${frames} frames, last ones:\n${firstFrames}`);
    if (!frames) throw new Error('no frames in the live log');

    const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log(`screenshot: ${OUT}`);
    await cdp('Browser.close').catch(() => undefined);
    ws.close();
  } finally {
    proc.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
