#!/usr/bin/env node
/**
 * Builds the static site (no server): the product page (site/) at the root,
 * and X1 Quest under play/: the X1 firmware compiled to WebAssembly + the
 * Cypherock SDK bundled for the browser + the game.
 *
 *   node web/build.mjs            -> dist-web/  (serve it with any static host)
 *
 *   dist-web/index.html           product page (site/)
 *   dist-web/play/index.html      X1 Quest (playground/public + web/src)
 *   dist-web/play/x1/             the firmware (.js + .wasm)
 *
 * Env:
 *   SDK_DIR        Cypherock SDK checkout with packages built (default ../sdk)
 *   FIRMWARE_WASM  folder holding Cypherock_Simulator.js/.wasm, built with
 *                  `emcmake cmake ... && cmake --build` (default ../x1_wallet_firmware/bin)
 *   OUT_DIR        output folder (default dist-web)
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK_DIR = path.resolve(ROOT, process.env.SDK_DIR ?? '../sdk');
const FIRMWARE_WASM = path.resolve(ROOT, process.env.FIRMWARE_WASM ?? '../x1_wallet_firmware/bin');
const OUT = path.resolve(ROOT, process.env.OUT_DIR ?? 'dist-web');
const PUBLIC = path.join(ROOT, 'playground', 'public');
const SITE = path.join(ROOT, 'site');
const PLAY = path.join(OUT, 'play');

const need = (file, hint) => {
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}\n  ${hint}`);
    process.exit(1);
  }
};
need(path.join(FIRMWARE_WASM, 'Cypherock_Simulator.wasm'), 'build the firmware with Emscripten (see docs/deploy.md)');
need(path.join(SDK_DIR, 'packages', 'app-evm', 'dist', 'index.js'), 'build the SDK packages (see docs/deploy.md)');

// Node built-ins: browser versions where a dependency needs one at load time,
// an empty module where it is only used by code paths we never call.
const require_ = createRequire(path.join(ROOT, 'package.json'));
const POLYFILLS = {
  crypto: require_.resolve('crypto-browserify'),
  stream: require_.resolve('stream-browserify'),
  events: require_.resolve('events/'),
  util: require_.resolve('util/'),
  buffer: require_.resolve('buffer/'),
};
const polyfillRe = new RegExp(`^(node:)?(${Object.keys(POLYFILLS).join('|')})$`);
const EMPTY_BUILTINS = ['fs', 'path', 'os', 'net', 'tls', 'http', 'https', 'zlib', 'child_process', 'worker_threads', 'module', 'url', 'http2', 'dns', 'vm', 'readline'];
const builtinRe = new RegExp(`^(node:)?(${EMPTY_BUILTINS.join('|')})$`);

/** "@sdk/<folder>" -> SDK package; "@sdklib/<folder>/<name>" -> that package's dependency. */
const sdkPlugin = {
  name: 'cypherock-sdk',
  setup(b) {
    b.onResolve({ filter: /^@sdk\// }, (args) => ({
      path: path.join(SDK_DIR, 'packages', args.path.slice('@sdk/'.length), 'dist', 'index.js'),
    }));
    b.onResolve({ filter: /^@sdklib\// }, async (args) => {
      const rest = args.path.slice('@sdklib/'.length);
      const slash = rest.indexOf('/');
      const folder = rest.slice(0, slash);
      const name = rest.slice(slash + 1);
      const r = await b.resolve(name, { resolveDir: path.join(SDK_DIR, 'packages', folder), kind: 'dynamic-import' });
      if (r.errors.length) return { errors: r.errors };
      return { path: r.path };
    });
    b.onResolve({ filter: polyfillRe }, (args) => ({ path: POLYFILLS[args.path.replace(/^node:/, '')] }));
    b.onResolve({ filter: builtinRe }, (args) => ({ path: args.path, namespace: 'empty-builtin' }));
    b.onLoad({ filter: /.*/, namespace: 'empty-builtin' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  },
};

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(PLAY, 'x1'), { recursive: true });

const result = await build({
  entryPoints: { main: path.join(ROOT, 'web', 'src', 'main.ts') },
  outdir: path.join(PLAY, 'assets'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: process.env.MINIFY !== '0',
  legalComments: 'none',
  chunkNames: 'chunk-[hash]',
  inject: [path.join(ROOT, 'web', 'src', 'inject.js')],
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  plugins: [sdkPlugin],
  metafile: true,
  logLevel: 'warning',
});

// The game, with paths made relative so it works under any sub-path (GitHub Pages).
for (const f of ['game.js', 'game.css', 'favicon.svg']) fs.copyFileSync(path.join(PUBLIC, f), path.join(PLAY, f));
fs.cpSync(path.join(PUBLIC, 'fonts'), path.join(PLAY, 'fonts'), { recursive: true });
let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
html = html
  .replace('href="/game.css"', 'href="game.css"')
  .replace('href="/favicon.svg"', 'href="favicon.svg"')
  .replaceAll('href="/fonts/', 'href="fonts/')
  .replace(/\s*<a href="\/classic\.html">[^<]*<\/a>/, '') // the classic page needs the Node server
  .replace('<script src="/game.js"></script>', '<script type="module" src="assets/main.js"></script>\n  <script defer src="game.js"></script>');
if (!html.includes('assets/main.js')) throw new Error('index.html: game.js script tag not found');
if (/(href|src)="\/(?!\/)/.test(html)) throw new Error('index.html: an absolute path is left; it would break under a sub-path');
fs.writeFileSync(path.join(PLAY, 'index.html'), html);

// The firmware.
for (const f of ['Cypherock_Simulator.js', 'Cypherock_Simulator.wasm']) {
  fs.copyFileSync(path.join(FIRMWARE_WASM, f), path.join(PLAY, 'x1', f));
}

// The product page at the root; it shares the game's fonts (play/fonts/).
fs.cpSync(SITE, OUT, { recursive: true });
fs.copyFileSync(path.join(PUBLIC, 'favicon.svg'), path.join(OUT, 'favicon.svg'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const files = Object.entries(result.metafile.outputs).map(([f, o]) => [path.relative(OUT, f).replaceAll('\\', '/'), o.bytes]);
files.sort((a, b) => b[1] - a[1]);
console.log(`built ${path.relative(ROOT, OUT)}/`);
for (const [f, bytes] of files.slice(0, 8)) console.log(`  ${f.padEnd(34)} ${kb(bytes)}`);
console.log(`  ${files.length} JS files, ${kb(files.reduce((s, [, b]) => s + b, 0))} total`);
console.log(`  play/x1/Cypherock_Simulator.wasm   ${kb(fs.statSync(path.join(PLAY, 'x1', 'Cypherock_Simulator.wasm')).size)}`);
console.log('  index.html (product page), play/index.html (X1 Quest)');
