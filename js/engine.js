// Method metadata, the worker wrapper, and the time/memory estimates.
// Shared by the main page (index.html) and the benchmark page (bench.html).
import {
  fibIterative, fibMatrix, fibDoubling, fibIterativeFloat, fibMatrixFloat, fibDoublingFloat, fibBinetFloat,
  PY_DOUBLING, PY_GMPY2, PY_DECIMAL, PY_MPFR, gmpFib, mpfrDoubling, mpfrBinet,
} from './algorithms.js';
import { BENCH } from './bench-data.js';

export const BYTES_PER_N = 0.6942419136306174 / 8; // F(n) has n·log2(φ) ≈ 0.694n bits

// Floats keep a fixed number of digits, so they use the same tiny amount of memory at any n (mem: 0),
// but their exponent has a limit. overflowAt is the first n that overflows (measured).
const MPFR_OVERFLOW = {
  overflowAt: 1546639294, // φⁿ in Binet’s formula; fast doubling gets 2 further
  overflowNote: 'F(n) is past MPFR’s largest exponent, 2^1,073,741,823 (about 10^323,228,496).',
};

export const METHODS = [
  /* ---------- BigInt mode: exact whole numbers ---------- */
  {
    id: 'iterative', mode: 'bigint', name: 'Iterative loop', runtime: 'JavaScript · BigInt', cost: 'n additions → O(n²)',
    mem: 4, code: fibIterative,
    desc: 'Starts from 0 and 1 and adds the last two numbers, n times. The numbers grow to about 0.69n bits, so each addition gets slower and the total work grows like n².',
  },
  {
    id: 'matrix', mode: 'bigint', name: 'Matrix power', runtime: 'JavaScript · BigInt', cost: 'log₂n steps × 8 multiplications',
    mem: 16, code: fibMatrix,
    desc: 'Raises the matrix [[1,1],[1,0]] to the n-th power by repeated squaring; the result contains F(n). That is about log₂n squarings, each costing 8 big-number multiplications.',
  },
  {
    id: 'doubling', mode: 'bigint', name: 'Fast doubling', runtime: 'JavaScript · BigInt', cost: 'log₂n steps × 3 multiplications',
    mem: 8, code: fibDoubling,
    desc: 'Uses F(2k) = F(k)·(2F(k+1) − F(k)) and F(2k+1) = F(k)² + F(k+1)² to jump from k to 2k. That is about log₂n steps of 3 multiplications each, using JavaScript’s built-in BigInt.',
  },
  {
    id: 'python', mode: 'bigint', name: 'Fast doubling', runtime: 'Python · Pyodide (WASM)', cost: 'log₂n steps × 3 multiplications',
    mem: 10, code: PY_DOUBLING, lang: 'python',
    desc: 'The same fast doubling algorithm, written in plain Python. It runs on Pyodide (the CPython interpreter compiled to WebAssembly) using Python’s built-in integers.',
  },
  {
    id: 'gmpy2', mode: 'bigint', name: 'gmpy2.fib', runtime: 'Python → GMP · Pyodide (WASM)', cost: 'log₂n steps × 2 squarings',
    mem: 8, code: PY_GMPY2, lang: 'python',
    desc: 'Calls gmpy2.fib(n) in Python, on Pyodide. gmpy2 is a Python wrapper around GMP, so the work is done by GMP’s Fibonacci function, mpz_fib_ui.',
  },
  {
    id: 'gmp', mode: 'bigint', name: 'mpz_fib_ui', runtime: 'GMP · gmp-wasm (WASM)', cost: 'log₂n steps × 2 squarings',
    mem: 8, code: gmpFib,
    desc: 'GMP’s built-in Fibonacci function, called from JavaScript through gmp-wasm (GMP compiled to WebAssembly). It starts from a small lookup table and uses doubling formulas that need only two squarings per step; squaring is cheaper than general multiplication.',
  },

  /* ---------- Float mode: 64 significant digits (213 bits for MPFR) ---------- */
  {
    id: 'float-iterative', mode: 'float', name: 'Iterative loop', runtime: 'JavaScript · decimal.js', cost: 'n additions → O(n)',
    mem: 0, code: fibIterativeFloat,
    desc: 'The same loop, on decimal.js floats with 64 significant digits. Every addition costs the same, so the work only grows like n, but every addition is also rounded, and n roundings add up.',
  },
  {
    id: 'float-matrix', mode: 'float', name: 'Matrix power', runtime: 'JavaScript · decimal.js', cost: 'log₂n steps × 8 multiplications',
    mem: 0, code: fibMatrixFloat,
    desc: 'The matrix power on decimal.js floats with 64 significant digits. Multiplications no longer get slower as F(n) grows, so the time grows only with the number of steps, log₂n.',
  },
  {
    id: 'float-doubling', mode: 'float', name: 'Fast doubling', runtime: 'JavaScript · decimal.js', cost: 'log₂n steps × 3 multiplications',
    mem: 0, code: fibDoublingFloat,
    desc: 'Fast doubling on decimal.js floats with 64 significant digits. decimal.js is a widely used arbitrary-precision decimal library, written in plain JavaScript.',
  },
  {
    id: 'float-binet', mode: 'float', name: 'Binet’s formula', runtime: 'JavaScript · decimal.js', cost: 'one power: log₂n squarings',
    mem: 0, code: fibBinetFloat,
    desc: 'F(n) is the whole number nearest to φⁿ/√5, where φ = (1 + √5)/2 is the golden ratio. That needs fractions, so it only works with floats: here decimal.js with 64 significant digits.',
  },
  {
    id: 'float-python', mode: 'float', name: 'Fast doubling', runtime: 'Python decimal · Pyodide (WASM)', cost: 'log₂n steps × 3 multiplications',
    mem: 0, code: PY_DECIMAL, lang: 'python', overflowAt: 2033613092,
    overflowNote: 'F(n) is past the largest exponent Python’s decimal allows on 32-bit WASM, 10^425,000,000.',
    desc: 'Fast doubling with Python’s standard decimal module, set to 64 significant digits. Under the hood it is libmpdec, a C library, running on Pyodide.',
  },
  {
    id: 'float-gmpy2', mode: 'float', name: 'Binet’s formula', runtime: 'Python → MPFR · gmpy2 (WASM)', cost: 'one power: log₂n squarings',
    mem: 0, code: PY_MPFR, lang: 'python', ...MPFR_OVERFLOW,
    desc: 'φⁿ/√5 with gmpy2’s mpfr type at 213 bits (about 64 digits), on Pyodide. gmpy2 hands the work to MPFR, a C library for floating-point numbers of any precision.',
  },
  {
    id: 'float-mpfr-doubling', mode: 'float', name: 'Fast doubling', runtime: 'MPFR · gmp-wasm (WASM)', cost: 'log₂n steps × 3 multiplications',
    mem: 0, code: mpfrDoubling, ...MPFR_OVERFLOW, overflowAt: 1546639296,
    desc: 'Fast doubling with MPFR floats at 213 bits (about 64 digits), called from JavaScript through gmp-wasm. MPFR is built on GMP and stores numbers in binary.',
  },
  {
    id: 'float-mpfr-binet', mode: 'float', name: 'Binet’s formula', runtime: 'MPFR · gmp-wasm (WASM)', cost: 'one power: log₂n squarings',
    mem: 0, code: mpfrBinet, ...MPFR_OVERFLOW,
    desc: 'φⁿ/√5 with MPFR at 213 bits (about 64 digits), called from JavaScript through gmp-wasm. MPFR rounds every operation correctly, including the power φⁿ.',
  },
];
// Palette slots chosen so that lines which run close together on the chart get distinct hues.
const SLOTS = {
  iterative: 3, matrix: 1, doubling: 4, python: 5, gmpy2: 6, gmp: 7,
  'float-iterative': 3, 'float-matrix': 1, 'float-doubling': 4, 'float-binet': 8,
  'float-python': 5, 'float-gmpy2': 6, 'float-mpfr-doubling': 7, 'float-mpfr-binet': 2,
};
METHODS.forEach(m => { m.color = `var(--s${SLOTS[m.id]})`; });

