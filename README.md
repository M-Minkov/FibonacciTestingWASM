# Fibonacci in the Browser

**Live demo: https://m-minkov.github.io/FibonacciTestingWASM/**

Eight ways to compute huge Fibonacci numbers, racing side by side, entirely client-side: from a plain loop,
through textbook O(log n) algorithms, to CPython and the GMP math library compiled to WebAssembly.
Every method runs in its own Web Worker, so the page stays responsive even when a run takes minutes.

![Screenshot of the page](docs/screenshot.png)

## Methods

| Method | Runtime | Work |
|---|---|---|
| Iterative loop | JavaScript `BigInt` | n additions, O(n²) |
| Binet's formula | JavaScript float64 | O(1), but only exact up to F(70) |
| Matrix power | JavaScript `BigInt` | log₂ n steps × 8 multiplications |
| Fast doubling | JavaScript `BigInt` | log₂ n steps × 3 multiplications |
| Fast doubling | Pure Python on Pyodide (CPython → WASM) | log₂ n steps × 3 multiplications |
| `gmpy2.fib` | Python → GMP on Pyodide | GMP's `mpz_fib_ui` behind a Python call |
| `mpz_fib_ui` | GMP via [gmp-wasm](https://github.com/Daninet/gmp-wasm) | log₂ n steps × 2 squarings |
| Binet's formula | MPFR via gmp-wasm | full-precision φⁿ/√5, O(M(n) log n) |

## Findings

Compute time on an Intel Core i5-14400, Chromium 152 (the full data is in the chart and table on the page):

| Method | F(10⁶), 208,988 digits | F(10⁸), 20.9 million digits |
|---|---|---|
| Iterative loop (JS) | 5.9 s | skipped (estimated ~22 hours) |
| Matrix power (JS) | 34 ms | 6.3 s |
| Fast doubling (JS) | 9.4 ms | 2.1 s |
| Fast doubling (pure Python) | 45 ms | 91 s* |
| `gmpy2.fib` (Python → GMP) | 49 ms | 10.5 s |
| `mpz_fib_ui` (gmp-wasm) | **4.0 ms** | **0.99 s** |
| Binet's formula (MPFR) | 174 ms | 44 s* |

\* single run from the page; the other figures are medians from `bench.html`.

- **The multiplication algorithm decides everything.** Fast doubling takes ~log₂ n steps, but the numbers double
  in size each step, so the total cost is a constant times one big multiplication. V8's `BigInt` has Toom-Cook and
  FFT multiplication; CPython's `int` stops at Karatsuba, so the same algorithm falls far behind in Python.
- **Same GMP function, very different speed.** `gmpy2.fib` and gmp-wasm both call `mpz_fib_ui`, but gmp-wasm is
  roughly 10× faster. gmp-wasm builds GMP with 64-bit limbs, optimizations and thresholds tuned for WebAssembly;
  [Pyodide's recipe](https://github.com/pyodide/pyodide-recipes/blob/main/packages/libgmp/meta.yaml) uses 32-bit
  limbs and passes only `CFLAGS="-fPIC"`, which replaces GMP's default optimization flags.
- **Printing is slower than computing.** Converting F(10⁸) to decimal takes GMP about 7× longer than computing it.
  The workers therefore get the digit count and the first/last 30 digits from one power of ten and one division,
  and the page cross-checks every method's result on those digits.

## How it works

- `js/algorithms.js`: the implementations. The page shows this exact source in each card's "Show code".
- `js/worker.js`: one module worker per method. Loads Pyodide or gmp-wasm only when needed, times the
  computation, and extracts the digits. Cancelling a run terminates the worker.
- `js/engine.js`: method metadata, the worker wrapper, and run-time/memory estimates (log-log interpolation of
  the benchmark data, calibrated against your own runs).
- `js/app.js`: the UI: scheduler with a concurrency limit, progress bars, the 2-minute / 1.5 GB guard,
  dangerous mode, and the SVG chart.
- `bench.html`: regenerates `js/bench-data.js` on your machine.

No build step and no dependencies to install. gmp-wasm is vendored in `js/vendor/`; Pyodide loads from the jsDelivr CDN.

## Running locally

Workers and ES modules need a web server (opening `index.html` as a file won't work):

```bash
python -m http.server 8000
```

Then open http://localhost:8000. To refresh the chart data, open http://localhost:8000/bench.html, run it, and paste
the output into `js/bench-data.js`.

## Credits

- Fast doubling and matrix derivations: [Project Nayuki](https://www.nayuki.io/page/fast-fibonacci-algorithms)
- [GMP](https://gmplib.org/) and [MPFR](https://www.mpfr.org/) via [gmp-wasm](https://github.com/Daninet/gmp-wasm) (LGPL-3.0)
- [Pyodide](https://pyodide.org/) (MPL-2.0) and [gmpy2](https://github.com/gmpy2/gmpy2)
