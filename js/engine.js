// Method metadata, the worker wrapper, and the time/memory estimates.
// Shared by the main page (index.html) and the benchmark page (bench.html).
import {
  fibIterative, fibBinetFloat, fibMatrix, fibDoubling, PY_DOUBLING, PY_GMPY2, gmpFib, gmpBinet,
} from './algorithms.js';
import { BENCH } from './bench-data.js';

export const BYTES_PER_N = 0.6942419136306174 / 8; // F(n) has n·log2(φ) ≈ 0.694n bits

export const METHODS = [
  {
    id: 'iterative', name: 'Iterative loop', runtime: 'JavaScript · BigInt', cost: 'n additions → O(n²)',
    mem: 4, code: fibIterative,
    desc: 'Starts from 0 and 1 and adds the last two numbers, n times. The numbers grow to about 0.69n bits, so each addition gets slower and the total work grows like n².',
  },
  {
    id: 'binet', name: 'Binet’s formula', runtime: 'JavaScript · float64', cost: 'O(1), exact only up to F(70)',
    mem: 0, code: fibBinetFloat, flat: true, exactUpTo: 70, overflowAt: 1475,
    desc: 'Computes φⁿ/√5 with ordinary 64-bit floats and rounds it. A float keeps only about 16 significant digits, so the answer is wrong from F(71), and φⁿ overflows past F(1474).',
  },
  {
    id: 'matrix', name: 'Matrix power', runtime: 'JavaScript · BigInt', cost: 'log₂n steps × 8 multiplications',
    mem: 16, code: fibMatrix,
    desc: 'Raises the matrix [[1,1],[1,0]] to the n-th power by repeated squaring; the result contains F(n). That is about log₂n squarings, each costing 8 big-number multiplications.',
  },
  {
    id: 'doubling', name: 'Fast doubling', runtime: 'JavaScript · BigInt', cost: 'log₂n steps × 3 multiplications',
    mem: 8, code: fibDoubling,
    desc: 'Uses F(2k) = F(k)·(2F(k+1) − F(k)) and F(2k+1) = F(k)² + F(k+1)² to jump from k to 2k. That is about log₂n steps of 3 multiplications each, using JavaScript’s built-in BigInt.',
  },
  {
    id: 'python', name: 'Fast doubling', runtime: 'Python · Pyodide (WASM)', cost: 'log₂n steps × 3 multiplications',
    mem: 10, code: PY_DOUBLING, lang: 'python',
    desc: 'The same fast doubling algorithm, written in plain Python. It runs on Pyodide (the CPython interpreter compiled to WebAssembly) using Python’s built-in integers.',
  },
  {
    id: 'gmpy2', name: 'gmpy2.fib', runtime: 'Python → GMP · Pyodide (WASM)', cost: 'log₂n steps × 2 squarings',
    mem: 8, code: PY_GMPY2, lang: 'python',
    desc: 'Calls gmpy2.fib(n) in Python, on Pyodide. gmpy2 is a Python wrapper around GMP, so the work is done by GMP’s Fibonacci function, mpz_fib_ui.',
  },
  {
    id: 'gmp', name: 'mpz_fib_ui', runtime: 'GMP · gmp-wasm (WASM)', cost: 'log₂n steps × 2 squarings',
    mem: 8, code: gmpFib,
    desc: 'GMP’s built-in Fibonacci function, called from JavaScript through gmp-wasm (GMP compiled to WebAssembly). It starts from a small lookup table and uses doubling formulas that need only two squarings per step; squaring is cheaper than general multiplication.',
  },
  {
    id: 'mpfr', name: 'Binet’s formula', runtime: 'MPFR · gmp-wasm (WASM)', cost: 'log₂n steps at full precision',
    mem: 16, code: gmpBinet,
    desc: 'Computes φⁿ/√5 with MPFR, a library for floating-point numbers of any precision, then rounds it. With about 0.69n bits of precision the result is exact, but every step works at full precision, so it does more work than integer fast doubling.',
  },
];
// Palette slots chosen so that lines which run close together on the chart get distinct hues.
const SLOTS = { iterative: 3, binet: 8, matrix: 1, doubling: 4, python: 5, gmpy2: 6, gmp: 7, mpfr: 2 };
METHODS.forEach(m => { m.color = `var(--s${SLOTS[m.id]})`; });

