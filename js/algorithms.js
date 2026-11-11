// The Fibonacci implementations. Imported by the workers (to run them) and by the page
// (to show their source code), so the code you read on the page is the code that runs.
//
// Two modes:
// - BigInt mode: whole-number types with no size limit. Every answer is exact, every digit.
// - Float mode: floating-point types with a fixed precision of 64 significant digits (decimal types)
//   or 213 bits (binary types, about 64.1 digits), the same in every method. The answer is rounded,
//   but its first 50 digits are expected to be correct; the page checks that for every run.
import Decimal from './vendor/decimal-10.6.0.mjs';

export const FLOAT_DIGITS = 64;   // significant digits for the decimal float types
export const FLOAT_BITS = 213;    // the same precision in bits, for MPFR: 213 · log10(2) ≈ 64.1 digits
export const CHECKED_DIGITS = 50; // leading digits that every float method must get right

// decimal.js, an arbitrary-precision decimal float for JavaScript, set to 64 significant digits
export const BigFloat = Decimal.clone({ precision: FLOAT_DIGITS });

/* ---------- JavaScript · BigInt ---------- */

export function fibIterative(n) {
  let a = 0n, b = 1n;                    // F(0), F(1)
  for (let i = 0; i < n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
}

export function fibMatrix(n) {
  // [[1,1],[1,0]]^k = [[F(k+1), F(k)], [F(k), F(k-1)]], stored as [a, b, c, d]
  const mul = ([a, b, c, d], [e, f, g, h]) =>
    [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h];
  let m = [1n, 0n, 0n, 1n];              // identity = Q^0
  for (const bit of n.toString(2)) {     // most significant bit first
    m = mul(m, m);                       // Q^k  -> Q^2k
    if (bit === '1') m = mul(m, [1n, 1n, 1n, 0n]); // -> Q^(2k+1)
  }
  return m[1];
}

export function fibDoubling(n) {
  let a = 0n, b = 1n;                    // F(k), F(k+1), starting at k = 0
  for (const bit of n.toString(2)) {     // most significant bit first
    const c = a * (2n * b - a);          // F(2k)
    const d = a * a + b * b;             // F(2k+1)
    [a, b] = bit === '1' ? [d, c + d] : [c, d];
  }
  return a;
}

/* ---------- JavaScript · decimal.js (BigFloat = 64 significant digits) ---------- */

export function fibIterativeFloat(n) {
  let a = new BigFloat(0), b = new BigFloat(1); // F(0), F(1)
  for (let i = 0; i < n; i++) {
    const next = a.plus(b);              // rounded to 64 significant digits
    a = b;
    b = next;
  }
  return a;
}

export function fibMatrixFloat(n) {
  // [[1,1],[1,0]]^k = [[F(k+1), F(k)], [F(k), F(k-1)]], stored as [a, b, c, d]
  const mul = ([a, b, c, d], [e, f, g, h]) => [
    a.times(e).plus(b.times(g)), a.times(f).plus(b.times(h)),
    c.times(e).plus(d.times(g)), c.times(f).plus(d.times(h)),
  ];
  const [zero, one] = [new BigFloat(0), new BigFloat(1)];
  let m = [one, zero, zero, one];        // identity = Q^0
  for (const bit of n.toString(2)) {     // most significant bit first
    m = mul(m, m);                       // Q^k  -> Q^2k
    if (bit === '1') m = mul(m, [one, one, one, zero]); // -> Q^(2k+1)
  }
  return m[1];
}

export function fibDoublingFloat(n) {
  let a = new BigFloat(0), b = new BigFloat(1); // F(k), F(k+1), starting at k = 0
  for (const bit of n.toString(2)) {     // most significant bit first
    const c = a.times(b.times(2).minus(a)); // F(2k)
    const d = a.times(a).plus(b.times(b));  // F(2k+1)
    [a, b] = bit === '1' ? [d, c.plus(d)] : [c, d];
  }
  return a;
}

export function fibBinetFloat(n) {
  const sqrt5 = new BigFloat(5).sqrt();
  const phi = sqrt5.plus(1).div(2);      // φ = (1 + √5) / 2
  return phi.pow(n).div(sqrt5).round(); // φⁿ / √5, rounded to a whole number while F(n) fits in 64 digits
}

/* ---------- Python (run by Pyodide) ---------- */

export const PY_DOUBLING = `def fib(n):
    a, b = 0, 1                      # F(k), F(k+1), starting at k = 0
    for bit in bin(n)[2:]:           # most significant bit first
        c = a * (2 * b - a)          # F(2k)
        d = a * a + b * b            # F(2k+1)
        a, b = (d, c + d) if bit == "1" else (c, d)
    return a`;

export const PY_GMPY2 = `import gmpy2

def fib(n):
    return gmpy2.fib(n)              # a thin wrapper around GMP's mpz_fib_ui`;

export const PY_DECIMAL = `from decimal import Decimal, getcontext, MAX_EMAX

getcontext().prec = 64               # significant digits
getcontext().Emax = MAX_EMAX         # the largest exponent allowed: 10^425,000,000 on 32-bit WASM

def fib(n):
    a, b = Decimal(0), Decimal(1)    # F(k), F(k+1), starting at k = 0
    for bit in bin(n)[2:]:           # most significant bit first
        c = a * (2 * b - a)          # F(2k)
        d = a * a + b * b            # F(2k+1)
        a, b = (d, c + d) if bit == "1" else (c, d)
    return a`;

export const PY_MPFR = `import gmpy2
from gmpy2 import mpfr

gmpy2.get_context().precision = 213  # bits, about 64 significant digits
gmpy2.get_context().emax = gmpy2.get_emax_max()  # the largest exponent allowed: 2^1,073,741,823

def fib(n):
    sqrt5 = gmpy2.sqrt(mpfr(5))
    phi = (1 + sqrt5) / 2            # φ = (1 + √5) / 2
    return gmpy2.rint(phi ** n / sqrt5)  # φⁿ / √5, rounded to a whole number while F(n) fits`;

/* ---------- GMP / MPFR compiled to WebAssembly (gmp-wasm), g = raw C binding ---------- */

export function gmpFib(g, n) {
  const z = g.mpz_t();
  g.mpz_init(z);
  g.mpz_fib_ui(z, n);                    // GMP's own Fibonacci routine
  return z;
}

export function mpfrDoubling(g, n) {
  const RNDN = 0;                        // round to nearest
  let [a, b, c, d] = [0, 1, 2, 3].map(() => { const x = g.mpfr_t(); g.mpfr_init2(x, FLOAT_BITS); return x; });
  g.mpfr_set_ui(a, 0, RNDN);             // F(k), F(k+1), starting at k = 0
  g.mpfr_set_ui(b, 1, RNDN);
  for (const bit of n.toString(2)) {     // most significant bit first
    g.mpfr_mul_2ui(d, b, 1, RNDN);
    g.mpfr_sub(d, d, a, RNDN);
    g.mpfr_mul(c, a, d, RNDN);           // c = F(2k) = F(k)·(2F(k+1) − F(k))
    g.mpfr_sqr(d, a, RNDN);
    g.mpfr_sqr(a, b, RNDN);
    g.mpfr_add(d, d, a, RNDN);           // d = F(2k+1) = F(k)² + F(k+1)²
    if (bit === '1') g.mpfr_add(a, c, d, RNDN);
    [a, b, c, d] = bit === '1' ? [d, a, c, b] : [c, d, a, b]; // the old a, b become scratch space
  }
  for (const x of [b, c, d]) { g.mpfr_clear(x); g.mpfr_t_free(x); }
  return a;
}

export function mpfrBinet(g, n) {
  const RNDN = 0;                        // round to nearest
  const phi = g.mpfr_t(), sqrt5 = g.mpfr_t();
  g.mpfr_init2(phi, FLOAT_BITS); g.mpfr_init2(sqrt5, FLOAT_BITS);
  g.mpfr_sqrt_ui(sqrt5, 5, RNDN);        // √5
  g.mpfr_add_ui(phi, sqrt5, 1, RNDN);
  g.mpfr_div_2ui(phi, phi, 1, RNDN);     // φ = (1 + √5) / 2
  g.mpfr_pow_ui(phi, phi, n, RNDN);      // φⁿ
  g.mpfr_div(phi, phi, sqrt5, RNDN);     // φⁿ / √5
  g.mpfr_rint(phi, phi, RNDN);           // rounded to a whole number while F(n) fits in 213 bits
  g.mpfr_clear(sqrt5); g.mpfr_t_free(sqrt5);
  return phi;
}
