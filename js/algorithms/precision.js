// Shared settings for float mode, used by every float method so they all work at the same precision.
//
// Two modes:
// - BigInt mode: whole-number types with no size limit. Every answer is exact, every digit.
// - Float mode: floating-point types with a fixed precision of 64 significant digits (decimal types)
//   or 213 bits (binary types, about 64.1 digits), the same in every method. The answer is rounded,
//   but its first 50 digits are expected to be correct; the page checks that for every run.
import Decimal from '../vendor/decimal-10.6.0.mjs';

export const FLOAT_DIGITS = 64;   // significant digits for the decimal float types
export const FLOAT_BITS = 213;    // the same precision in bits, for MPFR: 213 · log10(2) ≈ 64.1 digits
export const CHECKED_DIGITS = 50; // leading digits that every float method must get right

// decimal.js, an arbitrary-precision decimal float for JavaScript, set to 64 significant digits
export const BigFloat = Decimal.clone({ precision: FLOAT_DIGITS });
