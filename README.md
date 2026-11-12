# FibonacciTestingWASM

This project is a simple web-based tool to compare the performance of different Fibonacci number calculation
methods, with a focus on WebAssembly (WASM) and Python in the browser. It shows different, interesting ways of
calculating very large Fibonacci numbers, and the benefits of running WASM in the browser.

It has two modes, and every method in a mode uses the same kind of number:

- **BigInt mode**: whole numbers with no size limit (JavaScript's `BigInt`, Python's `int`, GMP's `mpz`). Every digit
  of F(n) is exact.
- **Float mode**: floats with 64 significant digits (decimal.js, Python's `decimal`, MPFR at 213 bits). F(n) is
  rounded, but stays fast at any n, and Binet's formula becomes possible.

The results show how WASM can be very beneficial, and much faster, in specific cases: GMP, a C library for huge
numbers, compiled to WASM beats every other method here, including JavaScript's built-in `BigInt`. It isn't hard to
set up either: calling GMP from JavaScript takes a few lines (see [`js/algorithms/gmp-wasm.js`](js/algorithms/gmp-wasm.js)), and you're
free to take any code from this repo for your own experiments.

**Live demo: https://m-minkov.github.io/FibonacciTestingWASM/**

<p align="center"><img src="docs/screenshot.png" width="480" alt="The page after computing F(1,000,000) with every method in BigInt mode"></p>

## Results

<p align="center"><img src="docs/chart.png" width="720" alt="Running time of each BigInt method against n, on logarithmic axes"></p>

### BigInt mode

**The fastest method is `mpz_fib_ui`: GMP compiled to WASM.** Time to compute F(n) on an Intel Core i5-14400 in
Chromium 152:

| Method | Runs on | F(10⁶), 208,988 digits | F(10⁸), 20.9 million digits |
|---|---|---|---|
| **`mpz_fib_ui`** | **GMP, compiled to WASM** | **4.0 ms** | **0.99 s** |
| Fast doubling | JavaScript `BigInt` | 9.4 ms | 2.1 s |
| Matrix power | JavaScript `BigInt` | 34 ms | 6.3 s |
| `gmpy2.fib` | Python calling GMP, on Pyodide (WASM) | 49 ms | 10.5 s |
| Fast doubling | Pure Python, on Pyodide (WASM) | 45 ms | 91 s |
| Iterative loop | JavaScript `BigInt` | 5.9 s | not run (about 2 days) |

These are Chromium numbers. In Firefox the JavaScript `BigInt` rows are much slower, and in Firefox and Safari they
stop with an error past about F(1,500,000). See [Every browser has its own BigInt](#every-browser-has-its-own-bigint).

What this shows:

- **WASM brings faster libraries to the browser.** JavaScript's `BigInt` is already fast, but GMP has been tuned for
  big-number math for decades. Compiled to WASM, it is about 2× faster than `BigInt` running the best algorithm.
- **How the WASM is built matters.** `gmpy2.fib` calls the very same GMP function, but Pyodide's copy of GMP is built
  without GMP's usual optimizations, so it is about 10× slower than gmp-wasm's.
- **Python in WASM is still Python.** Pure Python's integers stop at Karatsuba multiplication, so it falls further
  behind as n grows: 11× slower than GMP at F(10⁶), 90× at F(10⁸).
- **The algorithm matters most of all.** The basic loop does n additions on ever-larger numbers (O(n²)). Every other
  method needs only about log₂ n steps.
- **WASM runs the same in every browser; `BigInt` doesn't.** Each browser has its own `BigInt`, with different
  algorithms and size limits. GMP compiled to WASM is the same code everywhere.

### Float mode

With a fixed 64 digits, F(n) stays the same size at any n, so every method except the loop finishes in well under a
millisecond; the fastest, Binet's formula with MPFR, takes about 7 µs for F(10⁹).

What this shows:

- **Precision is the real cost.** The same fast doubling that takes 2.1 s for an exact F(10⁸) takes 0.3 ms with 64
  digits. Exact answers need every one of F(n)'s 0.69n bits; floats keep only the leading ones.
- **Binet's formula wins once fractions are cheap.** It is one power φⁿ, and MPFR computes powers with few, correctly
  rounded steps. In BigInt mode it can't be used at all.
- **The Python and gmpy2 rows are mostly overhead.** Calling into Pyodide costs about 0.2 ms, much more than the
  arithmetic itself.
- **Rounding errors add up slowly.** Each method loses about one digit each time n grows tenfold (Binet's formula two
  or three more, since the error in φ is raised to the n-th power). 64 working digits leave every method with at
  least 54 correct digits up to F(4,294,967,295); the page checks the first 50 of every result against a 128-digit
  reference and says so if a method falls short. Float mode accepts n up to 2^53 − 1 (9,007,199,254,740,991), where
  only the decimal.js methods remain: matrix power and fast doubling still have 50 correct digits there, while
  Binet's formula drops below 50 from about F(10¹⁴) and ends at 47.
- **Floats have their own limit: the exponent.** MPFR's largest exponent is 2^1,073,741,823, which F(n) passes at
  about F(1,546,639,296) (Binet's φⁿ two steps earlier), and Python's `decimal` on 32-bit WASM stops at
  10^425,000,000, passed at F(2,033,613,092). decimal.js reaches every n up to 2^53 − 1.

## Every browser has its own BigInt

`BigInt` is built into each browser's JavaScript engine, and each engine implements it differently: different
multiplication algorithms, and even a different maximum size. So the same JavaScript can be fast in Chrome, 14× slower
in Firefox, and fail outright in Firefox and Safari for larger n. GMP compiled to WASM is the same code in every
browser, so it gives the same results at about the same speed everywhere.

The same code on the same computer (Intel Core i5-14400), in headless Chrome 157 and Firefox 159:

| | Chrome 157 (V8) | Firefox 159 (SpiderMonkey) |
|---|---|---|
| Largest `BigInt` | 1,073,741,760 bits | 1,048,576 bits |
| Largest F(n) with JavaScript fast doubling | about F(1,546,000,000)¹ | F(1,510,299) |
| Fast doubling, F(10⁶) | 7.2 ms | 102 ms |
| Fast doubling, F(10⁷) | 101 ms | `RangeError: BigInt is too large to allocate` |
| Squaring one 520,681-bit `BigInt` | 2.1 ms | 54 ms |
| `F(10⁶).toString()` (208,988 digits) | 22 ms | 523 ms |
| `mpz_fib_ui` (GMP in WASM), F(10⁶) | 4.7 ms | 4.0 ms |
| `mpz_fib_ui` (GMP in WASM), F(10⁷) | 69 ms | 82 ms |
| `mpz_fib_ui` (GMP in WASM), F(10⁸) | 1.10 s | 1.27 s |

¹ Calculated from V8's limit, not run.

In Firefox, GMP in WASM is 25× faster than the best JavaScript at F(10⁶), and the only one of the two that can go
further. The page's time estimates were measured in Chromium, so in Firefox the `BigInt` methods take longer than
predicted (the page adjusts its estimates after each run).

Some details behind those numbers:

- **The size limits are hard-coded constants.** V8 caps a `BigInt` just under 2³⁰ bits, a limit its own source calls
  "somewhat arbitrarily chosen" ([`bigint.h`](https://github.com/v8/v8/blob/main/src/objects/bigint.h)).
  SpiderMonkey (Firefox) and JavaScriptCore (Safari) cap it at 2²⁰ = 1,048,576 bits, about 315,653 decimal digits
  ([`BigIntType.h`](https://github.com/mozilla-firefox/firefox/blob/main/js/src/vm/BigIntType.h),
  [`JSBigInt.h`](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/JSBigInt.h)). Python's
  integers and GMP have no such cap; they stop only when memory runs out.
- **Each engine words the error differently.** Chrome: `RangeError: Maximum BigInt size exceeded`. Firefox:
  `RangeError: BigInt is too large to allocate`. Safari: `RangeError: Out of memory: BigInt generated from this
  operation is too big`.
- **Firefox checks the size before it multiplies.** It reserves room for the sum of both inputs' sizes, so
  multiplying the largest possible `BigInt` by `1n` throws, even though the answer fits
  ([bug 2043293](https://bugzilla.mozilla.org/show_bug.cgi?id=2043293)).
- **Server-side JavaScript inherits the same limits.** Node.js and Deno run on V8, so they get Chrome's limit; Bun
  runs on JavaScriptCore, so it gets Safari's.
- **Chrome's BigInt got fast in 2021.** V8 added Karatsuba multiplication in June 2021 and FFT multiplication a month
  later, along with Toom-Cook, faster division and fast conversion to decimal
  ([`src/bigint`](https://github.com/v8/v8/tree/main/src/bigint)). Firefox still multiplies `BigInt`s the schoolbook
  way, O(n²), which is why squaring a 520,681-bit number takes 26× longer there. WebKit, Safari's engine, added
  Karatsuba, Toom-3 and FFT multiplication in September 2026 and faster decimal conversion in October 2026, but kept
  the 1,048,576-bit limit.
- **Even ordinary float math can differ.** The JavaScript standard lets `**` and `Math.pow` be approximate
  ([Number::exponentiate](https://tc39.es/ecma262/#sec-numeric-types-number-exponentiate)). φ⁴ from Binet's formula,
  `((1 + Math.sqrt(5)) / 2) ** 4`, is `6.854101966249686` in Chrome (correctly rounded) but `6.854101966249685` in
  Firefox, one bit lower, because Firefox computes x⁴ as (x·x)·(x·x). For larger powers, Firefox calls the operating
  system's own `pow` ([`Math.cpp`](https://github.com/mozilla-firefox/firefox/blob/main/js/src/builtin/Math.cpp)), so
  the result can even depend on the OS.
- **WASM leaves much less room for differences.** Its arithmetic must round exactly as the IEEE 754 standard says, and
  functions like `pow` are compiled into the module, so the same WASM code gives the same bits in every browser. The
  few exceptions, such as the exact bits of a NaN, are listed in the
  [WebAssembly design notes](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md). What still differs
  is speed, and only slightly: 69 ms against 82 ms above.

## The methods

| Method | How it works | Modes |
|---|---|---|
| Iterative loop | Add the last two numbers, n times. | BigInt, float |
| Matrix power | Raise [[1,1],[1,0]] to the n-th power by repeated squaring: log₂ n steps × 8 multiplications. | BigInt, float |
| Fast doubling | Jump from F(k), F(k+1) to F(2k), F(2k+1): log₂ n steps × 3 multiplications. | BigInt, float |
| `mpz_fib_ui` and `gmpy2.fib` | GMP's own Fibonacci function: doubling with 2 squarings per step. | BigInt |
| Binet's formula | Round φⁿ/√5, where φ = (1 + √5)/2. Needs fractions, so floats only. | float |

Ordinary JavaScript numbers (float64) aren't used: they keep only about 16 digits, are exact only up to F(78), and
overflow past F(1,476).

Every method runs in its own Web Worker, so the page never freezes. Runs expected to take over 2 minutes or about
1.5 GB of memory are skipped unless you turn on dangerous mode.

## Running locally

Workers and ES modules need a web server (opening `index.html` as a file won't work):

```bash
python -m http.server 8000
```

Then open http://localhost:8000. There's no build step and nothing to install.

## How the code is organized

- [`js/algorithms/`](js/algorithms/): the implementations, one file per language or library. The page shows this
  exact code under each method's "About".
  - [`javascript-bigint.js`](js/algorithms/javascript-bigint.js): pure JavaScript with the built-in `BigInt`.
  - [`javascript-decimal.js`](js/algorithms/javascript-decimal.js): JavaScript with decimal.js floats.
  - [`python.js`](js/algorithms/python.js): the Python code run by Pyodide (plain `int`, gmpy2, `decimal`, MPFR).
  - [`gmp-wasm.js`](js/algorithms/gmp-wasm.js): GMP and MPFR compiled to WebAssembly, called from JavaScript.
  - [`precision.js`](js/algorithms/precision.js): the float-mode precision shared by every float method.
- [`js/worker.js`](js/worker.js): one worker per method; loads Pyodide or gmp-wasm only when needed.
- [`js/engine.js`](js/engine.js): method details, the worker wrapper and the time and memory estimates.
- [`js/app.js`](js/app.js): the page: running methods side by side, progress bars and the chart.
- [`bench.html`](bench.html): measures your own machine and regenerates [`js/bench-data.js`](js/bench-data.js),
  the data behind the chart. Past the largest measured size, the chart follows the measured trend.

## License

Released into the public domain under [the Unlicense](LICENSE). Copy, change, sell or use any of it however you
like, with no need to credit anyone. The exceptions are the bundled libraries in [`js/vendor/`](js/vendor/), which
keep their own licenses: gmp-wasm (LGPL-3.0) and decimal.js (MIT); see [`js/vendor/README.md`](js/vendor/README.md).

## Credits

- Fast doubling and matrix derivations: [Project Nayuki](https://www.nayuki.io/page/fast-fibonacci-algorithms)
- [GMP](https://gmplib.org/) and [MPFR](https://www.mpfr.org/), compiled to WASM by [gmp-wasm](https://github.com/Daninet/gmp-wasm)
- [Pyodide](https://pyodide.org/) and [gmpy2](https://github.com/gmpy2/gmpy2)
- [decimal.js](https://github.com/MikeMcl/decimal.js) by Michael Mclaughlin
