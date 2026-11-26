import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysInclusive,
  formatDateSr,
  isIsoDate,
  isWeekend,
  parseIso,
  todayInBelgrade,
  twelveMonthWindowsForTaxYear,
  vatWindow,
  DateFormatError,
} from '../../src/domain/dates.ts';

describe('ISO dates', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('26.11.2026')).toBe(false);
    expect(() => parseIso('2026-04-31')).toThrow(DateFormatError);
  });

  it('adds days and months with clamping', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-02-29', -12)).toBe('2023-02-28');
    expect(addMonths('2026-03-15', -14)).toBe('2025-01-15');
  });

  it('knows weekends (2026-11-21 is a Saturday, 2026-11-23 a Monday)', () => {
    expect(isWeekend('2026-11-21')).toBe(true);
    expect(isWeekend('2026-11-22')).toBe(true);
    expect(isWeekend('2026-11-23')).toBe(false);
  });

  it('formats Serbian style', () => {
    expect(formatDateSr('2026-11-26')).toBe('26.11.2026.');
  });

  it('gives today in Belgrade, not UTC', () => {
    expect(todayInBelgrade(new Date('2026-11-26T23:30:00Z'))).toBe('2026-11-27');
    expect(todayInBelgrade(new Date('2026-07-01T21:59:00Z'))).toBe('2026-07-01');
    expect(todayInBelgrade(new Date('2026-07-01T22:00:00Z'))).toBe('2026-07-02');
  });
});

describe('VAT window (R-VAT-8M)', () => {
  it('matches the Tax Administration example: 18.08.2023 -> 19.08.2022 to 18.08.2023', () => {
    expect(vatWindow('2023-08-18', '365d')).toEqual({ from: '2022-08-19', to: '2023-08-18' });
    expect(daysInclusive('2022-08-19', '2023-08-18')).toBe(365);
  });

  it('matches the Ministry of Finance opinion example period (ending the day before 18.03.2014)', () => {
    expect(vatWindow('2014-03-17', '365d')).toEqual({ from: '2013-03-18', to: '2014-03-17' });
  });

  it('is 366 days when the period contains 29 February', () => {
    const w = vatWindow('2024-03-10', '365d');
    expect(w).toEqual({ from: '2023-03-11', to: '2024-03-10' });
    expect(daysInclusive(w.from, w.to)).toBe(366);
  });

  it('12-calendar-month alternative', () => {
    expect(vatWindow('2026-11-26', '12m')).toEqual({ from: '2025-12-01', to: '2026-11-26' });
  });
});

describe('criterion 6 windows', () => {
  it('lists every 12-month window that starts or ends in the tax year', () => {
    const ws = twelveMonthWindowsForTaxYear(2026);
    expect(ws).toHaveLength(23);
    expect(ws[0]).toEqual({ from: '2025-02-01', to: '2026-01-31' });
    expect(ws[10]).toEqual({ from: '2025-12-01', to: '2026-11-30' });
    expect(ws[11]).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(ws[22]).toEqual({ from: '2026-12-01', to: '2027-11-30' });
  });
});
