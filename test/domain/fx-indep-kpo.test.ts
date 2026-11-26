import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyBookedRate,
  convertToRsd,
  fxDate,
  impliedRate,
  isRateRequestable,
  parseKursRate,
  KursParseError,
} from '../../src/domain/fx.ts';
import {
  countCriteria,
  criterion6Met,
  criterion6Windows,
  independenceStatus,
  maxShare,
  type IncomeFact,
} from '../../src/domain/independence.ts';
import { buildKpoBook, checkExistingRow, existingRowKind, KpoRowError } from '../../src/domain/kpo.ts';
import { duplicateMatches, missingFromBook, numberingGaps } from '../../src/domain/discrepancies.ts';
import {
  InvalidInvoiceNumberError,
  isValidInvoiceNumber,
  keys,
  normalizeInvoiceNumber,
  parseKey,
} from '../../src/domain/keys.ts';

const fixture = (name: string): string => readFileSync(join('test/fixtures/kurs', name), 'utf8');

describe('Kurs parsing (recorded responses)', () => {
  it('reads the middle rate as an exact decimal string', () => {
    expect(parseKursRate(fixture('eur-2026-11-20.json'))).toEqual({
      code: 'EUR',
      requestedDate: '2026-11-20',
      rateDate: '2026-11-20',
      middle: '117.6412',
      parity: 1,
    });
  });

  it('weekend and holiday requests carry the last published date', () => {
    expect(parseKursRate(fixture('eur-2026-11-22.json')).rateDate).toBe('2026-11-20');
    expect(parseKursRate(fixture('eur-2026-01-07.json')).rateDate).toBe('2026-01-05');
    expect(parseKursRate(fixture('eur-2026-02-16.json')).rateDate).toBe('2026-02-13');
  });

  it('refuses exponent numbers and a currency other than the one asked for', () => {
    const raw = fixture('eur-2026-11-20.json');
    expect(() =>
      parseKursRate(raw.replace('"exchange_middle":117.6412', '"exchange_middle":1.176412e2')),
    ).toThrow(KursParseError);
    expect(() => parseKursRate(raw, 'USD')).toThrow(/asked for USD, got EUR/);
    expect(parseKursRate(raw, 'eur').middle).toBe('117.6412');
  });

  it('refuses error bodies and future dates', () => {
    expect(() => parseKursRate(fixture('xyz-404.json'))).toThrow(KursParseError);
    const future = parseKursRate(fixture('eur-2030-01-01-future.json'));
    expect(future.rateDate).toBe('2026-11-26');
    expect(isRateRequestable('2030-01-01', '2026-11-26')).toBe(false);
    expect(isRateRequestable('2026-11-26', '2026-11-26')).toBe(true);
  });
});

describe('R-FX conversion and E5', () => {
  it('converts at the middle rate and rounds to two decimals', () => {
    expect(convertToRsd('4000', '117.6412', 1, 'half_up')).toBe('470564.80');
    expect(convertToRsd('1234.56', '117.6412', 1, 'half_up')).toBe('145235.12');
    expect(convertToRsd('100', '75.1234', 100, 'half_up')).toBe('75.12');
    expect(convertToRsd('1', '0.125', 1, 'half_up')).toBe('0.13');
    expect(convertToRsd('1', '0.125', 1, 'half_even')).toBe('0.12');
    expect(convertToRsd('3', '75.125', 100, 'half_even')).toBe('2.25');
  });

  it('picks the rate date per rule', () => {
    const d = { issueDate: '2026-03-14', supplyDate: '2026-03-13', paymentDate: '2026-04-02' };
    expect(fxDate('invoice_issue_date', d)).toBe('2026-03-14');
    expect(fxDate('supply_date', d)).toBe('2026-03-13');
    expect(fxDate('supply_date', { issueDate: '2026-03-14' })).toBe('2026-03-14');
    expect(fxDate('payment_date', d)).toBe('2026-04-02');
  });

  it('classifies a booked amount that used the payment-date rate', () => {
    // Invoice 4000 EUR dated 2026-11-17 (117.6123); paid 2026-11-20 (117.6412). Book used the payment rate.
    const booked = convertToRsd('4000', '117.6412', 1, 'half_up');
    expect(
      classifyBookedRate({
        bookedRsd: booked,
        amountForeign: '4000',
        rounding: 'half_up',
        paymentDateRate: { middle: '117.6412', parity: 1 },
      }),
    ).toEqual({ kind: 'matches_payment_date_rate', impliedRate: '117.6412' });
    expect(
      classifyBookedRate({ bookedRsd: '472000.00', amountForeign: '4000', rounding: 'half_up' }),
    ).toEqual({
      kind: 'other_rate',
      impliedRate: '118.0000',
    });
    expect(impliedRate('470449.20', '4000')).toBe('117.6123');
  });
});

