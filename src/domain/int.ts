// The one place domain code turns digit strings into integers (dates, counters, parity). Money and
// rates never go through here: they stay decimal strings (src/domain/money.ts).
export class IntFormatError extends Error {
  constructor(input: string) {
    super(`Not a non-negative integer: "${input}"`);
    this.name = 'IntFormatError';
  }
}

export function parseDigits(s: string): number {
  if (!/^\d{1,15}$/.test(s)) throw new IntFormatError(s);
  // eslint-disable-next-line no-restricted-syntax -- validated digit string, at most 15 digits: exact
  return Number(s);
}
