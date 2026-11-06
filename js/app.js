import { METHODS, Engine, estimate, learn, curves, interpolate } from './engine.js';
import { BENCH } from './bench-data.js';

const TIME_LIMIT = 120e3;   // ms: runs expected to take longer are skipped (unless dangerous mode)
const MEMORY_LIMIT = 1.5e9; // bytes
const MAX_N = 2 ** 32 - 1;  // GMP's mpz_fib_ui takes an unsigned 32-bit n
const $ = s => document.querySelector(s);
const ui = {
  n: $('#n'), info: $('#n-info'), run: $('#run'), status: $('#run-status'),
  conc: $('#concurrency'), concOut: $('#concurrency-out'), danger: $('#dangerous'),
};

/* ---------- Formatting ---------- */

const int = x => Math.round(x).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
function time(ms) {
  if (ms < 0.001) return '< 1 µs';
  if (ms < 1) return `${+(ms * 1000).toPrecision(2)} µs`;
  if (ms < 1000) return `${+ms.toPrecision(ms < 10 ? 2 : 3)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${+s.toPrecision(s < 10 ? 2 : 3)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`;
  const unit = (v, name) => `${+v.toFixed(1)} ${name}${+v.toFixed(1) === 1 ? '' : 's'}`;
  if (s < 86400) return unit(s / 3600, 'hour');
  if (s < 3.156e7) return unit(s / 86400, 'day');
  return `${int(s / 3.156e7)} years`;
}
const bytes = b => (b >= 1e9 ? `${+(b / 1e9).toPrecision(2)} GB` : b >= 1e6 ? `${+(b / 1e6).toPrecision(2)} MB` : `${int(b / 1e3)} KB`);
const digitsOf = n => (n < 2 ? 1 : Math.floor(n * 0.20898764024997873 - 0.3494850021680094) + 1);

// Accepts 1000000, 1,000,000, 1e6, 10^6, 10**6, 2.5M, 1B …
function parseN(text) {
  const t = text.replace(/[\s,_]/g, '').toLowerCase();
  let m;
  if (/^\d+$/.test(t)) return Number(t);
  if ((m = t.match(/^(\d+(?:\.\d+)?)e(\d+)$/))) return Math.round(m[1] * 10 ** m[2]);
  if ((m = t.match(/^(\d+)(?:\^|\*\*)(\d+)$/))) return Number(m[1]) ** Number(m[2]);
  if ((m = t.match(/^(\d+(?:\.\d+)?)([kmb])$/))) return Math.round(m[1] * { k: 1e3, m: 1e6, b: 1e9 }[m[2]]);
  return NaN;
}

function limitReason(e) {
  const slow = e.total > TIME_LIMIT, big = e.memory > MEMORY_LIMIT;
  if (!slow && !big) return '';
  const why = [];
  if (slow) why.push(`take too long to compute (2 min+, est. ${time(e.total)})`);
  if (big) why.push(`take too much memory (est. ${bytes(e.memory)})`);
  return `Expected to ${why.join(' and ')}.`;
}

/* ---------- State ---------- */

let n = parseN(ui.n.value), runN = n;
let dangerous = false, running = false, queue = [], active = 0, onIdle = null, ticker = 0;
const runs = []; // { m, n, ms } points for the chart

/* ---------- Method cards ---------- */

const cards = METHODS.map(m => {
  const el = document.createElement('article');
  el.className = 'card';
  el.style.setProperty('--c', m.color);
  el.innerHTML = `
    <header><span class="dot"></span><div><h3></h3><p class="runtime"></p></div></header>
    <p class="cost"></p>
    <div class="out">
      <p class="headline"></p>
      <p class="detail"></p>
      <div class="bar" hidden><span></span></div>
      <p class="digits mono" hidden></p>
    </div>
    <details class="about"><summary>About</summary><p class="desc"></p><pre><code></code></pre></details>`;
  const q = s => el.querySelector(s);
  q('h3').textContent = m.name;
  q('.runtime').textContent = m.runtime;
  q('.desc').textContent = m.desc;
  q('.cost').textContent = m.cost;
  q('code').textContent = typeof m.code === 'function' ? m.code.toString() : m.code;
  $('#methods').append(el);
  const card = {
    m, el, state: 'idle', loading: 'Starting…',
    headline: q('.headline'), detail: q('.detail'), bar: q('.bar'), fill: q('.bar span'), digits: q('.digits'),
  };
  card.engine = new Engine(m, msg => {
    if (msg.type === 'status') card.loading = msg.text;
    if (msg.type === 'computed') card.computedMs = msg.ms;
    if (['idle', 'waiting'].includes(card.state)) render(card);
  });
  return card;
});

