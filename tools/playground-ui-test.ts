/**
 * Browser test of the web playground: opens the page in headless Edge/Chrome
 * through the DevTools protocol, clicks buttons like a user, waits for the
 * results and the live frame log, and saves a screenshot.
 *
 *   npm run playground:web      (simulator running or started from the page)
 *   npx tsx tools/playground-ui-test.ts [baseUrl]
 *   UI_SHOT_PREFIX=web- npx tsx tools/playground-ui-test.ts http://127.0.0.1:8090/   (browser build)
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
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        console.log(`[page exception] ${d.exception?.description ?? d.text}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        console.log(`[page ${msg.params.type}] ${msg.params.args.map((a: any) => a.value ?? a.description ?? '').join(' ')}`);
      }
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

    const shoot = async (file: string) => {
      const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const out = path.join(path.dirname(OUT), `${process.env.UI_SHOT_PREFIX ?? ''}${file}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      console.log(`screenshot: ${out}`);
    };

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('.lvl-node')`, 15000, 'page load');
    console.log(`page loaded: ${await js(`document.querySelector('#sim-text').textContent`)}`);

    // Play the game like a user: each level -> press its action button -> wait
    // for the checks -> every check must be green. Collect levels and the boss too.
    const levels = Number(process.env.UI_LEVELS ?? 11);
    const shots: Record<number, string> = { 1: 'game-level1-packet.png', 4: 'game-level4-address.png', 5: 'game-level5-sign.png', 10: 'game-boss.png' };
    for (let i = 0; i < levels; i += 1) {
      await click(`.lvl-node[data-level="${i}"]`);
      await waitFor(`!!document.querySelector('[data-action="run"]')`, 5000, `level ${i} view`);
      const title = await js(`document.querySelector('.mission-head h2').textContent`);
      await click('[data-action="run"]');
      await sleep(400);
      await waitFor(`!document.querySelector('[data-action="run"]').disabled && document.querySelectorAll('.checks .check').length > 0`, 600000, title);
      await sleep(i === 10 ? 300 : 2600); // let the result animation finish
      const bad = await js(`[...document.querySelectorAll('.checks .check.bad')].map(c => c.textContent).join(' | ')`);
      const good = await js(`document.querySelectorAll('.checks .check.ok').length`);
      console.log(`${bad ? 'FAIL' : 'PASS'}  level ${i} ${title.padEnd(30)} ${good} checks green${bad ? `; red: ${bad}` : ''}`);
      if (shots[i]) await shoot(shots[i]);
      if (bad) throw new Error(`level ${i} failed: ${bad}`);
    }

    const feed = await js(`document.querySelectorAll('#feed li:not(.log)').length`);
    const xp = await js(`document.querySelector('#xptext').textContent + ' · ' + document.querySelector('#rank').textContent`);
    console.log(`packet feed shows ${feed} packets; progress ${xp}`);
    if (!feed) throw new Error('no packets in the live feed');
    await click(`.lvl-node[data-level="5"]`);
    await sleep(600);
    await shoot('playground.png');
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
