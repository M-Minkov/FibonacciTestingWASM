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

/* ---------- Method cards ---------- */

const cards = METHODS.map(m => {
  const el = document.createElement('article');
  el.className = 'card';
  el.style.setProperty('--c', m.color);
  el.innerHTML = `
    <header><span class="dot"></span><div><h3></h3><p class="runtime"></p></div><span class="badge">Fastest</span></header>
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
      headline = c.overflow ? 'Overflows' : 'Not run';
      detail = c.overflow ? c.reason : `${c.reason} Dangerous mode (bottom of the page) runs it anyway.`;
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
  markFastest();
}

// Badge the fastest exact method: by measured time once results are in, by estimate before.
function markFastest() {
  const done = cards.filter(c => c.state === 'done' && c.check[0] !== '✗');
  const k = done.length ? runN : n;
  const best = (done.length ? done.map(c => [c, c.result.computeMs])
    : cards.filter(c => c.state === 'idle').map(c => [c, estimate(c.m, n).compute]))
    .filter(([c]) => !(k > c.m.exactUpTo))
    .sort((a, b) => a[1] - b[1])[0]?.[0];
  for (const c of cards) c.el.classList.toggle('best', c === best);
}

/* ---------- Running ---------- */

async function runAll() {
  if (running) return cancelAll();
  runN = n;
  running = true;
  queue = [];
  for (const c of cards) {
    Object.assign(c, { result: null, check: '', computedMs: null, overflow: runN >= c.m.overflowAt });
    const e = estimate(c.m, runN), reason = limitReason(e);
    if (c.overflow) Object.assign(c, { state: 'skipped', reason: 'φⁿ is too big for a float64.' });
    else if (reason && !dangerous) Object.assign(c, { state: 'skipped', reason });
    else { Object.assign(c, { state: 'queued', expected: Math.max(e.total, 1), expectedCompute: e.compute }); queue.push(c); }
    render(c);
  }
  markFastest();
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
  if (!running && ok) { cards.forEach(c => { c.state = 'idle'; render(c); }); markFastest(); }
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
  if (!running) markFastest();
}
ui.danger.addEventListener('change', () => setDangerous(ui.danger.checked));
$('#danger-off').addEventListener('click', () => setDangerous(false));

/* ---------- Chart ---------- */
// A fixed reference: the benchmark data, continued past the last measurement along its trend.

const box = $('#chart-box');
const tooltip = Object.assign(document.createElement('div'), { className: 'tooltip', hidden: true });
const X0 = 1, X1 = Math.log10(MAX_N);
const X_LABELS = ['10', '100', '1K', '10K', '100K', '1M', '10M', '100M', '1B'];
const VIEWS = {
  time: {
    hint: 'Both axes are logarithmic. Hover to compare the methods at any n.',
    y0: 1e-5, y1: 3.6e6,
    ticks: [[1e-5, '10 ns'], [1e-4, '100 ns'], [1e-3, '1 µs'], [1e-2, '10 µs'], [0.1, '100 µs'], [1, '1 ms'], [10, '10 ms'],
      [100, '100 ms'], [1e3, '1 s'], [1e4, '10 s'], [6e4, '1 min'], [6e5, '10 min'], [3.6e6, '1 h']],
  },
  relative: {
    hint: 'How many times slower each method is than the fastest one at the same n. Lower is better.',
    y0: 0.85, y1: 1e4,
    ticks: [[1, '1×'], [2, '2×'], [5, '5×'], [10, '10×'], [20, '20×'], [50, '50×'], [100, '100×'], [1e3, '1,000×'], [1e4, '10,000×']],
  },
};
let view = 'time', scale; // scale: current geometry, shared with the hover handler

const label = m => `${m.name} · ${m.runtime.split(' · ')[0]}`;
const drawn = (m, v) => !(v >= m.overflowAt);  // float64 Binet stops where φⁿ overflows
const exact = (m, v) => !(v > m.exactUpTo);    // …and is only exact up to F(70)
const timeAt = (m, v) => interpolate(curves[m.id].compute, m.flat ? Math.min(v, curves[m.id].maxN) : v);
// Comparisons use the methods that are exact at every n (float64 Binet is left out).
const general = METHODS.filter(m => m.exactUpTo == null);
const baseAt = v => Math.min(...general.map(m => timeAt(m, v)));
const SAMPLES = Array.from({ length: 241 }, (_, i) => 10 ** (X0 + (X1 - X0) * i / 240));

// The method that is fastest at the most input sizes gets the spotlight.
const wins = new Map(METHODS.map(m => [m, 0]));
for (const v of SAMPLES) {
  const best = METHODS.filter(m => exact(m, v)).reduce((a, b) => (timeAt(b, v) < timeAt(a, v) ? b : a));
  wins.set(best, wins.get(best) + 1);
}
const champion = [...wins].sort((a, b) => b[1] - a[1])[0][0];

function drawChart() {
  const V = VIEWS[view], ly0 = Math.log10(V.y0), ly1 = Math.log10(V.y1);
  const W = Math.max(box.clientWidth, 300), H = Math.round(Math.min(Math.max(W * 0.58, 320), 500));
  const pad = { l: W < 500 ? 52 : 62, r: 14, t: 10, b: 34 };
  const x = v => pad.l + (Math.log10(v) - X0) / (X1 - X0) * (W - pad.l - pad.r);
  const y = val => pad.t + (ly1 - Math.log10(val)) / (ly1 - ly0) * (H - pad.t - pad.b);
  scale = { W, pad, invX: px => 10 ** (X0 + (px - pad.l) / (W - pad.l - pad.r) * (X1 - X0)) };
  const out = [];
  for (let e = 1; e <= 9; e++) {
    out.push(`<line x1="${x(10 ** e)}" x2="${x(10 ** e)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--grid)"/>`);
    if (W >= 500 || e % 2) out.push(`<text x="${x(10 ** e)}" y="${H - pad.b + 20}" text-anchor="middle">${X_LABELS[e - 1]}</text>`);
  }
  V.ticks.forEach(([val, text], i) => {
    out.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(val)}" y2="${y(val)}" stroke="var(--grid)"/>`);
    if (W >= 500 || i % 2 === 0) out.push(`<text x="${pad.l - 8}" y="${y(val) + 4}" text-anchor="end">${text}</text>`);
  });
  if (view === 'time') {
    const lim = y(TIME_LIMIT);
    out.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${lim}" y2="${lim}" stroke="var(--danger)" stroke-dasharray="4 4"/>`,
      `<text x="${pad.l + 6}" y="${lim - 6}" style="fill:var(--bad)">2 min: not run by default</text>`);
  }
  out.push(`<clipPath id="plot"><rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}"/></clipPath>`,
    '<g clip-path="url(#plot)" fill="none" stroke-linecap="round" stroke-linejoin="round">');
  // Draw the champion last, so it sits on top.
  for (const m of [...METHODS.filter(m => m !== champion), champion]) {
    if (view === 'relative' && !general.includes(m)) continue;
    const pts = SAMPLES.filter(v => drawn(m, v)).map(v => [v, view === 'time' ? timeAt(m, v) : timeAt(m, v) / baseAt(v)]);
    if (pts.length < 2) continue;
    const d = 'M' + pts.map(([v, val]) => `${x(v).toFixed(1)},${y(val).toFixed(1)}`).join('L');
    out.push(`<path d="${d}" stroke="${m.color}" stroke-width="${m === champion ? 4 : 2}"/>`);
  }
  out.push('</g>', `<line id="cross" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--ink-2)" visibility="hidden"/>`);
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chart of compute time against n for each method, on logarithmic axes; the table below lists the measurements.">${out.join('')}</svg>`;
  box.append(tooltip);
  $('#chart-hint').textContent = V.hint;
}

