// The Fibonacci implementations. Imported by the workers (to run them) and by the page
// (to show their source code), so the code you read on the page is the code that runs.

/* ---------- JavaScript (BigInt / Number) ---------- */

export function fibIterative(n) {
  let a = 0n, b = 1n;                    // F(0), F(1)
  for (let i = 0; i < n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return a;
}

export function fibBinetFloat(n) {
  const sqrt5 = Math.sqrt(5), phi = (1 + sqrt5) / 2;
  const x = Math.round(phi ** n / sqrt5);  // a float64 only has 53 bits of precision
  if (!Number.isFinite(x)) throw new Error('φⁿ overflowed float64 (max ≈ 1.8 × 10³⁰⁸)');
  return BigInt(x);
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

/* ---------- GMP / MPFR compiled to WebAssembly (gmp-wasm), g = raw C binding ---------- */

export function gmpFib(g, n) {
  const z = g.mpz_t();
  g.mpz_init(z);
  g.mpz_fib_ui(z, n);                    // GMP's own Fibonacci routine
  return z;
}

export function gmpBinet(g, n) {
  const RNDN = 0;                                    // round to nearest
  const bits = Math.ceil(n * 0.6942419136306174) + 64; // size of F(n) + guard bits
  const phi = g.mpfr_t(), sqrt5 = g.mpfr_t(), z = g.mpz_t();
  g.mpfr_init2(phi, bits); g.mpfr_init2(sqrt5, bits); g.mpz_init(z);
  g.mpfr_sqrt_ui(sqrt5, 5, RNDN);                    // √5
  g.mpfr_add_ui(phi, sqrt5, 1, RNDN);
  g.mpfr_div_2ui(phi, phi, 1, RNDN);                 // φ = (1 + √5) / 2
  g.mpfr_pow_ui(phi, phi, n, RNDN);                  // φⁿ
  g.mpfr_div(phi, phi, sqrt5, RNDN);                 // φⁿ / √5
  g.mpfr_get_z(z, phi, RNDN);                        // round to the nearest integer
  g.mpfr_clear(phi); g.mpfr_clear(sqrt5);
  g.mpfr_t_free(phi); g.mpfr_t_free(sqrt5);
  return z;
}