/* ---------- Estimates ---------- */

// Log-log interpolation between benchmark points. Beyond the last point, extend the slope of
// the last segment plus a small safety margin (big-number code tends to get relatively slower
// as it outgrows CPU caches), and never flatter than linear, since the answer itself grows linearly.
export function interpolate(points, n) {
  if (!points?.length) return null;
  const L = Math.log;
  if (n <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [n1, t1] = points[i - 1], [n2, t2] = points[i];
    if (n <= n2) return Math.exp(L(t1) + (L(t2) - L(t1)) * (L(n) - L(n1)) / (L(n2) - L(n1)));
  }
  const [n2, t2] = points.at(-1), [n1, t1] = points.at(-2) ?? [n2 / 10, t2];
  const slope = Math.max(1, (L(t2) - L(t1)) / (L(n2) - L(n1))) + 0.1;
  return t2 * (n / n2) ** slope;
}

// Benchmark rows are [n, computeMs, summaryMs]. Both curves are made non-decreasing: compute times
// (precise, timed over many repetitions) with a running max; digit-extraction times (single runs,
// which browsers round to ~0.1 ms) with a running min from the right, so timer noise at tiny n
// doesn't inflate every estimate after it.
export const curves = {};
for (const m of METHODS) {
  const rows = BENCH.results[m.id] ?? [];
  let c = 1e-5, s = Infinity;
  const summary = rows.map(([n, , ms]) => [n, ms]).reverse().map(([n, ms]) => [n, s = Math.min(s, ms)]).reverse();
  curves[m.id] = {
    compute: rows.map(([n, ms]) => [n, c = Math.max(c, ms)]),
    summary: summary.map(([n, ms]) => [n, Math.max(ms, 1e-5)]),
    maxN: rows.at(-1)?.[0] ?? 0,
  };
}

export const calibration = {}; // per-method speed factor for this device, learned from real runs

export function estimate(m, n) {
  const c = curves[m.id], f = calibration[m.id] ?? 1;
  const x = m.flat ? Math.min(n, c.maxN) : n; // O(1) methods don't grow with n
  const compute = interpolate(c.compute, x) * f;
  return {
    compute,
    total: compute + interpolate(c.summary, x) * f,
    memory: m.mem * n * BYTES_PER_N,
    extrapolated: !m.flat && n > c.maxN,
  };
}

export function learn(m, n, actualMs) {
  const predicted = interpolate(curves[m.id].compute, n) + interpolate(curves[m.id].summary, n);
  if (actualMs < 100 || !predicted) return; // tiny runs are mostly noise
  const ratio = Math.min(10, Math.max(0.1, actualMs / predicted));
  calibration[m.id] = calibration[m.id] ? Math.sqrt(calibration[m.id] * ratio) : ratio;
}

/* ---------- Worker wrapper ---------- */

export class Engine {
  constructor(method, onMessage) {
    this.method = method;
    this.onMessage = onMessage; // status / computed / ready notifications
    this.spawn();
  }

  spawn() {
    this.worker?.terminate();
    this.state = 'loading';
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const ready = this.ready = new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
    ready.then(() => { if (this.ready === ready) { this.state = 'ready'; this.onMessage?.({ type: 'ready' }); } },
               e => { if (this.ready === ready) { this.state = 'failed'; this.loadError = e.message; this.onMessage?.({ type: 'failed' }); } });
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'status' || data.type === 'computed') return this.onMessage?.(data);
      const p = this.pending;
      this.pending = null;
      if (data.type === 'error') p?.reject(new Error(data.message)); else p?.resolve(data);
    };
    this.worker.onerror = e => {
      e.preventDefault();
      const p = this.pending;
      this.pending = null;
      p?.reject(new Error(e.message || 'The worker crashed (probably out of memory).'));
    };
    this.worker.postMessage({ type: 'init', method: this.method.id });
  }

  async run(n, reps = 1) {
    await this.ready;
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker.postMessage({ type: 'run', n, reps });
    });
  }

  // Terminating is the only way to stop a busy worker; then start a fresh one.
  cancel() {
    const p = this.pending;
    this.pending = null;
    this.spawn();
    p?.reject(new Error('Cancelled'));
  }
}