function hover(e) {
  const rect = box.getBoundingClientRect(), px = (e.clientX - rect.left) * scale.W / rect.width;
  if (px < scale.pad.l || px > scale.W - scale.pad.r) return leave();
  const v = Math.round(scale.invX(px)), best = baseAt(v);
  const cross = box.querySelector('#cross');
  cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
  const rows = METHODS.filter(m => drawn(m, v)).map(m => [m, timeAt(m, v)]).sort((a, b) => a[1] - b[1]);
  tooltip.innerHTML = `<b>n = ${int(v)}</b>` + rows.map(([m, ms]) => {
    const factor = !exact(m, v) ? 'inexact' : ms <= best ? 'fastest' : `${+(ms / best).toPrecision(2)}×`;
    return `<div><span class="key" style="--c:${m.color}"></span><span>${esc(label(m))}</span><span>${time(ms)}</span><span class="factor">${factor}</span></div>`;
  }).join('');
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
new ResizeObserver(() => drawChart()).observe(box);
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  view = b.dataset.view;
  document.querySelectorAll('.seg button').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
  drawChart();
}));

// Winner line, legend (fastest first, at n = 100M), data table and benchmark details
const everywhere = wins.get(champion) === SAMPLES.length;
$('#winner').innerHTML = `<span class="key" style="--c:${champion.color}"></span>
  <span>Fastest ${everywhere ? 'at every input size' : 'overall'}: <b>${esc(label(champion))}</b></span>`;
const at = (m, v) => (drawn(m, v) ? timeAt(m, v) : Infinity);
const order = [...METHODS].sort((a, b) => at(a, 1e8) - at(b, 1e8));
$('#legend').innerHTML = order.map(m => `<li${m === champion ? ' class="champion"' : ''}><span class="key" style="--c:${m.color}"></span>${esc(label(m))}</li>`).join('');
const ns = [...new Set(Object.values(BENCH.results).flatMap(rows => rows.map(r => r[0])))].sort((a, b) => a - b);
const table = `<details class="table"><summary>Show the measurements</summary><div class="scroll"><table>
  <thead><tr><th>n</th>${order.map(m => `<th>${esc(label(m))}</th>`).join('')}</tr></thead>
  <tbody>${ns.map(v => `<tr><th>${int(v)}</th>${order.map(m => {
    const row = BENCH.results[m.id]?.find(r => r[0] === v);
    return `<td>${row ? time(row[1]) : ''}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div></details>`;
$('#bench-meta').innerHTML = `Measured on ${esc(BENCH.device ?? 'an unknown device')}. Compute time only.
  <a href="bench.html">Benchmark your own machine</a>.`;
$('#bench-meta').insertAdjacentHTML('afterend', table);

drawChart();
setN(n);
