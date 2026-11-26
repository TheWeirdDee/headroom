import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  add,
  canonical,
  cmp,
  div,
  formatPercentSr,
  formatRsd,
  formatSr,
  isDecimalString,
  money,
  mul,
  round,
  sub,
  MoneyFormatError,
} from '../../src/domain/money.ts';

describe('money arithmetic is exact', () => {
  it('adds without binary float error', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(add('5999999.99', '0.01')).toBe('6000000');
    expect(add()).toBe('0');
  });

  it('multiplies an amount by a 4-decimal NBS rate exactly', () => {
    expect(mul('1234.56', '117.6412')).toBe('145235.119872');
  });

  it('rounds half up and half even as configured', () => {
    expect(round('2.345', 2, 'half_up')).toBe('2.35');
    expect(round('2.345', 2, 'half_even')).toBe('2.34');
    expect(round('-2.345', 2, 'half_up')).toBe('-2.35');
    expect(money('10')).toBe('10.00');
  });

  it('divides with rounding and refuses division by zero', () => {
    expect(div('5400000', '6000000', 6)).toBe('0.900000');
    expect(() => div('1', '0', 2)).toThrow(RangeError);
  });

  it('rejects anything that is not a decimal string', () => {
    for (const bad of ['1e5', '1,5', ' 1', '', 'NaN', '1.', '.5']) {
      expect(isDecimalString(bad)).toBe(false);
      expect(() => add(bad)).toThrow(MoneyFormatError);
    }
  });

  it('compares and canonicalises', () => {
    expect(cmp('10.50', '10.5')).toBe(0);
    expect(cmp('9.99', '10')).toBe(-1);
    expect(canonical('0010.500')).toBe('10.5');
    expect(sub('1', '1')).toBe('0');
  });
});

describe('Serbian display format (sr-Latn-RS)', () => {
  it('uses dot for thousands and comma for decimals', () => {
    expect(formatSr('5412300')).toBe('5.412.300,00');
    expect(formatSr('999.995')).toBe('1.000,00');
    expect(formatSr('-1234.5')).toBe('-1.234,50');
    expect(formatSr('0.004')).toBe('0,00');
    expect(formatRsd('6000000')).toBe('6.000.000,00 RSD');
    expect(formatPercentSr('0.9012')).toBe('90,1%');
  });
});

const amount = fc
  .tuple(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 99 }))
  .map(([i, f]) => `${i}.${String(f).padStart(2, '0')}`);

describe('properties', () => {
  it('sums are order independent', () => {
    fc.assert(
      fc.property(fc.array(amount, { minLength: 1, maxLength: 30 }), (xs) => {
        const reversed = [...xs].reverse();
        expect(add(...xs)).toBe(add(...reversed));
      }),
    );
  });

  it('conversion is monotonic in the amount', () => {
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        const rate = '117.6412';
        const [lo, hi] = cmp(a, b) <= 0 ? [a, b] : [b, a];
        expect(cmp(money(mul(lo, rate)), money(mul(hi, rate)))).toBeLessThanOrEqual(0);
      }),
    );
  });

  it('formatting round-trips to the same value', () => {
    fc.assert(
      fc.property(amount, (a) => {
        const back = formatSr(a).replace(/\./g, '').replace(',', '.');
        expect(cmp(back, a)).toBe(0);
      }),
    );
  });
});
