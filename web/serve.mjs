#!/usr/bin/env node
/**
 * Serves dist-web/ on http://127.0.0.1:8090 (static files only, like GitHub
 * Pages). Usage: node web/serve.mjs [dir] [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.resolve(ROOT, process.argv[2] ?? 'dist-web');
const PORT = Number(process.argv[3] ?? process.env.PORT ?? 8090);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    let file = path.join(DIR, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIR)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`serving ${path.relative(ROOT, DIR)}/ on http://127.0.0.1:${PORT}/`));
