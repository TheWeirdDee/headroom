// R-FX: conversion at the NBS middle rate, parsing of Kurs API responses without floating point,
// and the implied-rate check RateClerk uses for E5.
import { cmp, div, isDecimalString, money, mul, sub, type DecimalString, type Rounding } from './money.ts';
import { parseDigits } from './int.ts';
import { compareIso, isIsoDate, type IsoDate } from './dates.ts';
import type { FxDateRule } from './types.ts';

export interface KursRate {
  code: string;
  requestedDate: IsoDate;
  rateDate: IsoDate;
  middle: DecimalString;
  parity: number;
}

export class KursParseError extends Error {
  constructor(detail: string) {
    super(`Kurs response not understood: ${detail}`);
    this.name = 'KursParseError';
  }
}

function field(raw: string, name: string, pattern: string): string {
  const m = new RegExp(`"${name}"\\s*:\\s*(${pattern})(?=\\s*[,}])`).exec(raw);
  if (!m?.[1]) throw new KursParseError(`missing "${name}"`);
  return m[1];
}

/**
 * Parse a Kurs daily-rate body from its raw text. Numbers are read as decimal strings straight from the
 * text so the rate is never rounded through a binary float.
 */
export function parseKursRate(raw: string, expectedCode?: string): KursRate {
  const code = field(raw, 'code', '"[A-Z]{3}"').slice(1, -1);
  if (expectedCode !== undefined && code !== expectedCode.toUpperCase()) {
    throw new KursParseError(`asked for ${expectedCode}, got ${code}`);
  }
  const requestedDate = field(raw, 'date', '"\\d{4}-\\d{2}-\\d{2}"').slice(1, -1);
  const rateDate = field(raw, 'date_from', '"\\d{4}-\\d{2}-\\d{2}"').slice(1, -1);
  const middle = field(raw, 'exchange_middle', '-?\\d+(?:\\.\\d+)?');
  const parityText = field(raw, 'parity', '\\d+');
  if (!isIsoDate(requestedDate) || !isIsoDate(rateDate)) throw new KursParseError('bad date');
  if (!isDecimalString(middle) || cmp(middle, '0') <= 0) throw new KursParseError('bad exchange_middle');
  const parity = parseDigits(parityText);
  if (parity < 1) throw new KursParseError('bad parity');
  if (compareIso(rateDate, requestedDate) > 0) throw new KursParseError('rate date after requested date');
  return { code, requestedDate, rateDate, middle, parity };
}

/** amountRSD = round(amount x rate / parity, 2). */
export function convertToRsd(
  amount: DecimalString,
  rate: DecimalString,
  parity: number,
  rounding: Rounding,
): DecimalString {
  const perUnit = parity === 1 ? rate : div(rate, String(parity), 12, rounding);
  return money(mul(amount, perUnit), rounding);
}

/** The rate a booked RSD amount implies for a foreign amount, to 4 decimals (NBS precision). */
export function impliedRate(amountRsd: DecimalString, amountForeign: DecimalString): DecimalString {
  return div(amountRsd, amountForeign, 4, 'half_up');
}

/** Which date the rate is taken for, per the configured rule (R-FX-DATE, an assumption). */
export function fxDate(
  rule: FxDateRule,
  dates: { issueDate: IsoDate; supplyDate?: IsoDate; paymentDate?: IsoDate },
): IsoDate | undefined {
  switch (rule) {
    case 'invoice_issue_date':
      return dates.issueDate;
    case 'supply_date':
      return dates.supplyDate ?? dates.issueDate;
    case 'payment_date':
      return dates.paymentDate;
  }
}

/** Kurs returns the latest rate for future dates; Headroom refuses them (rate not yet published). */
export function isRateRequestable(requested: IsoDate, todayBelgrade: IsoDate): boolean {
  return compareIso(requested, todayBelgrade) <= 0;
}

export type E5Finding =
  | { kind: 'matches_payment_date_rate'; impliedRate: DecimalString }
  | { kind: 'other_rate'; impliedRate: DecimalString };

/**
 * E5: the book's RSD amount for a foreign invoice differs from the NBS conversion. Classify the rate the
 * book used: the payment-date NBS rate (a common mistake) or some other rate (e.g. a bank's rate).
 */
export function classifyBookedRate(args: {
  bookedRsd: DecimalString;
  amountForeign: DecimalString;
  rounding: Rounding;
  paymentDateRate?: { middle: DecimalString; parity: number };
}): E5Finding {
  const implied = impliedRate(args.bookedRsd, args.amountForeign);
  if (args.paymentDateRate) {
    const atPayment = convertToRsd(
      args.amountForeign,
      args.paymentDateRate.middle,
      args.paymentDateRate.parity,
      args.rounding,
    );
    if (cmp(sub(atPayment, args.bookedRsd), '0') === 0) {
      return { kind: 'matches_payment_date_rate', impliedRate: implied };
    }
  }
  return { kind: 'other_rate', impliedRate: implied };
}