/* ---------- Estimates ---------- */

// Log-log interpolation between benchmark points. Beyond the last point, extend the slope of
// the last segment plus a small safety margin (big-number code tends to get relatively slower
// as it outgrows CPU caches), never flatter than minSlope (linear for BigInts, since the answer
// itself grows linearly; floats have a fixed size, so only "not faster") and never steeper than
// quadratic, since no method here is worse than O(n²).
export function interpolate(points, n, minSlope = 1) {
  if (!points?.length) return null;
  const L = Math.log;
  if (n <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [n1, t1] = points[i - 1], [n2, t2] = points[i];
    if (n <= n2) return Math.exp(L(t1) + (L(t2) - L(t1)) * (L(n) - L(n1)) / (L(n2) - L(n1)));
  }
  const [n2, t2] = points.at(-1), [n1, t1] = points.at(-2) ?? [n2 / 10, t2];
  const slope = Math.min(2, Math.max(minSlope, (L(t2) - L(t1)) / (L(n2) - L(n1)))) + 0.1;
  return t2 * (n / n2) ** slope;
}

// Benchmark rows are [n, computeMs, summaryMs]. Both curves are made non-decreasing: compute times
// (precise, timed over many repetitions) with a running max; digit-extraction times (single runs,
// which browsers round to ~0.1 ms) with a running min from the right, so timer noise at tiny n
// doesn't inflate every estimate after it.
export const curves = {};
for (const m of METHODS) {
  const rows = BENCH[m.mode]?.results[m.id] ?? [];
  let c = 1e-5, s = Infinity;
  const summary = rows.map(([n, , ms]) => [n, ms]).reverse().map(([n, ms]) => [n, s = Math.min(s, ms)]).reverse();
  curves[m.id] = {
    compute: rows.map(([n, ms]) => [n, c = Math.max(c, ms)]),
    summary: summary.map(([n, ms]) => [n, Math.max(ms, 1e-5)]),
    maxN: rows.at(-1)?.[0] ?? 0,
    minSlope: m.mode === 'float' ? 0 : 1,
  };
}

// Benchmark-based compute time and digit-extraction time of method m at n, in ms.
export const computeAt = (m, n) => interpolate(curves[m.id].compute, n, curves[m.id].minSlope);
const summaryAt = (m, n) => interpolate(curves[m.id].summary, n, curves[m.id].minSlope);

export const calibration = {}; // per-method speed factor for this device, learned from real runs

export function estimate(m, n) {
  const c = curves[m.id], f = calibration[m.id] ?? 1;
  const compute = computeAt(m, n) * f;
  return {
    compute,
    total: compute + summaryAt(m, n) * f,
    memory: m.mem * n * BYTES_PER_N,
    extrapolated: n > c.maxN,
  };
}

export function learn(m, n, actualMs) {
  const predicted = computeAt(m, n) + summaryAt(m, n);
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