function render(c) {
  const { m, engine } = c;
  let headline = '', detail = '', progress = null, digits = '', title = '';
  switch (c.state) {
    case 'idle': {
      const e = estimate(m, n), reason = limitReason(e);
      headline = reason && !dangerous ? 'Will be skipped' : `${e.total < 0.001 ? '' : '≈ '}${time(e.total)} <small>estimated</small>`;
      detail = reason && !dangerous ? reason : reason ? 'Over the limits; dangerous mode will run it.' : '';
      if (n >= m.overflowAt) [headline, detail] = ['Will overflow', 'φⁿ is too big for a float64.'];
      else if (n > m.exactUpTo) detail = `Only approximate past F(${m.exactUpTo}).`;
      if (engine.state === 'loading') detail = `${detail} ${c.loading}`;
      if (engine.state === 'failed') detail = `Failed to load: ${esc(engine.loadError)}`;
      break;
    }
    case 'queued':
      headline = 'Queued';
      detail = `Expected ~${time(c.expected)}.`;
      break;
    case 'waiting':
      headline = 'Loading…';
      detail = c.loading;
      break;
    case 'running': {
      const elapsed = performance.now() - c.start, p = elapsed / c.expected;
      headline = c.computedMs == null ? 'Computing…' : 'Extracting digits…';
      detail = c.computedMs != null ? `Computed in ${time(c.computedMs)}.`
        : p <= 1 ? `Still loading result. Expected wait: ~${time(c.expected)} (${time(elapsed)} so far).`
        : `Taking longer than expected (~${time(c.expected)} estimated, ${time(elapsed)} so far).`;
      progress = p;
      break;
    }
    case 'done': {
      const r = c.result;
      headline = `${time(r.computeMs)} <small>to compute</small>`;
      detail = `${int(r.digits)} digit${r.digits === 1 ? '' : 's'}`;
      if (c.check) detail += ` · <span class="check ${c.check[0] === '✓' ? 'ok' : 'bad'}">${c.check}</span>`;
      title = `Digits extracted in ${time(r.summaryMs)}${r.reps > 1 ? `; compute time is the average of ${int(r.reps)} runs` : ''}`;
      digits = r.tail ? `${r.head.slice(0, 18)}…${r.tail.slice(-18)}` : r.head;
      break;
    }
    case 'skipped':
      headline = 'Not run';
      detail = `${c.reason} Dangerous mode (bottom of the page) runs it anyway.`;
      break;
    case 'error':
      headline = 'Failed';
      detail = esc(c.error);
      break;
    case 'cancelled':
      headline = 'Cancelled';
      break;
  }
  c.el.dataset.state = c.state;
  c.headline.innerHTML = headline;
  c.detail.innerHTML = detail.trim();
  c.detail.title = title;
  c.bar.hidden = progress == null;
  c.bar.classList.toggle('over', progress > 1);
  if (progress != null) c.fill.style.width = `${Math.min(progress, 1) * 100}%`;
  c.digits.hidden = !digits;
  c.digits.textContent = digits;
  c.digits.title = digits && c.result.tail ? `${c.result.head}…${c.result.tail}
(first and last 30 of ${int(c.result.digits)} digits)` : '';
}

// Cross-check results: methods whose digit count and first/last digits agree get a ✓.
function verify() {
  const done = cards.filter(c => c.state === 'done');
  const key = ({ digits, head, tail }) => `${digits}:${head}:${tail}`;
  const count = {};
  for (const c of done) count[key(c.result)] = (count[key(c.result)] ?? 0) + 1;
  const best = Math.max(...Object.values(count));
  for (const c of done) {
    const k = count[key(c.result)];
    c.check = done.length < 2 ? '' : k === best && k > 1 ? `✓ matches ${k - 1} other${k > 2 ? 's' : ''}` : '✗ differs';
    render(c);
  }
}

