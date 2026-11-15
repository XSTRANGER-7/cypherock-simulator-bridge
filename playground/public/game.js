// X1 Quest: a guided, game-style playground. Every level runs a REAL Cypherock
// SDK call against the REAL X1 firmware simulator through the playground server.
// No framework, no build step; works under a strict Content-Security-Policy.
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const short = (s, n = 10) => (s && s.length > n * 2 + 3 ? `${s.slice(0, n + 2)}…${s.slice(-n)}` : s || '');

const EVM = { 1: 'Ethereum', 137: 'Polygon', 56: 'BNB Chain', 250: 'Fantom', 43114: 'Avalanche', 10: 'Optimism', 42161: 'Arbitrum', 8453: 'Base', 999: 'Hyperliquid' };
const BTC = [
  { id: 'btc', sym: '₿', name: 'Bitcoin', note: "m/44'/0'/0' legacy" },
  { id: 'btc-segwit', sym: '₿', name: 'Bitcoin SegWit', note: "m/84'/0'/0' native segwit" },
  { id: 'ltc', sym: 'Ł', name: 'Litecoin', note: "coin type 2'" },
  { id: 'doge', sym: 'Ð', name: 'Dogecoin', note: "coin type 3'" },
  { id: 'dash', sym: 'D', name: 'Dash', note: "coin type 5'" },
];
const COINS = [
  { id: 'solana', sym: 'S', name: 'Solana' }, { id: 'near', sym: 'N', name: 'NEAR' }, { id: 'tron', sym: 'T', name: 'Tron' },
  { id: 'xrp', sym: 'X', name: 'XRP' }, { id: 'starknet', sym: 'SN', name: 'Starknet' }, { id: 'icp', sym: '∞', name: 'ICP' },
  { id: 'stellar', sym: '✦', name: 'Stellar' }, { id: 'constellation', sym: 'DAG', name: 'Constellation' },
  { id: 'sia', sym: 'SC', name: 'Sia' }, { id: 'canton', sym: 'C', name: 'Canton' },
];
const RANKS = [[0, 'Rookie'], [150, 'Packet Pilot'], [450, 'Key Keeper'], [800, 'Signer'], [1200, 'Chain Hopper'], [1850, 'X1 Master']];
const PACKET_COLORS = {
  STATUS_REQ: '#5b8cff', STATUS: '#5b8cff', CMD: '#ffbe55', CMD_ACK: '#3ddc97', CMD_OUTPUT_REQ: '#9b7bff',
  CMD_OUTPUT: '#c77dff', ERROR: '#ff6b7a', ABORT: '#ff6b7a', LEGACY: '#93a0bd',
};

// ------------------------------------------------------------------ state
const STORE_KEY = 'x1quest.v1';
const state = loadState();
let current = 0;
let running = false;
let simRunning = false;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { done: s.done || [], xp: s.xp || 0, unlockAll: !!s.unlockAll, btc: s.btc || [], coins: s.coins || [], last: s.last || 0 };
  } catch {
    return { done: [], xp: 0, unlockAll: false, btc: [], coins: [], last: 0 };
  }
}
function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* private mode: progress lives only in this tab */
  }
}

// ------------------------------------------------------------------ API
async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
const op = (name, params = {}) => api(`/api/run/${name}`, params).then((r) => r.result);

