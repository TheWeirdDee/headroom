// Exact decimal arithmetic for money, rates and ratios. Every amount in Headroom is a DecimalString
// ("1234.50"); floating point is never used on money (lint rule in eslint.config.js).
import { Decimal as DecimalBase } from 'decimal.js';

export type DecimalString = string;
export type Rounding = 'half_up' | 'half_even';

const Decimal = DecimalBase.clone({ precision: 60, rounding: DecimalBase.ROUND_HALF_UP });
type Dec = InstanceType<typeof Decimal>;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export class MoneyFormatError extends Error {
  constructor(input: string) {
    super(`Not a decimal string: "${input}"`);
    this.name = 'MoneyFormatError';
  }
}

export function isDecimalString(s: unknown): s is DecimalString {
  return typeof s === 'string' && DECIMAL_RE.test(s);
}

function d(s: DecimalString): Dec {
  if (!isDecimalString(s)) throw new MoneyFormatError(String(s));
  return new Decimal(s);
}

function out(x: Dec): DecimalString {
  // toFixed() without arguments never uses exponent notation.
  const s = x.toFixed();
  return s === '-0' ? '0' : s;
}

export function add(...xs: DecimalString[]): DecimalString {
  return out(xs.reduce<Dec>((acc, x) => acc.plus(d(x)), new Decimal(0)));
}

export function sub(a: DecimalString, b: DecimalString): DecimalString {
  return out(d(a).minus(d(b)));
}

export function mul(a: DecimalString, b: DecimalString): DecimalString {
  return out(d(a).times(d(b)));
}

/** Exact-as-possible division, rounded to `places` decimals with the given mode. */
export function div(
  a: DecimalString,
  b: DecimalString,
  places: number,
  mode: Rounding = 'half_up',
): DecimalString {
  const divisor = d(b);
  if (divisor.isZero()) throw new RangeError('Division by zero');
  return round(out(d(a).dividedBy(divisor)), places, mode);
}

export function round(a: DecimalString, places: number, mode: Rounding): DecimalString {
  const rm = mode === 'half_even' ? Decimal.ROUND_HALF_EVEN : Decimal.ROUND_HALF_UP;
  return d(a).toDecimalPlaces(places, rm).toFixed(places);
}

/** Money to two decimals (RSD amounts in the KPO book and on the card). */
export function money(a: DecimalString, mode: Rounding = 'half_up'): DecimalString {
  return round(a, 2, mode);
}

export function cmp(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const c = d(a).comparedTo(d(b));
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

export function eq(a: DecimalString, b: DecimalString): boolean {
  return cmp(a, b) === 0;
}

export function isPositive(a: DecimalString): boolean {
  return d(a).greaterThan(0);
}

export function isZero(a: DecimalString): boolean {
  return d(a).isZero();
}

export function neg(a: DecimalString): DecimalString {
  return out(d(a).negated());
}

export function max(a: DecimalString, b: DecimalString): DecimalString {
  return cmp(a, b) >= 0 ? a : b;
}

/** Canonical form for comparison and storage: no leading zeros, no trailing fractional zeros. */
export function canonical(a: DecimalString): DecimalString {
  return out(d(a));
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Serbian display format (sr-Latn-RS): dot for thousands, comma for decimals.
 * formatSr("5412300", 2) -> "5.412.300,00". Data stays dot-decimal; this is display only.
 */
export function formatSr(a: DecimalString, places = 2, mode: Rounding = 'half_up'): string {
  const r = round(a, places, mode);
  const negative = r.startsWith('-');
  const body = negative ? r.slice(1) : r;
  const [intPart = '0', frac] = body.split('.');
  const text = groupThousands(intPart) + (frac !== undefined ? `,${frac}` : '');
  return negative && !/^[0.,]+$/.test(text) ? `-${text}` : text;
}

export function formatRsd(a: DecimalString): string {
  return `${formatSr(a, 2)} RSD`;
}

/** A ratio (0.9012) as a Serbian percentage string with one decimal: "90,1%". */
export function formatPercentSr(ratio: DecimalString, places = 1): string {
  return `${formatSr(mul(ratio, '100'), places)}%`;
}