/* ---------- Running ---------- */

async function runAll() {
  if (running) return cancelAll();
  runN = n;
  running = true;
  queue = [];
  for (const c of cards) {
    Object.assign(c, { result: null, check: '', computedMs: null });
    const e = estimate(c.m, runN), reason = limitReason(e);
    if (reason && !dangerous) Object.assign(c, { state: 'skipped', reason });
    else { Object.assign(c, { state: 'queued', expected: Math.max(e.total, 1), expectedCompute: e.compute }); queue.push(c); }
    render(c);
  }
  queue.sort((a, b) => a.expected - b.expected); // quickest first, so results start appearing at once
  updateButton();
  ticker = setInterval(tick, 200);
  await new Promise(resolve => { onIdle = resolve; pump(); });
  clearInterval(ticker);
  running = false;
  updateButton();
  tick();
}

function pump() {
  while (active < +ui.conc.value && queue.length) start(queue.shift());
  if (!active && !queue.length) onIdle?.();
}

async function start(c) {
  active++;
  try {
    if (c.engine.state !== 'ready') { c.state = 'waiting'; render(c); await c.engine.ready; }
    Object.assign(c, { state: 'running', start: performance.now() });
    render(c);
    // Browsers round timers to ~0.1 ms, so very fast methods are timed over many repetitions.
    const reps = c.expectedCompute < 5 ? Math.min(1e5, Math.ceil(20 / Math.max(c.expectedCompute, 0.0005))) : 1;
    const r = await c.engine.run(runN, reps);
    r.reps = reps;
    learn(c.m, runN, r.computeMs + r.summaryMs);
    Object.assign(c, { state: 'done', result: r });
    runs.push({ m: c.m, n: runN, ms: r.computeMs });
    drawChart();
    verify();
  } catch (e) {
    if (e.message === 'Cancelled') c.state = 'cancelled';
    else { Object.assign(c, { state: 'error', error: e.message }); c.engine.spawn(); }
  }
  render(c);
  active--;
  pump();
}

function cancelAll() {
  for (const c of queue) { c.state = 'cancelled'; render(c); }
  queue = [];
  for (const c of cards) if (c.state === 'running' || c.state === 'waiting') c.engine.cancel();
}

function tick() {
  cards.filter(c => c.state === 'running').forEach(render);
  const by = s => cards.filter(c => c.state === s).length;
  const done = by('done'), skipped = by('skipped'), failed = by('error');
  ui.status.textContent = running
    ? `F(${int(runN)}): ${done} done, ${by('running') + by('waiting')} running, ${by('queued')} queued${skipped ? `, ${skipped} skipped` : ''}.`
    : `Finished F(${int(runN)}): ${done} ran${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}${by('cancelled') ? `, ${by('cancelled')} cancelled` : ''}.`;
}

function updateButton() {
  ui.run.textContent = running ? 'Cancel' : 'Run';
  ui.run.classList.toggle('cancel', running);
  ui.run.disabled = !running && !valid(n);
}

/* ---------- Inputs ---------- */

const valid = x => Number.isSafeInteger(x) && x >= 0 && x <= MAX_N;

function setN(value) {
  n = value;
  const ok = valid(n);
  ui.n.setAttribute('aria-invalid', String(!ok));
  ui.info.hidden = ok;
  ui.info.textContent = ok ? '' : `Enter a whole number from 0 to ${int(MAX_N)} (1e6 or 2.5M work too).`;
  ui.n.title = ok ? `F(${int(n)}) has ${int(digitsOf(n))} digit${n < 7 ? '' : 's'}` : '';
  updateButton();
  if (!running && ok) cards.forEach(c => { c.state = 'idle'; render(c); });
  drawChart();
}

