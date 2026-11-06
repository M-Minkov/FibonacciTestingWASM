// One worker runs one method. Heavy work never touches the page's main thread, and a run
// can be cancelled instantly by terminating the worker. Runtimes (Pyodide, GMP) are only
// loaded by the workers that need them.
import {
  fibIterative, fibBinetFloat, fibMatrix, fibDoubling, PY_DOUBLING, PY_GMPY2, gmpFib, gmpBinet,
} from './algorithms.js';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const GMP = './vendor/gmp-wasm-1.3.2.umd.min.js';
const K = 30; // leading / trailing digits sent back to the page

// Number of decimal digits in F(n), from Binet's formula (exact enough as an estimate).
const digitsOf = n => Math.floor(n * 0.20898764024997873 - 0.3494850021680094) + 1;
const whole = s => ({ digits: s.length, head: s, tail: '' });
const status = text => postMessage({ type: 'status', text });

// Printing every digit of a huge number is often slower than computing it, so instead we take
// one power of ten and one division: head = x / 10^shift has ~K digits, and
// digits(x) = shift + digits(head) exactly. The tail is x mod 10^K.
function summarizeBigInt(x, n) {
  if (n < 300) return whole(x.toString());
  const shift = digitsOf(n) - K - 2;
  const head = (x / 10n ** BigInt(shift)).toString();
  const tail = (x % 10n ** BigInt(K)).toString().padStart(K, '0');
  return { digits: shift + head.length, head: head.slice(0, K), tail };
}

const PY_SUMMARY = `
import json, sys
sys.set_int_max_str_digits(0)  # Python 3.11+ refuses to print ints over 4300 digits by default

def _summary(x, n, K=${K}):
    if n < 300:
        s = str(x)
        return json.dumps([len(s), s, ""])
    ten = type(x)(10)          # int for pure Python, mpz for gmpy2
    shift = int(n * 0.20898764024997873 - 0.3494850021680094) + 1 - K - 2
    head = str(x // ten ** shift)
    return json.dumps([shift + len(head), head[:K], str(x % ten ** K).zfill(K)])`;

function summarizeMpz(g, z, n) {
  if (n < 300) return whole(g.mpz_to_string(z, 10));
  const shift = digitsOf(n) - K - 2, p = g.mpz_t(), q = g.mpz_t();
  g.mpz_init(p); g.mpz_init(q);
  g.mpz_ui_pow_ui(p, 10, shift); g.mpz_tdiv_q(q, z, p);
  const head = g.mpz_to_string(q, 10);
  g.mpz_ui_pow_ui(p, 10, K); g.mpz_tdiv_r(q, z, p);
  const tail = g.mpz_to_string(q, 10).padStart(K, '0');
  for (const t of [p, q]) { g.mpz_clear(t); g.mpz_t_free(t); }
  return { digits: shift + head.length, head: head.slice(0, K), tail };
}

// reps > 1 is used by bench.html: browsers round performance.now() to ~0.1 ms, so tiny
// inputs are timed over many repetitions.
function timed(compute, summarize, reps = 1, dispose) {
  let x;
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) {
    if (i) dispose?.(x);
    x = compute();
  }
  const computeMs = (performance.now() - t0) / reps;
  postMessage({ type: 'computed', ms: computeMs });
  const t1 = performance.now();
  const summary = summarize(x);
  return { computeMs, summaryMs: performance.now() - t1, ...summary };
}

const JS = { iterative: fibIterative, binet: fibBinetFloat, matrix: fibMatrix, doubling: fibDoubling };
let run; // (n, reps) => result

async function init(method) {
  if (JS[method]) {
    run = (n, reps) => timed(() => JS[method](n), x => summarizeBigInt(x, n), reps);
  } else if (method === 'python' || method === 'gmpy2') {
    status('Downloading Python runtime (Pyodide, ~10 MB)…');
    const { loadPyodide } = await import(PYODIDE + 'pyodide.mjs');
    const py = await loadPyodide({ indexURL: PYODIDE });
    if (method === 'gmpy2') { status('Loading gmpy2…'); await py.loadPackage('gmpy2'); }
    py.runPython((method === 'gmpy2' ? PY_GMPY2 : PY_DOUBLING) + '\n' + PY_SUMMARY);
    run = (n, reps) => timed(() => py.runPython(`_x = fib(${n})`), () => {
      const [digits, head, tail] = JSON.parse(py.runPython(`_summary(_x, ${n})`));
      py.runPython('del _x');
      return { digits, head, tail };
    }, reps);
  } else {
    status('Loading GMP (WebAssembly)…');
    await import(GMP); // UMD bundle: defines globalThis.gmp
    const { binding: g } = await globalThis.gmp.init();
    const fn = method === 'gmp' ? gmpFib : gmpBinet;
    const free = z => { g.mpz_clear(z); g.mpz_t_free(z); };
    run = (n, reps) => timed(() => fn(g, n), z => {
      try { return summarizeMpz(g, z, n); } finally { free(z); }
    }, reps, free);
  }
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await init(data.method); postMessage({ type: 'ready' }); }
    if (data.type === 'run') postMessage({ type: 'result', ...run(data.n, data.reps) });
  } catch (e) {
    // Python tracebacks are long: keep the last line ("ValueError: …")
    postMessage({ type: 'error', message: String(e?.message || e).trim().split('\n').pop() });
  }
};
