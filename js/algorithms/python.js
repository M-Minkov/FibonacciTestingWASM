// Python source code, run in the browser by Pyodide (CPython compiled to WebAssembly).
// Each string defines fib(n); the worker runs it. PY_DOUBLING and PY_GMPY2 are BigInt mode,
// PY_DECIMAL and PY_MPFR are float mode. The page shows each string exactly as written here.

export const PY_DOUBLING = `def fib(n):
    # Fast doubling: from F(k) and F(k+1), two identities give F(2k) and F(2k+1):
    #   F(2k)   = F(k) · (2·F(k+1) − F(k))
    #   F(2k+1) = F(k)² + F(k+1)²
    # Going through the binary digits of n, most significant first, each digit doubles k,
    # and a 1 digit then adds one. After the last digit, k = n.
    fib_k, fib_k1 = 0, 1                          # F(k), F(k+1), starting at k = 0
    for bit in bin(n)[2:]:                        # bin(5) is "0b101": skip the "0b"
        fib_2k = fib_k * (2 * fib_k1 - fib_k)     # F(2k)
        fib_2k1 = fib_k * fib_k + fib_k1 * fib_k1 # F(2k+1)
        if bit == "1":                            # k → 2k + 1
            fib_k, fib_k1 = fib_2k1, fib_2k + fib_2k1
        else:                                     # k → 2k
            fib_k, fib_k1 = fib_2k, fib_2k1
    return fib_k                                  # k = n now, so this is F(n)`;

export const PY_GMPY2 = `import gmpy2

def fib(n):
    return gmpy2.fib(n)  # a thin wrapper around GMP's own Fibonacci function, mpz_fib_ui`;

export const PY_DECIMAL = `from decimal import Decimal, getcontext, MAX_EMAX

getcontext().prec = 64        # every result is rounded to 64 significant digits
getcontext().Emax = MAX_EMAX  # allow the largest exponent possible: 10^425,000,000 on 32-bit WASM

def fib(n):
    # Fast doubling, the same as the plain Python version but with Decimal floats:
    #   F(2k)   = F(k) · (2·F(k+1) − F(k))
    #   F(2k+1) = F(k)² + F(k+1)²
    fib_k, fib_k1 = Decimal(0), Decimal(1)        # F(k), F(k+1), starting at k = 0
    for bit in bin(n)[2:]:                        # bin(5) is "0b101": skip the "0b"
        fib_2k = fib_k * (2 * fib_k1 - fib_k)     # F(2k)
        fib_2k1 = fib_k * fib_k + fib_k1 * fib_k1 # F(2k+1)
        if bit == "1":                            # k → 2k + 1
            fib_k, fib_k1 = fib_2k1, fib_2k + fib_2k1
        else:                                     # k → 2k
            fib_k, fib_k1 = fib_2k, fib_2k1
    return fib_k                                  # k = n now, so this is F(n)`;

export const PY_MPFR = `import gmpy2
from gmpy2 import mpfr

gmpy2.get_context().precision = 213              # bits, about 64 significant digits
gmpy2.get_context().emax = gmpy2.get_emax_max()  # allow the largest exponent possible: 2^1,073,741,823

def fib(n):
    # Binet's formula: F(n) = (φⁿ − ψⁿ) / √5, where φ = (1 + √5) / 2 is the golden ratio
    # and ψ = (1 − √5) / 2. Since |ψⁿ / √5| is always below 0.5, F(n) is simply
    # φⁿ / √5 rounded to the nearest whole number.
    sqrt5 = gmpy2.sqrt(mpfr(5))
    phi = (1 + sqrt5) / 2
    # Past 213 bits, φⁿ / √5 has no fractional part left to round, and rint changes nothing.
    return gmpy2.rint(phi ** n / sqrt5)`;