ui.n.addEventListener('input', () => setN(parseN(ui.n.value)));
ui.n.addEventListener('keydown', e => { if (e.key === 'Enter' && !running && valid(n)) runAll(); });
document.querySelectorAll('.presets button').forEach(b => b.addEventListener('click', () => {
  ui.n.value = int(+b.dataset.n);
  setN(+b.dataset.n);
}));
ui.run.addEventListener('click', runAll);
ui.conc.addEventListener('input', () => { ui.concOut.textContent = ui.conc.value; if (running) pump(); });
$('#cores-hint').textContent = `Each method runs on its own thread. Your device has ${navigator.hardwareConcurrency || 'an unknown number of'} logical cores.`;

function setDangerous(on) {
  dangerous = ui.danger.checked = on;
  $('#danger-banner').hidden = !on;
  for (const c of cards) if (c.state === 'idle' || c.state === 'skipped') { c.state = 'idle'; render(c); }
}
ui.danger.addEventListener('change', () => setDangerous(ui.danger.checked));
$('#danger-off').addEventListener('click', () => setDangerous(false));

/* ---------- Chart ---------- */

const box = $('#chart-box');
const tooltip = Object.assign(document.createElement('div'), { className: 'tooltip', hidden: true });
const X0 = 1, X1 = Math.log10(MAX_N), Y0 = -5, Y1 = 7; // log10 ranges: n, and time in ms
const Y_LABELS = ['10 ns', '0.1 µs', '1 µs', '10 µs', '100 µs', '1 ms', '10 ms', '100 ms', '1 s', '10 s', '100 s', '17 min', '2.8 h'];
const X_LABELS = ['10', '100', '1K', '10K', '100K', '1M', '10M', '100M', '1B'];
const label = m => `${m.name} · ${m.runtime.split(' · ')[0]}`;
let scale; // current geometry, shared with the hover handler

function drawChart() {
  const W = Math.max(box.clientWidth, 300), H = Math.round(Math.min(Math.max(W * 0.55, 300), 460));
  const pad = { l: W < 500 ? 48 : 58, r: 12, t: 10, b: 34 };
  const x = v => pad.l + (Math.log10(v) - X0) / (X1 - X0) * (W - pad.l - pad.r);
  const y = ms => pad.t + (Y1 - Math.log10(ms)) / (Y1 - Y0) * (H - pad.t - pad.b);
  scale = { W, H, pad, x, invX: px => 10 ** (X0 + (px - pad.l) / (W - pad.l - pad.r) * (X1 - X0)) };
  const out = [];
  for (let e = 1; e <= 9; e++) {
    out.push(`<line x1="${x(10 ** e)}" x2="${x(10 ** e)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--grid)"/>`);
    if (W >= 500 || e % 2) out.push(`<text x="${x(10 ** e)}" y="${H - pad.b + 18}" text-anchor="middle">${X_LABELS[e - 1]}</text>`);
  }
  for (let e = Y0; e <= Y1; e++) {
    out.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(10 ** e)}" y2="${y(10 ** e)}" stroke="var(--grid)"/>`);
    if (W >= 500 || e % 2 === 0) out.push(`<text x="${pad.l - 8}" y="${y(10 ** e) + 4}" text-anchor="end">${Y_LABELS[e - Y0]}</text>`);
  }
  const lim = y(TIME_LIMIT);
  out.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${lim}" y2="${lim}" stroke="var(--danger)"/>`,
    `<text x="${pad.l + 6}" y="${lim - 6}" style="fill:var(--danger)">2 min limit</text>`,
    `<clipPath id="plot"><rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}"/></clipPath>`,
    '<g clip-path="url(#plot)" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">');
  for (const m of METHODS) {
    const c = curves[m.id];
    if (!c.compute.length) continue;
    const pts = [];
    for (let i = 0; i <= 160; i++) {
      const v = 10 ** (X0 + (X1 - X0) * i / 160);
      if (m.flat && v > c.maxN) break;
      pts.push([v, interpolate(c.compute, v)]);
    }
    const path = list => 'M' + list.map(([v, ms]) => `${x(v).toFixed(1)},${y(ms).toFixed(1)}`).join('L');
    const measured = pts.filter(p => p[0] <= c.maxN), beyond = pts.filter(p => p[0] >= c.maxN);
    out.push(`<path d="${path(measured)}" stroke="${m.color}"/>`);
    if (!m.flat && beyond.length) out.push(`<path d="${path([[c.maxN, interpolate(c.compute, c.maxN)], ...beyond])}" stroke="${m.color}" stroke-dasharray="2 5" opacity="0.8"/>`);
    for (const [v, ms] of c.compute) out.push(`<circle cx="${x(v)}" cy="${y(ms)}" r="3.5" fill="${m.color}" stroke="var(--surface)" stroke-width="1.5"/>`);
  }
  for (const r of runs) out.push(`<circle cx="${x(Math.max(r.n, 10))}" cy="${y(Math.max(r.ms, 1e-5))}" r="6" stroke="${r.m.color}" stroke-width="2.5" fill="var(--surface)" fill-opacity="0.6"><title>Your run: ${esc(label(r.m))}, n = ${int(r.n)}, ${time(r.ms)}</title></circle>`);
  out.push('</g>');
  if (valid(n) && n >= 10) out.push(`<line x1="${x(n)}" x2="${x(n)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--ink-2)" stroke-opacity="0.7"/><text x="${x(n) + 5}" y="${pad.t + 12}">your n</text>`);
  out.push(`<line id="cross" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--ink-2)" visibility="hidden"/>`);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Log-log chart of compute time against n for each method; the data table below lists the same measurements.">${out.join('')}</svg>`;
  box.append(tooltip);
}

