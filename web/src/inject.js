// esbuild "inject": gives Node-style globals to dependencies that expect them.
import { Buffer } from 'buffer';

export { Buffer };
export const process = globalThis.process ?? {
  env: { NODE_ENV: 'production' },
  browser: true,
  version: '',
  versions: {},
  platform: 'browser',
  cwd: () => '/',
  nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
};