describe('criterion 6 and status (R-INDEP)', () => {
  const income = (clientId: string, date: string, amountRSD: string): IncomeFact => ({
    clientId,
    date,
    amountRSD,
    figureIds: [`${clientId}-${date}`],
  });

  it('evaluates only windows that have ended by the end of the as-of month', () => {
    expect(criterion6Windows(2026, '2026-11-26')).toHaveLength(11);
    expect(criterion6Windows(2026, '2026-12-15')).toHaveLength(12);
  });

  it('reports the maximum share and its window', () => {
    const incomes = [
      income('acme', '2025-03-10', '700000'),
      income('beta', '2025-03-20', '300000'),
      income('acme', '2026-02-10', '900000'),
      income('beta', '2026-06-10', '100000'),
    ];
    const r = maxShare(incomes, 'acme', 2026, '2026-11-26');
    // 2025-02..2026-01: 700k of 1.0M = 0.7; 2025-03..2026-02: 1.6M of 1.9M; from 2025-04 only acme
    // income remains until beta's June invoice, so the earliest window with the maximum is reported.
    expect(r?.share).toBe('1.000000');
    expect(r?.window).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(maxShare(incomes, 'beta', 2026, '2026-11-26')?.share).toBe('0.300000');
    expect(r && criterion6Met(r, '0.70')).toBe(true);
    expect(r?.windowsEvaluated).toBe(11);
  });

  it('70% exactly is met; just below is not, even when the rounded share shows 0.700000', () => {
    expect(criterion6Met({ clientIncome: '700000', totalIncome: '1000000' }, '0.70')).toBe(true);
    expect(criterion6Met({ clientIncome: '699999.51', totalIncome: '1000000.00' }, '0.70')).toBe(false);
    const r = maxShare(
      [income('a', '2026-01-05', '699999.51'), income('b', '2026-01-06', '300000.49')],
      'a',
      2026,
      '2026-11-26',
    );
    expect(r?.share).toBe('0.700000');
    expect(r && criterion6Met(r, '0.70')).toBe(false);
  });

  it('status: fails at 5 met, at risk when met + unknown reaches 5, exempt is not applicable', () => {
    const c = (met: number, unknown: number) =>
      countCriteria([
        ...Array<'met'>(met).fill('met'),
        ...Array<'unknown'>(unknown).fill('unknown'),
        ...Array<'not_met'>(9 - met - unknown).fill('not_met'),
      ]);
    expect(independenceStatus(c(5, 0), 5, false)).toBe('fails');
    expect(independenceStatus(c(3, 2), 5, false)).toBe('at_risk');
    expect(independenceStatus(c(3, 1), 5, false)).toBe('passes');
    expect(independenceStatus(c(9, 0), 5, true)).toBe('not_applicable');
  });
});

describe('KPO book (R-KPO, R-KPO-LAYOUT)', () => {
  it('one row per invoice in the year, sorted by date then number, products and services split', () => {
    const book = buildKpoBook(
      [
        {
          invNo: '2026-003',
          entryDate: '2026-02-01',
          clientName: 'B',
          kind: 'product',
          amountRSD: '1000.50',
          figureIds: ['x'],
        },
        {
          invNo: '2026-002',
          entryDate: '2026-02-01',
          clientName: 'A',
          kind: 'service',
          amountRSD: '2000',
          figureIds: ['y'],
        },
        {
          invNo: '2025-040',
          entryDate: '2025-12-30',
          clientName: 'A',
          kind: 'service',
          amountRSD: '5',
          figureIds: ['z'],
        },
      ],
      2026,
    );
    expect(book.rows.map((r) => [r.rowNo, r.invNo, r.productsRSD, r.servicesRSD, r.totalRSD])).toEqual([
      [1, '2026-002', '0.00', '2000.00', '2000.00'],
      [2, '2026-003', '1000.50', '0.00', '1000.50'],
    ]);
    expect(book.totals).toEqual({ productsRSD: '1000.50', servicesRSD: '2000.00', totalRSD: '3000.50' });
  });

  it('sorts invoice numbers numerically on the same date and rounds amounts to two decimals', () => {
    const book = buildKpoBook(
      [
        {
          invNo: '2026-10',
          entryDate: '2026-03-01',
          clientName: 'A',
          kind: 'service',
          amountRSD: '100.005',
          figureIds: [],
        },
        {
          invNo: '2026-9',
          entryDate: '2026-03-01',
          clientName: 'A',
          kind: 'service',
          amountRSD: '1',
          figureIds: [],
        },
      ],
      2026,
    );
    expect(book.rows.map((r) => r.invNo)).toEqual(['2026-9', '2026-10']);
    expect(book.rows[1]?.totalRSD).toBe('100.01');
    expect(book.totals.totalRSD).toBe('101.01');
  });

  it('checks the existing book: column 5 must equal column 3 + column 4', () => {
    const row = {
      rowIndex: 4,
      rawLine: '',
      entryDate: '2026-01-02',
      description: 'x',
      productsRSD: '0',
      servicesRSD: '100',
      totalRSD: '100.00',
    };
    expect(checkExistingRow(row)).toBe(row);
    expect(existingRowKind(row)).toBe('service');
    expect(() => checkExistingRow({ ...row, totalRSD: '90' })).toThrow(KpoRowError);
    expect(() => checkExistingRow({ ...row, servicesRSD: '1.000,00' })).toThrow(/not a number/);
  });
});

