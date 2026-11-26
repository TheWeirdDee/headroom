// Code-only parsing of amounts and dates found in user files and documents. A value that cannot be
// parsed is an error with its location; nothing is guessed (PRD 12.6).
import { canonical, isDecimalString, type DecimalString } from '../domain/money.ts';
import { isIsoDate, type IsoDate } from '../domain/dates.ts';

export type DecimalSeparator = ',' | '.';
export type DateFormat = 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY';

export const DATE_FORMATS: DateFormat[] = [
  'YYYY-MM-DD',
  'DD.MM.YYYY',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
];

/**
 * Parse an amount written with the given decimal separator. Thousands separators (the other of '.' and
 * ',', spaces, non-breaking spaces, apostrophes) are removed only when they group digits in threes.
 * Returns undefined when the text is not an unambiguous amount.
 */
export function parseAmount(text: string, decimal: DecimalSeparator): DecimalString | undefined {
  let s = text.trim().replace(/\u00a0|\u202f/g, ' ');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) s = s.slice(1).trim();
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  const group = decimal === ',' ? '.' : ',';
  const groupRe = new RegExp(`^\\d{1,3}(?:[${group === '.' ? '\\.' : ','} ']\\d{3})+(?:\\${decimal}\\d+)?$`);
  const plainRe = new RegExp(`^\\d+(?:\\${decimal}\\d+)?$`);
  let body: string;
  if (plainRe.test(s)) body = s;
  else if (groupRe.test(s)) body = s.replace(new RegExp(`[${group === '.' ? '\\.' : ','} ']`, 'g'), '');
  else return undefined;
  const normalised = decimal === ',' ? body.replace(',', '.') : body;
  if (!isDecimalString(normalised)) return undefined;
  const c = canonical(normalised);
  return negative && c !== '0' ? `-${c}` : c;
}

/** Parse a date in the given format into ISO, refusing impossible dates. */
export function parseDate(text: string, format: DateFormat): IsoDate | undefined {
  const s = text.trim().replace(/\.$/, '');
  const patterns: Record<DateFormat, RegExp> = {
    'YYYY-MM-DD': /^(?<y>\d{4})-(?<m>\d{1,2})-(?<d>\d{1,2})$/,
    'DD.MM.YYYY': /^(?<d>\d{1,2})\.\s?(?<m>\d{1,2})\.\s?(?<y>\d{4})$/,
    'DD/MM/YYYY': /^(?<d>\d{1,2})\/(?<m>\d{1,2})\/(?<y>\d{4})$/,
    'MM/DD/YYYY': /^(?<m>\d{1,2})\/(?<d>\d{1,2})\/(?<y>\d{4})$/,
    'DD-MM-YYYY': /^(?<d>\d{1,2})-(?<m>\d{1,2})-(?<y>\d{4})$/,
  };
  const g = patterns[format].exec(s)?.groups;
  if (!g?.['y'] || !g['m'] || !g['d']) return undefined;
  const iso = `${g['y']}-${g['m'].padStart(2, '0')}-${g['d'].padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : undefined;
}

/** Every amount-like token in a text, under both separator conventions (used by fidelity checks). */
export function amountsIn(text: string): Set<DecimalString> {
  const out = new Set<DecimalString>();
  for (const m of text.matchAll(/\d[\d.,' \u00a0]*\d|\d/g)) {
    const token = m[0].trim();
    for (const sep of [',', '.'] as const) {
      const v = parseAmount(token, sep);
      if (v !== undefined) out.add(v);
    }
  }
  return out;
}

/** Every date-like token in a text, under every supported format. */
export function datesIn(text: string): Set<IsoDate> {
  const out = new Set<IsoDate>();
  for (const m of text.matchAll(/\d{1,4}[./-]\s?\d{1,2}[./-]\s?\d{1,4}\.?/g)) {
    for (const f of DATE_FORMATS) {
      const v = parseDate(m[0], f);
      if (v) out.add(v);
    }
  }
  return out;
}
