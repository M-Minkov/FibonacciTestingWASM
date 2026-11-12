// One worker runs one method. Heavy work never touches the page's main thread, and a run
// can be cancelled instantly by terminating the worker. Runtimes (Pyodide, GMP) are only
// loaded by the workers that need them.
import {
  fibIterative, fibMatrix, fibDoubling, fibIterativeFloat, fibMatrixFloat, fibDoublingFloat, fibBinetFloat,
  PY_DOUBLING, PY_GMPY2, PY_DECIMAL, PY_MPFR, gmpFib, mpfrDoubling, mpfrBinet, FLOAT_BITS, FLOAT_DIGITS,
} from './algorithms/index.js';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
const GMP = './vendor/gmp-wasm-1.3.2.umd.min.js';
const K = 30; // leading / trailing digits sent back to the page
const OVERFLOW = 'Overflow: F(n) is larger than this type’s biggest exponent.';

// Number of decimal digits in F(n), from Binet's formula (exact enough as an estimate).
const digitsOf = n => Math.floor(n * 0.20898764024997873 - 0.3494850021680094) + 1;
const whole = s => ({ digits: s.length, head: s, tail: '' });
const status = text => postMessage({ type: 'status', text });

/* ---------- Summaries of integer results: digit count, first and last K digits ---------- */

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

/* ---------- Summaries of float results: significant digits and exponent (x = d.ddd… × 10^exp) ---------- */

const floatResult = (sig, exp) => {
  sig = sig.replace(/0+$/, '') || '0';
  return { float: true, sig, exp, digits: sig === '0' ? 1 : exp + 1 };
};

function summarizeDecimal(x) {
  if (!x.isFinite()) throw new Error(OVERFLOW);
  const [m, e] = x.toExponential().split('e');
  return floatResult(m.replace('.', ''), +e);
}

// MPFR stores x in binary. Its exponent in base 10 is floor(log10 x); dividing by that power of ten,
// with spare bits, gives a number between 1 and 10 whose digits are those of x.
function summarizeMpfr(g, x) {
  if (!g.mpfr_number_p(x)) throw new Error(OVERFLOW);
  if (g.mpfr_zero_p(x)) return floatResult('0', 0);
  const RNDN = 0, t = g.mpfr_t();
  g.mpfr_init2(t, FLOAT_BITS + 64);
  g.mpfr_log10(t, x, RNDN);
  let exp = Math.floor(g.mpfr_get_d(t, RNDN));
  g.mpfr_ui_pow_ui(t, 10, exp, RNDN);
  g.mpfr_div(t, x, t, RNDN);
  if (g.mpfr_cmp_ui(t, 10) >= 0) { g.mpfr_div_ui(t, t, 10, RNDN); exp++; }
  if (g.mpfr_cmp_ui(t, 1) < 0) { g.mpfr_mul_ui(t, t, 10, RNDN); exp--; }
  // t has spare bits, so its decimal string is longer than 64 digits: round it to 64.
  const s = g.mpfr_to_string(t, 10, RNDN).replace('.', '');
  g.mpfr_clear(t); g.mpfr_t_free(t);
  if (s.length <= FLOAT_DIGITS) return floatResult(s, exp);
  const r = (BigInt(s.slice(0, FLOAT_DIGITS)) + (s[FLOAT_DIGITS] >= '5' ? 1n : 0n)).toString();
  return floatResult(r.slice(0, FLOAT_DIGITS), exp + r.length - FLOAT_DIGITS); // 99…9 can round up to 100…0
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
    return json.dumps([shift + len(head), head[:K], str(x % ten ** K).zfill(K)])

def _fsummary(x):              # significant digits and exponent of a Decimal or gmpy2 mpfr
    from decimal import Decimal
    if isinstance(x, Decimal):
        if not x.is_finite(): raise OverflowError("${OVERFLOW}")
        t = x.as_tuple()
        s = "".join(map(str, t.digits))
        return json.dumps([s, t.exponent + len(s) - 1])
    import gmpy2
    if not gmpy2.is_finite(x): raise OverflowError("${OVERFLOW}")
    if x == 0: return json.dumps(["0", 0])
    s, e, _ = x.digits(10, ${FLOAT_DIGITS})
    return json.dumps([s, e - 1])`;

// reps > 1 is used by bench.html and for tiny inputs: browsers round performance.now() to
// ~0.1 ms, so fast runs are timed over many repetitions.
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

const JS_BIGINT = { iterative: fibIterative, matrix: fibMatrix, doubling: fibDoubling };
const JS_FLOAT = {
  'float-iterative': fibIterativeFloat, 'float-matrix': fibMatrixFloat,
  'float-doubling': fibDoublingFloat, 'float-binet': fibBinetFloat,
};
const PYTHON = { python: PY_DOUBLING, gmpy2: PY_GMPY2, 'float-python': PY_DECIMAL, 'float-gmpy2': PY_MPFR };
const WASM = { gmp: gmpFib, 'float-mpfr-doubling': mpfrDoubling, 'float-mpfr-binet': mpfrBinet };
let run; // (n, reps) => result

async function init(method) {
  if (JS_BIGINT[method]) {
    run = (n, reps) => timed(() => JS_BIGINT[method](n), x => summarizeBigInt(x, n), reps);
  } else if (JS_FLOAT[method]) {
    run = (n, reps) => timed(() => JS_FLOAT[method](n), summarizeDecimal, reps);
  } else if (PYTHON[method]) {
    status('Loading Python (~10 MB)…');
    const { loadPyodide } = await import(PYODIDE + 'pyodide.mjs');
    const py = await loadPyodide({ indexURL: PYODIDE });
    if (method.endsWith('gmpy2')) { status('Loading gmpy2…'); await py.loadPackage('gmpy2'); }
    py.runPython(PYTHON[method] + '\n' + PY_SUMMARY);
    const float = method.startsWith('float-');
    run = (n, reps) => timed(() => py.runPython(`_x = fib(${n})`), () => {
      try {
        if (float) { const [sig, exp] = JSON.parse(py.runPython('_fsummary(_x)')); return floatResult(sig, exp); }
        const [digits, head, tail] = JSON.parse(py.runPython(`_summary(_x, ${n})`));
        return { digits, head, tail };
      } finally { py.runPython('del _x'); }
    }, reps);
  } else {
    status('Loading GMP…');
    await import(GMP); // UMD bundle: defines globalThis.gmp
    const { binding: g } = await globalThis.gmp.init();
    const fn = WASM[method];
    if (method === 'gmp') {
      const free = z => { g.mpz_clear(z); g.mpz_t_free(z); };
      run = (n, reps) => timed(() => fn(g, n), z => {
        try { return summarizeMpz(g, z, n); } finally { free(z); }
      }, reps, free);
    } else {
      g.mpfr_set_emax(g.mpfr_get_emax_max()); // the largest exponent allowed: 2^1,073,741,823
      const free = x => { g.mpfr_clear(x); g.mpfr_t_free(x); };
      run = (n, reps) => timed(() => fn(g, n), x => {
        try { return summarizeMpfr(g, x); } finally { free(x); }
      }, reps, free);
    }
  }
}

onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await init(data.method); postMessage({ type: 'ready' }); }
    if (data.type === 'run') postMessage({ type: 'result', ...run(data.n, data.reps) });
  } catch (e) {
    // Python tracebacks are long: keep the last line ("ValueError: …")
    const message = String(e?.message || e).trim().split('\n').pop();
    postMessage({ type: 'error', message: /Overflow/.test(message) ? OVERFLOW : message });
  }
};