// ------------------------------------------------------------------ levels
// Each level: what you do, why, where it is used for real, the live steps (driven
// by real packets), the real call, the real checks, and an animated result.
const LEVELS = [
  {
    id: 'power', icon: '⏻', title: 'Power On', xp: 50,
    goal: 'Boot the X1 firmware on your computer and open the bridge.',
    why: 'The simulator is the real X1 firmware compiled for a PC. Our bridge replaces the USB cable with a local socket (127.0.0.1:52640), so the SDK can reach it.',
    use: 'Developers and CI can test wallet apps against real firmware code without plugging in a device.',
    hood: 'The playground starts bin/Cypherock_Simulator. During application_init() the firmware opens the TCP bridge; then it shows the boot logo (busy) and lands on the main menu (idle). We poll STATUS packets until device_idle_state becomes IDLE five times in a row.',
    steps: ['Start the firmware process', 'Bridge socket opens on :52640', 'Firmware boots (logo)', 'Main menu: idle and ready'],
    action: 'Power on the simulator',
    async run(ctx) {
      ctx.step(0);
      const r = await api('/api/sim/start', {});
      ctx.step(3);
      await refreshState(); // the bridge check below reads the real, fresh state
      return { message: r.message };
    },
    checks: (r) => [
      { ok: true, label: 'Simulator process is running', detail: r.message },
      { ok: simRunning, label: 'Bridge reachable on 127.0.0.1:52640' },
    ],
    reveal(r, box) {
      const p = panel(box, 'Boot sequence');
      const rows = [['Comm layer', 'device_idle_state = NULL', 'USB/bridge code is up before anything else'], ['Boot logo', 'device_idle_state = DEVICE', 'the firmware is busy: SDK calls would be rejected'], ['Main menu', 'device_idle_state = IDLE', 'ready for commands']];
      const list = el('div', 'pipeline');
      rows.forEach(([t, s, d], i) => {
        const st = el('div', 'stage');
        st.append(el('h5', '', t), el('p', '', s), el('p', 'muted', d));
        list.append(st);
        later(i * 350, () => st.classList.add('lit'));
      });
      p.append(list);
      p.append(el('p', 'muted', r.message));
    },
  },
  {
    id: 'contact', icon: '⇄', title: 'First Contact', xp: 100,
    goal: 'Send ONE raw 64-byte packet to the firmware, with no SDK at all, and read its answer.',
    why: 'Everything the SDK does is made of these packets. Seeing one byte by byte shows exactly what travels over USB (and now over our bridge).',
    use: 'cySync and the SDK send this STATUS request all the time to ask "are you busy?" before and during every operation.',
    hood: 'Packet = 16-byte header (55 55 start, CRC-16/XMODEM, chunk, total, sequence, type, timestamp, length) + up to 48 bytes of payload, zero-padded to 64. The firmware parser (comm_packet_parser) checks the CRC and answers with type 4 (STATUS) carrying a core.Status protobuf.',
    steps: ['Build a STATUS_REQ packet', 'Send it over the bridge', 'Firmware parser answers', 'Decode the reply'],
    action: 'Send the packet',
    async run(ctx) {
      ctx.step(1);
      const r = await op('raw-status');
      ctx.step(3);
      return r;
    },
    checks: (r) => [
      { ok: r.replyHex?.startsWith('5555'), label: 'Reply starts with 55 55 (valid frame)', detail: r.replyHex?.slice(0, 32) },
      { ok: r.replyHex?.slice(20, 22) === '04', label: 'Packet type is 04 = STATUS', detail: r.reply },
      { ok: !/BAD-CRC/.test(r.reply || ''), label: 'CRC-16 of the reply is correct' },
      { ok: r.idle === 'IDLE', label: 'Firmware says it is IDLE', detail: `device_idle_state = ${r.idle}` },
    ],
    reveal(r, box) {
      anatomy(box, 'Your request (16 bytes + zero padding)', r.requestHex);
      anatomy(box, 'Firmware reply', r.replyHex);
      const p = panel(box, 'What the firmware said (core.Status)');
      const names = { 1: 'device_waiting_on', 2: 'device_idle_state', 3: 'abort_disabled', 4: 'current_cmd_seq', 5: 'cmd_state', 6: 'flow_status' };
      const dl = el('dl', 'kv');
      Object.entries(r.status || {}).forEach(([k, v]) => dl.append(el('dt', '', names[k] || `field ${k}`), el('dd', '', k === '2' ? `${v} (${['NULL', 'IDLE', 'USB', 'DEVICE'][v] || '?'})` : String(v))));
      p.append(dl);
    },
  },
  {
    id: 'handshake', icon: '🤝', title: 'Handshake', xp: 100,
    goal: 'Let the real SDK introduce itself and ask the firmware who it is.',
    why: 'Before any command, the SDK asks which protocol the device speaks. Then ManagerApp.getDeviceInfo() is answered by the firmware\'s own code (apps/manager_app/get_device_info.c).',
    use: 'Wallet apps call this first to show the device, check it is genuine and onboarded, and decide whether a firmware update is needed.',
    hood: 'Handshake = a legacy v1 packet with command 88; the firmware replies "SDK 3.0.0", so sdk-core switches to packet version v3. Then the command goes out as CMD chunks, each answered by CMD_ACK; the SDK polls STATUS until the result is ready and fetches it with CMD_OUTPUT_REQ.',
    steps: ['Protocol handshake (command 88)', 'Send the getDeviceInfo command', 'Firmware works on it', 'Result comes back'],
    action: 'Say hello',
    async run(ctx) {
      ctx.step(0);
      const r = await op('device-info');
      ctx.step(3);
      return r;
    },
    checks: (r) => [
      { ok: r.sdkVersion === '3.0.0', label: 'Firmware speaks SDK protocol 3.0.0', detail: r.sdkVersion },
      { ok: typeof r.deviceSerial === 'string' && r.deviceSerial.length === 64, label: 'Device serial is 32 bytes', detail: r.deviceSerial },
      { ok: typeof r.isAuthenticated === 'boolean', label: 'Authentication state reported', detail: String(r.isAuthenticated) },
      { ok: typeof r.onboardingStep === 'number', label: 'Onboarding step reported', detail: String(r.onboardingStep) },
    ],
    reveal(r, box) {
      const p = panel(box, 'The firmware introduced itself');
      const dl = el('dl', 'kv');
      [['Protocol', `SDK ${r.sdkVersion} → packet v3`], ['Serial', short(r.deviceSerial, 12)], ['Authenticated', String(r.isAuthenticated)], ['Onboarding step', `${r.onboardingStep} (onboarding complete)`], ['Variant', r.firmwareVariantInfo?.variantStr || '?'], ['Firmware version', r.firmwareVersion ? `${r.firmwareVersion.major}.${r.firmwareVersion.minor}.${r.firmwareVersion.patch}` : 'not reported (no bootloader in the simulator writes it)']]
        .forEach(([k, v], i) => {
          const dt = el('dt', 'fade', k);
          const dd = el('dd', 'fade', v);
          dt.style.setProperty('animation-delay', `${i * 90}ms`);
          dd.style.setProperty('animation-delay', `${i * 90}ms`);
          dl.append(dt, dd);
        });
      p.append(dl);
    },
  },
  {
    id: 'vault', icon: '🗄', title: 'The Vault', xp: 100,
    goal: 'Ask the firmware which wallets are stored inside it.',
    why: 'Wallets live in the device\'s flash. The SDK only ever sees their names, ids and flags, never the keys.',
    use: 'Apps list wallets so the user can choose one before showing balances or signing.',
    hood: 'manager_export_wallets() fills name, 32-byte id, hasPin, hasPassphrase and isValid. Our SIMTEST wallet comes from a PUBLISHED test mnemonic because the simulator\'s card emulation cannot rebuild seeds from X1 cards. Never use a real seed here.',
    steps: ['Open the manager app', 'Send getWallets', 'Firmware reads its flash', 'Wallet list arrives'],
    action: 'Open the vault',
    async run(ctx) {
      ctx.step(0);
      const r = await op('wallets');
      ctx.step(3);
      return r;
    },
    checks: (r) => {
      const w = (r.walletList || []).find((x) => x.name === 'SIMTEST');
      return [
        { ok: Array.isArray(r.walletList), label: 'Firmware returned a wallet list', detail: `${(r.walletList || []).length} wallet(s)` },
        { ok: !!w, label: 'Test wallet SIMTEST is present' },
        { ok: !!w && w.id.length === 64, label: 'Wallet id is 32 bytes', detail: w && w.id },
        { ok: !!w && w.isValid === true, label: 'Wallet is valid (all card shares present)' },
      ];
    },
    reveal(r, box) {
      const p = panel(box, 'Wallets inside the device');
      const grid = el('div', 'collect');
      (r.walletList || []).forEach((w, i) => {
        const c = el('div', 'coin got pop');
        c.style.setProperty('animation-delay', `${i * 120}ms`);
        c.append(el('div', 'sym', '🔐'), el('div', 'nm', w.name), el('div', 'vl', `id ${short(w.id, 6)}`), el('div', 'vl', `pin: ${w.hasPin} · passphrase: ${w.hasPassphrase} · valid: ${w.isValid}`));
        grid.append(c);
      });
      p.append(grid);
    },
  },
  {
    id: 'address', icon: '⌖', title: 'Find Your Address', xp: 150,
    goal: 'Make the firmware derive an Ethereum-family address, then prove it is right.',
    why: 'The private key is computed INSIDE the device from the wallet seed along a derivation path. We re-derive the same address in the browser\'s server with ethers from the test mnemonic: if they match, the firmware math is correct.',
    use: 'This is the "Receive" screen of every wallet: the app asks the device for an address to show the user.',
    hood: 'EvmApp.getPublicKeys() → apps/evm_family/evm_pub_key.c. The firmware asks for consent (auto-confirmed in this dev build), rebuilds the seed, walks the BIP-44 path and returns the public key; the SDK turns it into a checksummed address.',
    steps: ['Choose chain and index', 'Firmware asks for consent (auto)', 'Seed → key along the path', 'Compare with ethers'],
    controls(c) {
      c.append(select('Chain', 'q-chain', Object.entries(EVM).map(([id, n]) => [id, `${n} (${id})`])), number('Address index', 'q-index', 0, 0, 20));
    },
    action: 'Derive the address',
    async run(ctx) {
      ctx.step(1);
      const r = await op('eth-address', { chainId: Number($('#q-chain').value), index: Number($('#q-index').value) });
      ctx.step(3);
      return r;
    },
    checks: (r) => [
      { ok: /^0x[0-9a-fA-F]{40}$/.test(r.address || ''), label: 'Firmware returned a valid address', detail: r.address },
      { ok: r.verified === true, label: 'ethers derives the same address from the mnemonic', detail: r.expectedFromMnemonic },
    ],
    reveal(r, box) {
      const p = panel(box, 'Derivation path');
      const idx = r.derivation.split('/').pop();
      const segs = [['m', 'root'], ["44'", 'purpose: BIP-44'], ["60'", 'coin: Ethereum'], ["0'", 'account'], ['0', 'external chain'], [idx, 'address index']];
      const path = el('div', 'path');
      segs.forEach(([b, s], i) => {
        if (i) path.append(el('span', 'arrow', '→'));
        const seg = el('div', 'seg');
        seg.append(el('b', '', b), el('small', '', s));
        path.append(seg);
        later(200 + i * 220, () => seg.classList.add('lit'));
      });
      p.append(path);
      verdict(box, r.verified, `Firmware: ${r.address}`, `ethers:   ${r.expectedFromMnemonic}`, 1700, `${EVM[r.chainId] || r.chainId} · same key works on every EVM chain`);
    },
  },
  {
    id: 'sign', icon: '✍', title: 'Sign It', xp: 200,
    goal: 'Build a real EIP-1559 transaction and let the firmware sign it.',
    why: 'Signing is what a hardware wallet exists for: the private key never leaves the device, only the signature does. Anyone can recover the signer\'s address from the signature, so we can check it.',
    use: 'Sending ETH, swapping, minting: every on-chain action ends with this call.',
    hood: 'EvmApp.signTxn() → evm_sign_txn.c parses the RLP transaction, checks the chain id against the app (Ethereum app only signs chain id 1, Polygon app 137, ...), shows it on screen (auto-confirmed in dev builds) and returns r, s, v. This test key is public: never broadcast.',
    steps: ['Build the unsigned transaction', 'Firmware parses and shows it', 'Firmware signs (r, s, v)', 'Recover the signer'],
    controls(c) {
      c.append(select('Chain', 'q-chain', Object.entries(EVM).map(([id, n]) => [id, `${n} (${id})`])), text('Send to', 'q-to', '0x000000000000000000000000000000000000dEaD'), text('Value (ETH)', 'q-val', '0.001'));
    },
    action: 'Sign the transaction',
    async run(ctx) {
      ctx.step(1);
      const r = await op('sign-tx', { chainId: Number($('#q-chain').value), to: $('#q-to').value.trim(), valueEth: $('#q-val').value.trim() });
      ctx.step(3);
      return r;
    },
    checks: (r) => [
      { ok: /^0x[0-9a-f]{64}$/i.test(r.signature?.r || ''), label: 'Signature has a 32-byte r', detail: r.signature?.r },
      { ok: /^0x[0-9a-f]{64}$/i.test(r.signature?.s || ''), label: 'Signature has a 32-byte s', detail: r.signature?.s },
      { ok: r.verified === true, label: 'Recovered signer = the wallet\'s address', detail: r.recoveredSigner },
    ],
    reveal(r, box) {
      const p = panel(box, 'Signing pipeline');
      const pipe = el('div', 'pipeline');
      [['Unsigned tx', short(r.unsigned, 14)], ['On device', `chain ${r.chainId} · shown and confirmed`], ['Signature', `r ${short(r.signature.r, 6)} s ${short(r.signature.s, 6)} v ${r.signature.v}`], ['Signer', short(r.recoveredSigner, 8)]]
        .forEach(([h, t], i) => {
          const st = el('div', 'stage');
          st.append(el('h5', '', h), el('p', '', t));
          pipe.append(st);
          later(250 + i * 450, () => st.classList.add('lit'));
        });
      p.append(pipe);
      verdict(box, r.verified, `Recovered signer: ${r.recoveredSigner}`, 'equals the SIMTEST address from the firmware', 2200, 'Signed transaction (never broadcast: test key)');
    },
  },
  {
    id: 'message', icon: '💬', title: 'Prove It\'s You', xp: 150,
    goal: 'Sign a human-readable message (EIP-191 personal_sign).',
    why: 'Signing a message proves you own an address without sending a transaction or paying gas.',
    use: '"Sign-In with Ethereum", proving ownership to an exchange, signing terms of service in a dApp.',
    hood: 'EvmApp.signPersonalMsg() → evm_sign_msg.c shows the text on the device and signs keccak256("\\x19Ethereum Signed Message:\\n" + length + message). ethers.verifyMessage recovers the address from the signature.',
    steps: ['Type a message', 'Firmware shows the text', 'Firmware signs it', 'Recover the address'],
    controls(c) {
      c.append(text('Message', 'q-msg', 'I own this address. Signed on the X1 simulator.'));
    },
    action: 'Sign the message',
    async run(ctx) {
      ctx.step(1);
      const r = await op('sign-message', { text: $('#q-msg').value });
      ctx.step(3);
      return r;
    },
    checks: (r) => [
      { ok: /^0x[0-9a-f]{130}$/i.test(r.signature || ''), label: '65-byte signature', detail: short(r.signature, 16) },
      { ok: r.verified === true, label: 'ethers.verifyMessage recovers the wallet\'s address', detail: r.recoveredSigner },
    ],
    reveal(r, box) {
      const p = panel(box, 'Message → signature');
      const dl = el('dl', 'kv');
      dl.append(el('dt', '', 'Message'), el('dd', '', r.text), el('dt', '', 'Signature'), el('dd', '', short(r.signature, 18)));
      p.append(dl);
      verdict(box, r.verified, `Recovered: ${r.recoveredSigner}`, 'the message was signed by the SIMTEST key', 600);
    },
  },
  {
    id: 'typed', icon: '🧾', title: 'Typed Data', xp: 150,
    goal: 'Sign structured data (EIP-712), the format behind modern dApp approvals.',
    why: 'EIP-712 lets the device show real fields (from, to, contents) instead of an unreadable hash, so users know what they approve.',
    use: 'Token permits (gasless approvals), DEX limit orders, NFT marketplace listings.',
    hood: 'EvmApp.signTypedMsg() sends the domain, types and message; the firmware shows the fields and signs the EIP-712 hash. ethers.verifyTypedData recomputes the hash and recovers the signer.',
    steps: ['Send domain, types, message', 'Firmware shows the fields', 'Firmware signs the EIP-712 hash', 'Recover the address'],
    action: 'Sign the typed data',
    async run(ctx) {
      ctx.step(1);
      const r = await op('sign-typed-data');
      ctx.step(3);
      return r;
    },
    checks: (r) => [
      { ok: r.typedData?.primaryType === 'Mail', label: 'Typed data has primary type Mail' },
      { ok: r.verified === true, label: 'ethers.verifyTypedData recovers the wallet\'s address', detail: r.recoveredSigner },
    ],
    reveal(r, box) {
      const p = panel(box, 'What the device showed');
      const dl = el('dl', 'kv');
      const m = r.typedData?.message || {};
      [['Domain', `${r.typedData?.domain?.name} v${r.typedData?.domain?.version} · chain ${r.typedData?.domain?.chainId}`], ['From', `${m.from?.name} ${short(m.from?.wallet, 6)}`], ['To', `${m.to?.name} ${short(m.to?.wallet, 6)}`], ['Contents', m.contents]]
        .forEach(([k, v]) => dl.append(el('dt', '', k), el('dd', '', v)));
      p.append(dl);
      verdict(box, r.verified, `Recovered: ${r.recoveredSigner}`, 'EIP-712 signature checks out', 500);
    },
  },
  {
    id: 'bitcoin', icon: '₿', title: 'Bitcoin Family', xp: 200, collect: 'btc',
    goal: 'Collect the extended public key (xpub) of 5 Bitcoin-family coins.',
    why: 'An xpub lets wallet software generate every receive address of an account without the device. Each coin has its own BIP-44 coin type; SegWit uses purpose 84\'.',
    use: 'Watch-only wallets and portfolio trackers import xpubs to show balances.',
    hood: 'BtcApp.getXpubs() → apps/btc_family/btc_xpub.c. We check the Bitcoin xpub against ethers\' derivation of m/44\'/0\'/0\' from the same mnemonic.',
    steps: ['Pick a coin (or collect all)', 'Firmware derives the account key', 'xpub returned', 'Collect all 5 to finish'],
    action: 'Collect all',
    items: BTC,
    async runOne(item) {
      return op('btc-xpub', { coin: item.id });
    },
    value: (r) => r.xpub,
    checks: () => [{ ok: state.btc.length === BTC.length, label: `Collected ${state.btc.length}/${BTC.length} xpubs` }],
  },
  {
    id: 'chains', icon: '🌐', title: 'Many Chains', xp: 250, collect: 'coins',
    goal: 'Collect public keys from 10 more coin apps inside the firmware.',
    why: 'Each coin is its own app in the firmware, with its own derivation rules that the firmware checks (NEAR is all-hardened 44\'/397\'/0\'/0\'/i\', Starknet uses its own 6-level path...). All of them work through the same bridge.',
    use: 'A multi-coin wallet app talks to all of these apps on one device.',
    hood: 'Solana, NEAR, Tron, XRP, Starknet, ICP, Stellar, Constellation, Sia and Canton apps each run their getPublicKeys flow; the SDK app packages format addresses (some need a helper library such as tronweb or xrpl).',
    steps: ['Pick a coin (or collect all)', 'Firmware checks the path', 'Key returned', 'Collect all 10 to finish'],
    action: 'Collect all',
    items: COINS,
    async runOne(item) {
      return op('coin-key', { coin: item.id });
    },
    value: (r) => (r.addresses || r.partyIds || r.publicKeys || [])[0],
    checks: () => [{ ok: state.coins.length === COINS.length, label: `Collected ${state.coins.length}/${COINS.length} coin keys` }],
  },
  {
    id: 'boss', icon: '👑', title: 'Final Boss: System Check', xp: 400, boss: true,
    goal: 'Run every check in one go, like CI does on every push. Keep the system health at 100%.',
    why: 'One run proves the whole stack still works: bridge, packets, every app, every verification.',
    use: 'Cypherock could run exactly this on every firmware or SDK change, without hardware.',
    hood: 'The same checks run in GitHub Actions (tools/capabilities.ts and tools/playground-smoke.ts) on Ubuntu, against upstream firmware and SDK with the bridge patches.',
    steps: ['Device checks', 'EVM chains and signing', 'Bitcoin family', 'All other coins'],
    action: 'Fight the boss',
  },
];

