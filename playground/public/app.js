// X1 Simulator Playground (browser side). No framework, no build step.
const $ = (sel) => document.querySelector(sel);
const EVM_NAMES = { 1: 'Ethereum', 137: 'Polygon', 56: 'BNB Chain', 250: 'Fantom', 43114: 'Avalanche', 10: 'Optimism', 42161: 'Arbitrum', 8453: 'Base', 999: 'Hyperliquid' };
const MAX_LINES = 600;
let frameCount = 0;
let busy = false;

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

function setBusy(on) {
  busy = on;
  document.querySelectorAll('button[data-op], #btn-all, #btn-start, #btn-stop, #btn-reset').forEach((b) => { b.disabled = on; });
}

function show(title, data, state) {
  const badge = $('#result-badge');
  badge.className = `badge ${state}`;
  badge.textContent = state === 'ok' ? 'ok' : state === 'err' ? 'error' : 'running';
  if (data && data.result && typeof data.result.verified === 'boolean') {
    badge.textContent = data.result.verified ? 'verified' : 'NOT verified';
    badge.className = `badge ${data.result.verified ? 'ok' : 'err'}`;
  }
  $('#result-meta').textContent = title;
  $('#result').textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function paramsFor(op) {
  switch (op) {
    case 'eth-address': return { chainId: Number($('#evm-chain').value), index: Number($('#evm-index').value) };
    case 'sign-tx': return { chainId: Number($('#evm-chain').value), to: $('#tx-to').value.trim(), valueEth: $('#tx-value').value.trim() };
    case 'sign-message': return { text: $('#msg-text').value };
    case 'btc-xpub': return { coin: $('#btc-coin').value };
    case 'coin-key': return { coin: $('#coin').value };
    default: return {};
  }
}

async function run(op, params = paramsFor(op)) {
  show(`${op} …`, params, 'run');
  const t0 = performance.now();
  try {
    const out = await api(`/api/run/${op}`, params);
    show(`${op} · ${out.ms} ms`, out, 'ok');
    return { ok: true, out, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    show(`${op} failed`, e.message, 'err');
    return { ok: false, error: e.message, ms: Math.round(performance.now() - t0) };
  }
}

async function simAction(action) {
  setBusy(true);
  show(`simulator ${action} …`, {}, 'run');
  try {
    const out = await api(`/api/sim/${action}`, {});
    show(`simulator ${action}`, out, 'ok');
  } catch (e) {
    show(`simulator ${action} failed`, e.message, 'err');
  } finally {
    setBusy(false);
    refreshState();
  }
}

async function runAll() {
  const plan = [
    ['raw-status', {}], ['device-info', {}], ['wallets', {}],
    ...Object.keys(EVM_NAMES).map((c) => ['eth-address', { chainId: Number(c), index: 0 }, `eth-address ${EVM_NAMES[c]}`]),
    ['sign-tx', { chainId: 1 }], ['sign-tx', { chainId: 137 }, 'sign-tx Polygon'], ['sign-message', {}], ['sign-typed-data', {}],
    ...['btc', 'btc-segwit', 'ltc', 'doge', 'dash'].map((c) => ['btc-xpub', { coin: c }, `btc-xpub ${c}`]),
    ...[...$('#coin').options].map((o) => ['coin-key', { coin: o.value }, `coin-key ${o.value}`]),
  ];
  const table = $('#summary');
  const body = table.querySelector('tbody');
  body.innerHTML = '';
  table.classList.remove('hidden');
  setBusy(true);
  let pass = 0;
  for (const [op, params, label] of plan) {
    const r = await run(op, params);
    const verified = r.ok && r.out.result && typeof r.out.result.verified === 'boolean' ? r.out.result.verified : null;
    const ok = r.ok && verified !== false;
    if (ok) pass += 1;
    const tr = document.createElement('tr');
    const cells = [label || op, ok ? (verified ? 'PASS (verified)' : 'PASS') : `FAIL ${r.error || 'not verified'}`, `${(r.ms / 1000).toFixed(1)} s`];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 1) td.className = ok ? 'pass' : 'fail';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  setBusy(false);
  $('#result-meta').textContent = `Every check: ${pass} of ${plan.length} passed`;
}

function addLine(listId, html, cls) {
  const list = document.getElementById(listId);
  const li = document.createElement('li');
  if (cls) li.className = cls;
  li.append(...html);
  list.appendChild(li);
  while (list.children.length > MAX_LINES) list.removeChild(list.firstChild);
  list.scrollTop = list.scrollHeight;
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('frame', (e) => {
    const f = JSON.parse(e.data);
    frameCount += 1;
    $('#frame-count').textContent = `${frameCount} frames`;
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = f.dir;
    addLine('frames', [dir, document.createTextNode(f.text)], f.dir);
  });
  es.addEventListener('log', (e) => {
    const l = JSON.parse(e.data);
    addLine('log', [document.createTextNode(l.text)], /error|exited/i.test(l.text) ? 'err' : '');
  });
  es.addEventListener('state', () => refreshState());
  es.onerror = () => { $('#sim-pill').textContent = 'Playground server: offline'; };
}

async function refreshState() {
  try {
    const s = await api('/api/state');
    const pill = $('#sim-pill');
    pill.textContent = `Simulator: ${s.simulator}`;
    pill.className = `pill ${s.simulator === 'running' ? 'on' : 'off'}`;
    $('#mnemonic').textContent = s.testMnemonic;
    if (!$('#evm-chain').options.length) {
      s.coins.evm.forEach((c) => $('#evm-chain').add(new Option(`${EVM_NAMES[c] || c} (${c})`, c)));
      s.coins.other.forEach((c) => $('#coin').add(new Option(c[0].toUpperCase() + c.slice(1), c)));
    }
  } catch {
    $('#sim-pill').textContent = 'Playground server: offline';
  }
}

document.querySelectorAll('button[data-op]').forEach((b) => b.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  await run(b.dataset.op);
  setBusy(false);
}));
$('#btn-start').addEventListener('click', () => simAction('start'));
$('#btn-stop').addEventListener('click', () => simAction('stop'));
$('#btn-reset').addEventListener('click', () => simAction('reset'));
$('#btn-all').addEventListener('click', () => { if (!busy) runAll(); });
$('#btn-clear').addEventListener('click', () => { $('#frames').innerHTML = ''; $('#log').innerHTML = ''; frameCount = 0; $('#frame-count').textContent = '0 frames'; });
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#frames').classList.toggle('hidden', t.dataset.tab !== 'frames');
  $('#log').classList.toggle('hidden', t.dataset.tab !== 'log');
}));

connectEvents();
refreshState();
