import { parseDigits } from './int.ts';

// Calendar dates as ISO strings (YYYY-MM-DD). No time zones, no Date arithmetic on local time:
// dates are converted to a day number (days since 1970-01-01, UTC calendar) for comparison.

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class DateFormatError extends Error {
  constructor(input: string) {
    super(`Not a valid ISO date (YYYY-MM-DD): "${input}"`);
    this.name = 'DateFormatError';
  }
}

export interface Ymd {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

export function parseIso(s: string): Ymd {
  const m = ISO_RE.exec(s);
  if (!m) throw new DateFormatError(s);
  const [, ys = '', ms = '', ds = ''] = m;
  const ymd = { y: parseDigits(ys), m: parseDigits(ms), d: parseDigits(ds) };
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) throw new DateFormatError(s);
  return ymd;
}

export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string') return false;
  try {
    parseIso(s);
    return true;
  } catch {
    return false;
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

export function toIso({ y, m, d }: Ymd): IsoDate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Days since 1970-01-01 in the proleptic Gregorian calendar. */
export function dayNumber(s: IsoDate): number {
  const { y, m, d } = parseIso(s);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function fromDayNumber(n: number): IsoDate {
  const dt = new Date(n * 86_400_000);
  return toIso({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

export function addDays(s: IsoDate, n: number): IsoDate {
  return fromDayNumber(dayNumber(s) + n);
}

/** Add calendar months; the day is clamped to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s: IsoDate, n: number): IsoDate {
  const { y, m, d } = parseIso(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toIso({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

export function compareIso(a: IsoDate, b: IsoDate): number {
  return dayNumber(a) - dayNumber(b);
}

export function isBetween(s: IsoDate, from: IsoDate, to: IsoDate): boolean {
  const n = dayNumber(s);
  return n >= dayNumber(from) && n <= dayNumber(to);
}

export function yearOf(s: IsoDate): number {
  return parseIso(s).y;
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(s: IsoDate): number {
  const wd = new Date(dayNumber(s) * 86_400_000).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function isWeekend(s: IsoDate): boolean {
  return isoWeekday(s) >= 6;
}

export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

export interface DateWindow {
  from: IsoDate;
  to: IsoDate;
}

/**
 * VAT "previous 12 months" window ending on `asOf` inclusive (rule R-VAT-8M).
 * '365d': 365 or 366 days, from the day after the same date one year earlier, through `asOf`
 *   (Tax Administration example: invoice on 18.08.2023 -> period 19.08.2022 to 18.08.2023).
 * '12m': twelve calendar months ending with the month of `asOf` (first day of the month 11 months
 *   earlier through `asOf`), kept as a switchable alternative.
 */
export function vatWindow(asOf: IsoDate, mode: '365d' | '12m'): DateWindow {
  if (mode === '365d') return { from: addDays(addMonths(asOf, -12), 1), to: asOf };
  const { y, m } = parseIso(addMonths(asOf, -11));
  return { from: toIso({ y, m, d: 1 }), to: asOf };
}

/**
 * Criterion 6 windows: every 12-calendar-month period that starts or ends in the tax year
 * ("u periodu od 12 meseci koji počinje ili se završava u odnosnoj poreskoj godini", ZPDG 85(1)(17)(6)).
 * For 2026: starts from 2025-02-01 (ends 2026-01-31) through 2026-12-01 (ends 2027-11-30); 23 windows.
 */
export function twelveMonthWindowsForTaxYear(year: number): DateWindow[] {
  const out: DateWindow[] = [];
  let start = toIso({ y: year - 1, m: 2, d: 1 });
  const last = toIso({ y: year, m: 12, d: 1 });
  while (compareIso(start, last) <= 0) {
    const endMonthStart = addMonths(start, 11);
    const { y, m } = parseIso(endMonthStart);
    out.push({ from: start, to: toIso({ y, m, d: daysInMonth(y, m) }) });
    start = addMonths(start, 1);
  }
  return out;
}

export function yearWindow(year: number): DateWindow {
  return { from: toIso({ y: year, m: 1, d: 1 }), to: toIso({ y: year, m: 12, d: 31 }) };
}

/** Today's date in Belgrade (NBS time zone), used to refuse rate requests for future dates. */
export function todayInBelgrade(now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Belgrade',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Serbian display format: 26.11.2026. */
export function formatDateSr(s: IsoDate): string {
  const { y, m, d } = parseIso(s);
  return `${pad(d)}.${pad(m)}.${y}.`;
}