describe('discrepancy checks', () => {
  it('E6: finds invoices matched by two KPO rows', () => {
    const d = duplicateMatches([
      { rowIndex: 3, invNo: '2026-004' },
      { rowIndex: 1, invNo: '2026-001' },
      { rowIndex: 7, invNo: '2026-004' },
      { rowIndex: 8, invNo: null },
    ]);
    expect([...d]).toEqual([['2026-004', [3, 7]]]);
  });

  it('E8: lists gaps within a numbering series', () => {
    expect(numberingGaps(['2026-001', '2026-002', '2026-005', 'X-9', 'X-10'])).toEqual([
      { series: '2026-#', missing: ['2026-003', '2026-004'], after: '2026-002', before: '2026-005' },
    ]);
  });

  it('E8: handles counter/year numbers and unpadded series across a digit-width change', () => {
    expect(numberingGaps(['1/2026', '2/2026', '4/2026'])).toEqual([
      { series: '#/2026', missing: ['3/2026'], after: '2/2026', before: '4/2026' },
    ]);
    expect(numberingGaps(['2026-8', '2026-9', '2026-11'])).toEqual([
      { series: '2026-#', missing: ['2026-10'], after: '2026-9', before: '2026-11' },
    ]);
    expect(numberingGaps(['2026-099', '2026-100', '2026-102'])[0]?.missing).toEqual(['2026-101']);
  });

  it('E3: invoices in the year that the book does not claim', () => {
    expect(missingFromBook(['B', 'A', 'C'], new Set(['A']))).toEqual(['B', 'C']);
  });
});

describe('keys', () => {
  it('normalises invoice numbers and builds shared keys', () => {
    expect(normalizeInvoiceNumber('  inv 2026-041 ')).toBe('INV2026-041');
    expect(keys.invoice(' 2026-041', 'issueDate')).toBe('invoice:2026-041:issueDate');
    expect(isValidInvoiceNumber('2026-041')).toBe(true);
    expect(isValidInvoiceNumber('2026 041')).toBe(false);
    expect(() => keys.invoice('INV:1', 'amount')).toThrow(InvalidInvoiceNumberError);
  });

  it('parses every key family and rejects malformed keys', () => {
    expect(parseKey('invoice:2026-041:amountRSD')).toEqual({
      kind: 'invoice',
      invNo: '2026-041',
      field: 'amountRSD',
    });
    expect(parseKey('link:payment:S1-57:invoice')).toEqual({ kind: 'link', rowRef: 'S1-57' });
    expect(parseKey('total:limit6m:withDraft')).toEqual({
      kind: 'total',
      limit: 'limit6m',
      scope: 'withDraft',
    });
    expect(parseKey('criterion:acme:6')).toEqual({ kind: 'criterion', clientId: 'acme', n: 6 });
    expect(parseKey('discrepancy:E1:payment:S1-57')).toEqual({
      kind: 'discrepancy',
      type: 'E1',
      subjectKey: 'payment:S1-57',
    });
    expect(parseKey('invoice:2026-041:nope')).toBeUndefined();
    expect(parseKey('total:limit7m:committed')).toBeUndefined();
    expect(parseKey('criterion:acme:10')).toBeUndefined();
  });
});