// ------------------------------------------------------------------ UI helpers
function later(ms, fn) {
  if (REDUCED) fn();
  else setTimeout(fn, ms);
}
function panel(box, title) {
  const p = el('div', 'panel fade');
  p.append(el('h4', '', title));
  box.append(p);
  return p;
}
function labelWrap(label, input) {
  const l = el('label', '', label);
  l.append(input);
  return l;
}
function select(label, id, options) {
  const s = el('select');
  s.id = id;
  options.forEach(([v, t]) => s.add(new Option(t, v)));
  return labelWrap(label, s);
}
function text(label, id, value) {
  const i = el('input');
  i.id = id;
  i.value = value;
  i.spellcheck = false;
  return labelWrap(label, i);
}
function number(label, id, value, min, max) {
  const i = el('input');
  i.id = id;
  i.type = 'number';
  i.value = value;
  i.min = min;
  i.max = max;
  return labelWrap(label, i);
}
function anatomy(box, title, hex) {
  const p = panel(box, title);
  const fields = [[0, 2, 'start', 0], [2, 4, 'crc-16', 1], [4, 6, 'chunk', 2], [6, 8, 'total', 2], [8, 10, 'sequence', 2], [10, 11, 'type', 3], [11, 15, 'timestamp', 2], [15, 16, 'length', 3], [16, 64, 'payload', 4]];
  const wrap = el('div', 'bytes');
  const bytes = (hex || '').match(/../g) || [];
  fields.forEach(([a, b, name, c], i) => {
    const part = bytes.slice(a, b);
    if (!part.length) return;
    const f = el('div', `field c${c} pop`);
    f.style.setProperty('animation-delay', `${i * 110}ms`);
    f.append(el('div', 'hx', part.join(' ')), el('div', 'lb', name));
    wrap.append(f);
  });
  p.append(wrap);
}
function verdict(box, ok, line1, line2, delay, caption) {
  const v = el('div', `verdict ${ok ? 'ok' : 'bad'}`);
  const big = el('span', 'big', ok ? '✅' : '❌');
  const body = el('div');
  body.append(el('div', 'mono', line1), el('div', 'mono muted', line2));
  if (caption) body.append(el('div', 'muted', caption));
  v.append(big, body);
  v.classList.add('hidden-until');
  v.style.setProperty('opacity', '0');
  box.append(v);
  later(delay || 0, () => {
    v.style.removeProperty('opacity');
    v.classList.add('pop');
  });
}
function toast(html, kind) {
  const t = el('div', `toast ${kind || ''}`);
  t.append(...html);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

// ------------------------------------------------------------------ map + progress
function isDone(i) {
  return state.done.includes(LEVELS[i].id);
}
function isOpen(i) {
  return state.unlockAll || i === 0 || isDone(i) || isDone(i - 1);
}
function renderMap() {
  const map = $('#map');
  map.textContent = '';
  LEVELS.forEach((lv, i) => {
    const b = el('button', 'lvl-node');
    b.dataset.level = i;
    const open = isOpen(i);
    b.classList.add(isDone(i) ? 'done' : open ? 'available' : 'locked');
    if (i === current) b.classList.add('current');
    if (lv.boss) b.classList.add('boss');
    const orb = el('span', 'orb', isDone(i) ? '✓' : open ? lv.icon : '🔒');
    const txt = el('span');
    txt.append(el('div', 't', `${i}. ${lv.title}`), el('div', 's', `+${lv.xp} XP`));
    b.append(orb, txt);
    b.addEventListener('click', () => {
      if (running) return;
      if (!open) {
        toast([document.createTextNode(`Finish "${LEVELS[i - 1].title}" first to unlock this level.`)]);
        return;
      }
      openLevel(i);
    });
    map.append(b);
  });
}
function renderProgress() {
  const max = LEVELS.reduce((s, l) => s + l.xp, 0);
  $('#xpfill').style.setProperty('width', `${Math.min(100, (state.xp / max) * 100)}%`);
  $('#xptext').textContent = `${state.xp} / ${max} XP`;
  $('#rank').textContent = RANKS.filter(([x]) => state.xp >= x).pop()[1];
  $('#badge-count').textContent = `${state.done.length}/${LEVELS.length}`;
}
function complete(i) {
  const lv = LEVELS[i];
  if (state.done.includes(lv.id)) return false;
  state.done.push(lv.id);
  state.xp += lv.xp;
  saveState();
  renderProgress();
  renderMap();
  confetti();
  const b = el('b', '', `+${lv.xp} XP`);
  toast([document.createTextNode(`Level complete: ${lv.title} `), b, document.createTextNode(` · ${$('#rank').textContent}`)], 'win');
  return true;
}

// ------------------------------------------------------------------ mission view
function openLevel(i) {
  current = i;
  state.last = i;
  saveState();
  renderMap();
  const lv = LEVELS[i];
  const m = $('#mission');
  m.textContent = '';
  const card = el('div', 'mission-card');
  const head = el('div', 'mission-head');
  head.append(el('span', 'lvl', lv.boss ? 'Final level' : `Level ${i}`), el('h2', '', `${lv.icon} ${lv.title}`), el('span', 'reward', isDone(i) ? 'Completed ✓' : `+${lv.xp} XP`));
  card.append(head, el('p', 'goal', lv.goal));

  const info = el('div', 'info-grid');
  const why = el('div', 'info why');
  why.append(el('h4', '', 'Why it matters'), el('p', '', lv.why));
  const use = el('div', 'info use');
  use.append(el('h4', '', 'Real-world use'), el('p', '', lv.use));
  info.append(why, use);
  card.append(info);

  const steps = el('ol', 'steps');
  lv.steps.forEach((s) => {
    const li = el('li');
    li.append(el('span', 'ic', ''), el('span', '', s));
    steps.append(li);
  });
  card.append(steps);

  const controls = el('div', 'controls');
  if (lv.controls) lv.controls(controls);
  card.append(controls);

  const actions = el('div', 'actions');
  const go = el('button', 'go', `▶ ${lv.action}`);
  go.dataset.action = 'run';
  const timer = el('span', 'timer', '');
  actions.append(go, timer);
  card.append(actions);

  const reveal = el('div', 'reveal');
  const checks = el('div', 'checks');
  const hood = el('details', 'hood');
  hood.append(el('summary', '', 'Under the hood'), el('p', '', lv.hood));
  const raw = el('pre', '', 'Run the level to see the raw result.');
  hood.append(raw);
  card.append(reveal, checks, hood);

  const nextRow = el('div', 'next-row');
  const hint = el('span', 'muted', i < LEVELS.length - 1 ? `Next: ${LEVELS[i + 1].title}` : 'This is the last level.');
  const next = el('button', 'next', i < LEVELS.length - 1 ? `Next mission → ${LEVELS[i + 1].title}` : 'Play again from the start');
  next.dataset.action = 'next';
  next.hidden = !isDone(i);
  next.addEventListener('click', () => openLevel(i < LEVELS.length - 1 ? i + 1 : 0));
  nextRow.append(hint, next);
  card.append(nextRow);
  m.append(card);

  const ui = { steps, go, timer, reveal, checks, raw, next };
  if (lv.collect) setupCollect(lv, i, ui);
  if (lv.boss) go.addEventListener('click', () => runBoss(i, ui));
  else if (!lv.collect) go.addEventListener('click', () => runLevel(i, ui));
  m.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
}

function stepper(stepsEl) {
  const items = [...stepsEl.children];
  let at = -1;
  return {
    to(n) {
      for (let k = 0; k <= Math.min(n, items.length - 1); k += 1) {
        if (k < n) {
          items[k].className = 'done';
          items[k].firstChild.textContent = '✓';
        }
      }
      if (n < items.length && n > at) {
        items[n].className = 'active';
      }
      at = Math.max(at, n);
    },
    finish(ok) {
      items.forEach((li) => {
        if (li.className === 'active' || (ok && li.className !== 'done')) {
          li.className = ok ? 'done' : 'failed';
          li.firstChild.textContent = ok ? '✓' : '✕';
        }
      });
    },
    reset() {
      items.forEach((li) => {
        li.className = '';
        li.firstChild.textContent = '';
      });
      at = -1;
    },
  };
}

function startTimer(t) {
  const t0 = performance.now();
  const id = setInterval(() => { t.textContent = `${((performance.now() - t0) / 1000).toFixed(1)} s`; }, 100);
  return () => clearInterval(id);
}

function renderChecks(box, list) {
  box.textContent = '';
  box.append(el('h4', '', 'Test checks (computed from the real result)'));
  list.forEach((c, k) => {
    const row = el('div', `check ${c.ok ? 'ok' : 'bad'} fade`);
    row.style.setProperty('animation-delay', `${k * 120}ms`);
    const body = el('div');
    body.append(el('span', '', c.label));
    if (c.detail) body.append(el('small', '', c.detail));
    row.append(el('span', 'mk', c.ok ? '✓' : '✕'), body);
    box.append(row);
  });
}

function showError(box, err) {
  const e = el('div', 'error-box pop');
  e.append(el('b', '', 'The firmware or bridge said no: '), document.createTextNode(err.message));
  let help = '';
  if (/not built/.test(err.message)) help = 'Build it first: ./scripts/build-simulator.sh';
  else if (/ECONNREFUSED|No X1 simulator|not running|CONNECTION|closed/i.test(err.message)) help = 'Is the simulator running? Go to Level 0 and power it on.';
  else if (/SIMTEST/.test(err.message)) help = 'Start the simulator from this page (it sets the test mnemonic), or Reset simulator state in the menu.';
  else if (/timed out/.test(err.message)) help = 'The firmware may be waiting on its screen. Look at the simulator window, or Reset simulator state.';
  if (help) e.append(el('div', 'muted', help));
  box.append(e);
}

async function runLevel(i, ui) {
  if (running) return;
  const lv = LEVELS[i];
  running = true;
  ui.go.disabled = true;
  ui.reveal.textContent = '';
  ui.checks.textContent = '';
  const st = stepper(ui.steps);
  st.reset();
  const stop = startTimer(ui.timer);
  setScreen('busy', lv.title.toUpperCase());
  const ctx = { step: (n) => st.to(n) };
  watchPackets(st, lv);
  try {
    const r = await lv.run(ctx);
    st.finish(true);
    ui.raw.textContent = JSON.stringify(r, null, 2);
    lv.reveal(r, ui.reveal);
    const list = lv.checks(r);
    renderChecks(ui.checks, list);
    if (list.every((c) => c.ok)) {
      complete(i);
      ui.next.hidden = false;
    } else {
      toast([document.createTextNode('Some checks failed: look at the red rows.')], 'err');
    }
  } catch (err) {
    st.finish(false);
    showError(ui.reveal, err);
    renderChecks(ui.checks, [{ ok: false, label: 'Level not passed', detail: err.message }]);
  } finally {
    unwatchPackets();
    stop();
    running = false;
    ui.go.disabled = false;
    setScreen(simRunning ? 'ready' : 'off');
    refreshState();
  }
}

// Steps 1-2 of a level advance on REAL packets: first CMD/legacy out → step 1,
// first STATUS/CMD_ACK back → step 2.
let packetWatcher = null;
function watchPackets(st, lv) {
  packetWatcher = (type, dir) => {
    if (lv.id === 'power') return;
    if (dir === 'tx' && (type === 'CMD' || type === 'LEGACY' || type === 'STATUS_REQ')) st.to(1);
    if (dir === 'rx' && (type === 'CMD_ACK' || type === 'STATUS')) st.to(2);
  };
}
function unwatchPackets() {
  packetWatcher = null;
}

// ------------------------------------------------------------------ collect levels
function setupCollect(lv, i, ui) {
  const got = lv.collect === 'btc' ? state.btc : state.coins;
  const grid = el('div', 'collect');
  const cards = {};
  lv.items.forEach((item) => {
    const c = el('button', `coin${got.includes(item.id) ? ' got' : ''}`);
    c.append(el('div', 'sym', item.sym), el('div', 'nm', item.name), el('div', 'vl', item.note || (got.includes(item.id) ? 'collected' : 'click to collect')));
    c.addEventListener('click', () => collect([item]));
    cards[item.id] = c;
    grid.append(c);
  });
  const p = el('div', 'panel');
  p.append(el('h4', '', 'Collection'), grid);
  ui.reveal.append(p);
  renderChecks(ui.checks, lv.checks());

  async function collect(items) {
    if (running) return;
    running = true;
    ui.go.disabled = true;
    const st = stepper(ui.steps);
    st.reset();
    st.to(0);
    const stop = startTimer(ui.timer);
    for (const item of items) {
      const c = cards[item.id];
      c.classList.remove('fail');
      c.classList.add('busy');
      setScreen('busy', item.name.toUpperCase());
      st.to(1);
      try {
        const r = await lv.runOne(item);
        st.to(2);
        const v = lv.value(r);
        c.classList.remove('busy');
        c.classList.add('got', 'pop');
        c.lastChild.textContent = short(String(v), 8) + (r.verified === true ? '  ✓ ethers' : '');
        if (!got.includes(item.id)) got.push(item.id);
        saveState();
        ui.raw.textContent = JSON.stringify(r, null, 2);
      } catch (err) {
        c.classList.remove('busy');
        c.classList.add('fail');
        c.lastChild.textContent = err.message.slice(0, 60);
      }
    }
    stop();
    st.finish(got.length === lv.items.length);
    renderChecks(ui.checks, lv.checks());
    if (got.length === lv.items.length && complete(i)) ui.next.hidden = false;
    else if (got.length === lv.items.length) ui.next.hidden = false;
    running = false;
    ui.go.disabled = false;
    setScreen(simRunning ? 'ready' : 'off');
  }
  ui.go.addEventListener('click', () => collect(lv.items.filter((x) => !got.includes(x.id)).length ? lv.items.filter((x) => !got.includes(x.id)) : lv.items));
}

// ------------------------------------------------------------------ boss
async function runBoss(i, ui) {
  if (running) return;
  running = true;
  ui.go.disabled = true;
  const plan = [
    ['Device', 'raw-status', {}, 'Raw status packet'], ['Device', 'device-info', {}, 'Device info'], ['Device', 'wallets', {}, 'Wallet list'],
    ...Object.entries(EVM).map(([id, n]) => ['EVM', 'eth-address', { chainId: Number(id) }, `${n} address`]),
    ['EVM', 'sign-tx', { chainId: 1 }, 'Sign tx on Ethereum'], ['EVM', 'sign-tx', { chainId: 137 }, 'Sign tx on Polygon'],
    ['EVM', 'sign-message', {}, 'Sign message'], ['EVM', 'sign-typed-data', {}, 'Sign EIP-712'],
    ...BTC.map((b) => ['Bitcoin', 'btc-xpub', { coin: b.id }, `${b.name} xpub`]),
    ...COINS.map((c) => ['Coins', 'coin-key', { coin: c.id }, `${c.name} key`]),
  ];
  ui.reveal.textContent = '';
  const p = panel(ui.reveal, 'System health');
  const health = el('div', 'health');
  const bar = el('div');
  health.append(bar);
  const status = el('p', 'muted', '');
  const table = el('table', 'score');
  p.append(health, status, table);
  const st = stepper(ui.steps);
  st.reset();
  const stop = startTimer(ui.timer);
  const stageOf = { Device: 0, EVM: 1, Bitcoin: 2, Coins: 3 };
  let pass = 0;
  for (let k = 0; k < plan.length; k += 1) {
    const [area, name, params, label] = plan[k];
    st.to(stageOf[area]);
    const tr = el('tr');
    const tdName = el('td', '', label);
    const tdRes = el('td', 'run-t', 'running…');
    const tdT = el('td', 'r', '');
    tr.append(tdName, tdRes, tdT);
    table.append(tr);
    tr.scrollIntoView({ block: 'nearest' });
    setScreen('busy', label.toUpperCase());
    const t0 = performance.now();
    try {
      const r = await op(name, params);
      const ok = r.verified !== false;
      tdRes.className = ok ? 'ok-t' : 'bad-t';
      tdRes.textContent = ok ? (r.verified ? 'PASS ✓ verified' : 'PASS') : 'FAIL (not verified)';
      if (ok) pass += 1;
    } catch (err) {
      tdRes.className = 'bad-t';
      tdRes.textContent = `FAIL ${err.message.slice(0, 50)}`;
    }
    tdT.textContent = `${((performance.now() - t0) / 1000).toFixed(1)} s`;
    bar.style.setProperty('width', `${((k + 1) / plan.length) * (pass / (k + 1)) * 100}%`);
    status.textContent = `${pass} / ${k + 1} passed · ${plan.length - k - 1} to go`;
  }
  stop();
  const won = pass === plan.length;
  st.finish(won);
  renderChecks(ui.checks, [{ ok: won, label: `${pass} of ${plan.length} system checks passed`, detail: won ? 'the full stack works end to end' : 'see the red rows above' }]);
  if (won && complete(i)) {
    toast([document.createTextNode('You beat the final level. Rank: '), el('b', '', 'X1 Master')], 'win');
  }
  if (won) ui.next.hidden = false;
  running = false;
  ui.go.disabled = false;
  setScreen(simRunning ? 'ready' : 'off');
}

// ------------------------------------------------------------------ live wire
const queue = [];
let skipped = 0;
let sent = 0;
let received = 0;
let screenTimer = null;

function packetType(text) {
  const w = (text || '').split(' ')[0];
  return w.startsWith('LEGACY') ? 'LEGACY' : w;
}

function setScreen(mode, label) {
  const s = $('#screen');
  s.className = `screen ${mode === 'off' ? 'off' : mode === 'busy' ? 'busy' : ''}`;
  $('#screen-text').textContent = mode === 'off' ? 'OFF' : mode === 'busy' ? label || 'BUSY' : label || 'READY';
}

function onFrame(f) {
  const type = packetType(f.text);
  if (f.dir === 'tx') sent += 1;
  else received += 1;
  $('#wire-stats').textContent = `${sent} sent · ${received} received`;
  if (packetWatcher) packetWatcher(type, f.dir);
  feedLine(f, type);
  if (REDUCED) return;
  if (queue.length > 24) {
    queue.shift();
    skipped += 1;
    $('#overflow').textContent = `+${skipped} more packets`;
  }
  queue.push({ dir: f.dir, type });
}

setInterval(() => {
  const item = queue.shift();
  if (!item) {
    if (skipped && !queue.length) {
      skipped = 0;
      setTimeout(() => { if (!queue.length) $('#overflow').textContent = ''; }, 800);
    }
    return;
  }
  const wire = $('#wire');
  const dot = el('div', 'pkt');
  dot.style.setProperty('color', PACKET_COLORS[item.type] || '#e8ecf6');
  dot.title = item.type;
  wire.append(dot);
  const from = item.dir === 'tx' ? '13%' : '87%';
  const to = item.dir === 'tx' ? '87%' : '13%';
  const anim = dot.animate([{ left: from, transform: 'scale(0.6)', opacity: 0.2 }, { left: '50%', transform: 'scale(1)', opacity: 1, offset: 0.5 }, { left: to, transform: 'scale(0.6)', opacity: 0.2 }], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' });
  setTimeout(() => {
    const b = $('#bridge-node');
    b.classList.remove('pulse');
    void b.offsetWidth;
    b.classList.add('pulse');
  }, 320);
  anim.onfinish = () => dot.remove();
}, 45);

function feedLine(f, type) {
  const feed = $('#feed');
  const li = el('li');
  const tag = el('span', `tag t-${f.dir}`, f.dir === 'tx' ? '→' : '←');
  const ty = el('span', 'ty', `${type} `);
  ty.style.setProperty('color', PACKET_COLORS[type] || '#e8ecf6');
  const rest = f.text.slice(type === 'LEGACY' ? 10 : type.length);
  li.append(tag, ty, document.createTextNode(rest));
  feed.append(li);
  while (feed.children.length > 300) feed.firstChild.remove();
  feed.scrollTop = feed.scrollHeight;
}

function logLine(text) {
  const m = /device_idle_state=(\w+)/.exec(text);
  if (m) setScreen(m[1] === 'IDLE' ? 'ready' : 'busy', m[1] === 'NULL' ? 'BOOTING' : m[1] === 'DEVICE' ? 'LOGO…' : 'READY');
  if (/exited/.test(text)) {
    simRunning = false;
    setScreen('off');
  }
  if (!/^run |used:/.test(text)) {
    const li = el('li', 'log', text);
    $('#feed').append(li);
  }
}

function renderLegend() {
  const lg = $('#legend');
  [['STATUS_REQ', 'status poll'], ['CMD', 'command'], ['CMD_ACK', 'ack'], ['CMD_OUTPUT', 'result'], ['LEGACY', 'handshake'], ['ERROR', 'error']].forEach(([k, t]) => {
    const s = el('span', '', t);
    s.style.setProperty('color', PACKET_COLORS[k]);
    lg.append(s);
  });
}

// ------------------------------------------------------------------ confetti
function confetti() {
  if (REDUCED) return;
  const c = $('#confetti');
  const ctx = c.getContext('2d');
  c.width = window.innerWidth;
  c.height = window.innerHeight;
  const colors = ['#38d3ff', '#9b7bff', '#3ddc97', '#ffbe55', '#ff6b7a'];
  const parts = Array.from({ length: 140 }, () => ({
    x: c.width / 2 + (Math.random() - 0.5) * 200, y: c.height / 3,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 12 - 4,
    w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, c.width, c.height);
    parts.forEach((p) => {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (t - t0 < 1800) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, c.width, c.height);
  })(t0);
}

// ------------------------------------------------------------------ server state + boot
async function refreshState() {
  try {
    const s = await api('/api/state');
    simRunning = s.simulator === 'running';
    $('#sim-chip').className = `sim-chip ${simRunning ? 'on' : 'off'}`;
    $('#sim-text').textContent = `Simulator: ${s.simulator}`;
    if (!running) setScreen(simRunning ? 'ready' : 'off');
  } catch {
    simRunning = false;
    $('#sim-chip').className = 'sim-chip off';
    $('#sim-text').textContent = 'Playground server offline';
  }
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('frame', (e) => onFrame(JSON.parse(e.data)));
  es.addEventListener('log', (e) => logLine(JSON.parse(e.data).text));
  es.addEventListener('state', () => refreshState());
}

document.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', async () => {
  const what = b.dataset.menu;
  b.closest('details').open = false;
  if (what === 'unlock') {
    state.unlockAll = true;
    saveState();
    renderMap();
    toast([document.createTextNode('All levels unlocked. Free play!')]);
  } else if (what === 'reset-progress') {
    Object.assign(state, { done: [], xp: 0, unlockAll: false, btc: [], coins: [], last: 0 });
    saveState();
    renderProgress();
    openLevel(0);
  } else if (what === 'reset-device') {
    if (running) return;
    running = true;
    setScreen('busy', 'RESET');
    toast([document.createTextNode('Wiping simulator state and rebooting…')]);
    try {
      await api('/api/sim/reset', {});
      toast([document.createTextNode('Simulator reset and running.')], 'win');
    } catch (err) {
      toast([document.createTextNode(err.message)], 'err');
    }
    running = false;
    refreshState();
  }
}));
$('#feed-clear').addEventListener('click', () => { $('#feed').textContent = ''; sent = 0; received = 0; $('#wire-stats').textContent = '0 sent · 0 received'; });

renderLegend();
renderProgress();
connectEvents();
refreshState().then(() => {
  const first = LEVELS.findIndex((_, k) => !isDone(k));
  openLevel(isOpen(state.last) && state.last ? state.last : first === -1 ? 0 : first);
});
setInterval(() => { if (!running) refreshState(); }, 10000);
