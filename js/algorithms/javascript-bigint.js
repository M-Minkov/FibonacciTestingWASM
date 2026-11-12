// Pure JavaScript with the built-in BigInt type: exact whole numbers, no libraries (BigInt mode).
//
// The page shows each function's source under its "About", and only what is inside the function,
// so the explanations live in comments inside the function bodies.

export function fibIterative(n) {
  // Start from F(0) = 0 and F(1) = 1, and step forward one number at a time:
  // each new Fibonacci number is the sum of the two before it.
  let current = 0n; // F(i), starting at i = 0
  let next = 1n;    // F(i + 1)
  for (let i = 0; i < n; i++) {
    const afterNext = current + next; // F(i + 2)
    current = next;
    next = afterNext;
  }
  return current;   // i = n now, so this is F(n)
}

export function fibMatrix(n) {
  // The matrix Q = [[1, 1], [1, 0]] raised to the power k is [[F(k+1), F(k)], [F(k), F(k-1)]],
  // so F(n) is the top-right entry of Q^n.
  //
  // Q^n is built from the binary digits of n, most significant first. Each digit doubles
  // the power so far (Q^k squared is Q^2k), and a 1 digit then adds one more (Q^2k · Q = Q^(2k+1)).
  // That takes about log₂(n) steps instead of n.
  const multiply = ([[a, b], [c, d]], [[e, f], [g, h]]) => [ // 2×2 matrix product
    [a * e + b * g, a * f + b * h],
    [c * e + d * g, c * f + d * h],
  ];
  const Q = [[1n, 1n], [1n, 0n]];
  let power = [[1n, 0n], [0n, 1n]];             // Q^0, the identity matrix
  for (const bit of n.toString(2)) {            // the binary digits of n, most significant first
    power = multiply(power, power);             // Q^k → Q^2k
    if (bit === '1') power = multiply(power, Q); // Q^2k → Q^(2k+1)
  }
  return power[0][1];                           // the top-right entry of Q^n: F(n)
}

export function fibDoubling(n) {
  // Fast doubling: from F(k) and F(k+1), two identities give F(2k) and F(2k+1):
  //   F(2k)   = F(k) · (2·F(k+1) − F(k))
  //   F(2k+1) = F(k)² + F(k+1)²
  // Going through the binary digits of n, most significant first, each digit doubles k,
  // and a 1 digit then adds one. After the last digit, k = n.
  // That is about log₂(n) steps of 3 multiplications each.
  let fibK = 0n;  // F(k), starting at k = 0
  let fibK1 = 1n; // F(k + 1)
  for (const bit of n.toString(2)) {
    const fib2K = fibK * (2n * fibK1 - fibK);   // F(2k)
    const fib2K1 = fibK * fibK + fibK1 * fibK1; // F(2k + 1)
    if (bit === '1') {                          // k → 2k + 1
      fibK = fib2K1;
      fibK1 = fib2K + fib2K1;                   // F(2k + 2) = F(2k) + F(2k + 1)
    } else {                                    // k → 2k
      fibK = fib2K;
      fibK1 = fib2K1;
    }
  }
  return fibK;    // k = n now, so this is F(n)
}
