// JavaScript with decimal.js, an arbitrary-precision decimal float library (float mode).
// BigFloat is decimal.js set to 64 significant digits; see precision.js.
//
// These are the same algorithms as in javascript-bigint.js. decimal.js has no operators, so
// a + b is written a.plus(b), a · b is a.times(b), and so on. Every result is rounded to 64 digits.
//
// The page shows each function's source under its "About", and only what is inside the function,
// so the explanations live in comments inside the function bodies.
import { BigFloat } from './precision.js';

export function fibIterativeFloat(n) {
  // Step forward one number at a time: each Fibonacci number is the sum of the two before it.
  // Every sum is rounded to 64 significant digits, so the small rounding errors add up over n steps.
  let current = new BigFloat(0); // F(i), starting at i = 0
  let next = new BigFloat(1);    // F(i + 1)
  for (let i = 0; i < n; i++) {
    const afterNext = current.plus(next); // F(i + 2)
    current = next;
    next = afterNext;
  }
  return current;                // i = n now, so this is F(n)
}

export function fibMatrixFloat(n) {
  // The matrix Q = [[1, 1], [1, 0]] raised to the power k is [[F(k+1), F(k)], [F(k), F(k-1)]],
  // so F(n) is the top-right entry of Q^n.
  //
  // Q^n is built from the binary digits of n, most significant first. Each digit doubles
  // the power so far (Q^k squared is Q^2k), and a 1 digit then adds one more (Q^2k · Q = Q^(2k+1)).
  const multiply = ([[a, b], [c, d]], [[e, f], [g, h]]) => [ // 2×2 matrix product
    [a.times(e).plus(b.times(g)), a.times(f).plus(b.times(h))], // [a·e + b·g, a·f + b·h]
    [c.times(e).plus(d.times(g)), c.times(f).plus(d.times(h))], // [c·e + d·g, c·f + d·h]
  ];
  const zero = new BigFloat(0), one = new BigFloat(1);
  const Q = [[one, one], [one, zero]];
  let power = [[one, zero], [zero, one]];       // Q^0, the identity matrix
  for (const bit of n.toString(2)) {            // the binary digits of n, most significant first
    power = multiply(power, power);             // Q^k → Q^2k
    if (bit === '1') power = multiply(power, Q); // Q^2k → Q^(2k+1)
  }
  return power[0][1];                           // the top-right entry of Q^n: F(n)
}

export function fibDoublingFloat(n) {
  // Fast doubling: from F(k) and F(k+1), two identities give F(2k) and F(2k+1):
  //   F(2k)   = F(k) · (2·F(k+1) − F(k))
  //   F(2k+1) = F(k)² + F(k+1)²
  // Going through the binary digits of n, most significant first, each digit doubles k,
  // and a 1 digit then adds one. After the last digit, k = n.
  let fibK = new BigFloat(0);  // F(k), starting at k = 0
  let fibK1 = new BigFloat(1); // F(k + 1)
  for (const bit of n.toString(2)) {
    const fib2K = fibK.times(fibK1.times(2).minus(fibK));     // F(2k)
    const fib2K1 = fibK.times(fibK).plus(fibK1.times(fibK1)); // F(2k + 1)
    if (bit === '1') {                                        // k → 2k + 1
      fibK = fib2K1;
      fibK1 = fib2K.plus(fib2K1);                             // F(2k + 2) = F(2k) + F(2k + 1)
    } else {                                                  // k → 2k
      fibK = fib2K;
      fibK1 = fib2K1;
    }
  }
  return fibK;                 // k = n now, so this is F(n)
}

export function fibBinetFloat(n) {
  // Binet's formula: F(n) = (φⁿ − ψⁿ) / √5, where φ = (1 + √5) / 2 is the golden ratio
  // and ψ = (1 − √5) / 2. Since |ψⁿ / √5| is always below 0.5, F(n) is simply
  // φⁿ / √5 rounded to the nearest whole number.
  const sqrt5 = new BigFloat(5).sqrt();
  const phi = sqrt5.plus(1).div(2);             // φ
  const estimate = phi.pow(n).div(sqrt5);       // φⁿ / √5
  // Past 64 digits, the estimate has no fractional part left to round, and round() changes nothing.
  return estimate.round();
}