function hover(e) {
  const rect = box.getBoundingClientRect(), px = (e.clientX - rect.left) * scale.W / rect.width;
  if (px < scale.pad.l || px > scale.W - scale.pad.r) return leave();
  const v = Math.round(scale.invX(px));
  const cross = box.querySelector('#cross');
  cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
  const rows = METHODS.filter(m => curves[m.id].compute.length && !(m.flat && v > 1474))
    .map(m => [m, interpolate(curves[m.id].compute, v), !m.flat && v > curves[m.id].maxN])
    .sort((a, b) => a[1] - b[1]);
  tooltip.innerHTML = `<b>n = ${int(v)}</b>` + rows.map(([m, ms, ext]) =>
    `<div><span class="key" style="--c:${m.color}"></span><span>${esc(label(m))}</span><span>${ext ? '~' : ''}${time(ms)}</span></div>`).join('');
  tooltip.hidden = false;
  const left = e.clientX - rect.left, w = tooltip.offsetWidth;
  tooltip.style.left = `${left + 16 + w > rect.width ? left - w - 16 : left + 16}px`;
  tooltip.style.top = `${Math.min(e.clientY - rect.top + 12, rect.height - tooltip.offsetHeight)}px`;
}
function leave() {
  tooltip.hidden = true;
  box.querySelector('#cross')?.setAttribute('visibility', 'hidden');
}
box.addEventListener('pointermove', hover);
box.addEventListener('pointerleave', leave);
box.addEventListener('click', e => {
  const rect = box.getBoundingClientRect(), px = (e.clientX - rect.left) * scale.W / rect.width;
  if (px < scale.pad.l || running) return;
  const v = Number(scale.invX(px).toPrecision(2));
  ui.n.value = int(v);
  setN(v);
});
new ResizeObserver(() => drawChart()).observe(box);

// Legend, data table and benchmark details
$('#legend').innerHTML = METHODS.map(m => `<li><span class="key" style="--c:${m.color}"></span>${esc(label(m))}</li>`).join('');
const ns = [...new Set(Object.values(BENCH.results).flatMap(rows => rows.map(r => r[0])))].sort((a, b) => a - b);
const table = `<details class="table"><summary>Show as a table</summary><div class="scroll"><table>
  <thead><tr><th>n</th>${METHODS.map(m => `<th>${esc(label(m))}</th>`).join('')}</tr></thead>
  <tbody>${ns.map(v => `<tr><th>${int(v)}</th>${METHODS.map(m => {
    const row = BENCH.results[m.id]?.find(r => r[0] === v);
    return `<td>${row ? time(row[1]) : ''}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div></details>`;
$('#bench-meta').innerHTML = `${esc(BENCH.device ?? 'Unknown device')}, ${esc(BENCH.date ?? '')}. Compute time only.
  <a href="bench.html">Benchmark your own machine</a>.`;
$('#bench-meta').insertAdjacentHTML('afterend', table);

setN(n);
