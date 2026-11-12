// The Fibonacci implementations, one file per language or library. Imported by the workers (to run them)
// and by the page (to show their source code), so the code you read on the page is the code that runs.
//
// - javascript-bigint.js:  pure JavaScript, built-in BigInt (exact)
// - javascript-decimal.js: JavaScript with decimal.js floats
// - python.js:             Python, run by Pyodide (plain ints, gmpy2, decimal, MPFR)
// - gmp-wasm.js:           GMP and MPFR compiled to WebAssembly
// - precision.js:          the shared float-mode precision settings
export * from './precision.js';
export * from './javascript-bigint.js';
export * from './javascript-decimal.js';
export * from './python.js';
export * from './gmp-wasm.js';
