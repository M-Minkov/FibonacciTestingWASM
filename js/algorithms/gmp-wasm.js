// GMP and MPFR, the C libraries, compiled to WebAssembly (gmp-wasm), and called from JavaScript.
// gmpFib is BigInt mode; mpfrDoubling and mpfrBinet are float mode.
//
// Each function gets gmp, gmp-wasm's raw binding: the libraries' C functions, with the same names
// and arguments as in C. As in C, every number is allocated and initialized before use, and freed
// after. The number a function returns is freed by the caller (the worker), once it has read it.
//
// The page shows each function's source under its "About", and only what is inside the function,
// so the explanations live in comments inside the function bodies.
import { FLOAT_BITS } from './precision.js';

export function gmpFib(gmp, n) {
  const result = gmp.mpz_t();  // allocate an mpz_t, GMP's whole-number type
  gmp.mpz_init(result);        // and initialize it (to 0)
  gmp.mpz_fib_ui(result, n);   // result = F(n), with GMP's own Fibonacci function
  return result;
}

export function mpfrDoubling(gmp, n) {
  // Fast doubling: from F(k) and F(k+1), two identities give F(2k) and F(2k+1):
  //   F(2k)   = F(k) · (2·F(k+1) − F(k))
  //   F(2k+1) = F(k)² + F(k+1)²
  // Going through the binary digits of n, most significant first, each digit doubles k,
  // and a 1 digit then adds one. After the last digit, k = n.
  //
  // MPFR functions write their result into a number you pass in: mpfr_add(x, y, z) sets x = y + z.
  // To avoid allocating new numbers in the loop, the same four are reused at every step.
  const RNDN = 0; // MPFR_RNDN: round every result to the nearest value
  const newFloat = () => {
    const x = gmp.mpfr_t();
    gmp.mpfr_init2(x, FLOAT_BITS); // precision: 213 bits, about 64 significant digits
    return x;
  };
  let fibK = newFloat(), fibK1 = newFloat();   // F(k), F(k+1)
  let fib2K = newFloat(), fib2K1 = newFloat(); // F(2k), F(2k+1)
  gmp.mpfr_set_ui(fibK, 0, RNDN);              // start at k = 0: F(0) = 0
  gmp.mpfr_set_ui(fibK1, 1, RNDN);             //                 F(1) = 1

  for (const bit of n.toString(2)) {
    // F(2k) = F(k) · (2·F(k+1) − F(k)). fib2K1 isn't computed yet, so it holds the part in brackets.
    gmp.mpfr_mul_2ui(fib2K1, fibK1, 1, RNDN);  // 2·F(k+1)   (mul_2ui multiplies by 2¹)
    gmp.mpfr_sub(fib2K1, fib2K1, fibK, RNDN);  // 2·F(k+1) − F(k)
    gmp.mpfr_mul(fib2K, fibK, fib2K1, RNDN);   // F(2k)

    // F(2k+1) = F(k)² + F(k+1)². F(k) isn't needed after its square, so fibK holds F(k+1)².
    gmp.mpfr_sqr(fib2K1, fibK, RNDN);          // F(k)²
    gmp.mpfr_sqr(fibK, fibK1, RNDN);           // F(k+1)²
    gmp.mpfr_add(fib2K1, fib2K1, fibK, RNDN);  // F(2k+1)

    // Move to the next k. Instead of copying values, the swaps exchange which variable
    // refers to which number. That costs nothing, and the numbers left over become
    // fib2K and fib2K1, to be overwritten in the next step.
    if (bit === '1') {                         // k → 2k + 1
      gmp.mpfr_add(fibK1, fib2K, fib2K1, RNDN); // F(k+1) = F(2k+2) = F(2k) + F(2k+1)
      [fibK, fib2K1] = [fib2K1, fibK];         // F(k) = F(2k+1)
    } else {                                   // k → 2k
      [fibK, fib2K] = [fib2K, fibK];           // F(k) = F(2k)
      [fibK1, fib2K1] = [fib2K1, fibK1];       // F(k+1) = F(2k+1)
    }
  }

  for (const x of [fibK1, fib2K, fib2K1]) {    // free everything except the result
    gmp.mpfr_clear(x);
    gmp.mpfr_t_free(x);
  }
  return fibK;                                 // k = n now, so this is F(n)
}

export function mpfrBinet(gmp, n) {
  // Binet's formula: F(n) = (φⁿ − ψⁿ) / √5, where φ = (1 + √5) / 2 is the golden ratio
  // and ψ = (1 − √5) / 2. Since |ψⁿ / √5| is always below 0.5, F(n) is simply
  // φⁿ / √5 rounded to the nearest whole number.
  //
  // MPFR functions write their result into a number you pass in: mpfr_add(x, y, z) sets x = y + z.
  const RNDN = 0; // MPFR_RNDN: round every result to the nearest value
  const sqrt5 = gmp.mpfr_t(), result = gmp.mpfr_t();
  gmp.mpfr_init2(sqrt5, FLOAT_BITS);           // precision: 213 bits, about 64 significant digits
  gmp.mpfr_init2(result, FLOAT_BITS);

  gmp.mpfr_sqrt_ui(sqrt5, 5, RNDN);            // √5
  gmp.mpfr_add_ui(result, sqrt5, 1, RNDN);     // 1 + √5
  gmp.mpfr_div_2ui(result, result, 1, RNDN);   // φ = (1 + √5) / 2   (div_2ui divides by 2¹)
  gmp.mpfr_pow_ui(result, result, n, RNDN);    // φⁿ
  gmp.mpfr_div(result, result, sqrt5, RNDN);   // φⁿ / √5
  // Past 213 bits, φⁿ / √5 has no fractional part left to round, and rint changes nothing.
  gmp.mpfr_rint(result, result, RNDN);         // rounded to the nearest whole number

  gmp.mpfr_clear(sqrt5);
  gmp.mpfr_t_free(sqrt5);
  return result;
}
