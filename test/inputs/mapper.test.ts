// Messy CSV layouts: detection guesses the layout, the mapping parses every row, and no
// row is guessed. The evaluation parses them too.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectCsv, detectKind } from '../../src/inputs/detect.ts';
import {
  parseKpoBook,
  parseStatement,
  type KpoMapping,
  type StatementMapping,
} from '../../src/inputs/tables.ts';

const fx = (name: string): Buffer => readFileSync(join('test/fixtures/csv', name));

function statement(name: string, extra: Partial<StatementMapping> = {}) {
  const d = detectCsv(fx(name));
  expect(d.kind).toBe('statement');
  const m = { ...((d.mapping ?? d.guess) as StatementMapping), ...extra };
  expect(m.kind).toBe('statement');
  return { d, ...parseStatement(name, fx(name), m) };
}

const brief = (rows: Array<{ date: string; amount: string; currency: string; direction: string }>) =>
  rows.map((r) => [r.date, r.direction, r.amount, r.currency]);

describe('messy CSV layouts', () => {
  it('01: semicolons, comma decimals, dd.mm.yyyy, credit and debit columns', () => {
    const { d, rows, errors } = statement('01-semicolon-comma-decimals.csv');
    expect(d.mapping).toMatchObject({ delimiter: ';', decimal: ',', dateFormat: 'DD.MM.YYYY' });
    expect(errors).toEqual([]);
    expect(brief(rows)).toEqual([
      ['2026-01-05', 'in', '120000', 'RSD'],
      ['2026-01-06', 'out', '150.5', 'RSD'],
      ['2026-02-15', 'in', '1234567.89', 'RSD'],
    ]);
  });

  it('02: Windows-1250 with Serbian letters and a direction column (account currency chosen by the user)', () => {
    const { d, rows, errors } = statement('02-windows-1250.csv', { accountCurrency: 'RSD' });
    expect(d.encoding).toBe('windows-1250');
    // No currency column: detection offers a guess but leaves the mapping to the user (account currency).
    expect(d.mapping).toBeUndefined();
    expect(d.guess?.columns).toMatchObject({ date: 0, amount: 3, direction: 4 });
    expect(errors).toEqual([]);
    expect(rows[0]?.counterparty).toBe('Šumadija Žito d.o.o.');
    expect(brief(rows)).toEqual([
      ['2026-03-10', 'in', '250000', 'RSD'],
      ['2026-03-11', 'out', '12500', 'RSD'],
    ]);
  });

  it('03: bank preamble lines before the header', () => {
    const { d, rows, errors } = statement('03-preamble.csv');
    expect(d.headerRow).toBe(4);
    expect(errors).toEqual([]);
    expect(brief(rows)).toEqual([
      ['2026-01-20', 'in', '98000', 'RSD'],
      ['2026-01-21', 'in', '12.4', 'RSD'],
    ]);
  });

  it('04: columns in a different order', () => {
    const { rows, errors } = statement('04-swapped-columns.csv');
    expect(errors).toEqual([]);
    expect(brief(rows)).toEqual([
      ['2026-04-02', 'in', '4500', 'EUR'],
      ['2026-04-03', 'out', '35', 'EUR'],
    ]);
  });

  it('05: tab separated, dd/mm/yyyy, English headers, signed amounts', () => {
    const { d, rows, errors } = statement('05-tab-signed-amounts.csv');
    expect(d.mapping).toMatchObject({ delimiter: '\t', decimal: '.', dateFormat: 'DD/MM/YYYY' });
    expect(errors).toEqual([]);
    expect(brief(rows)).toEqual([
      ['2026-05-02', 'in', '1250', 'EUR'],
      ['2026-05-03', 'out', '4.5', 'EUR'],
    ]);
  });

  it('06: KPO book with semicolons, comma decimals and a totals line', () => {
    const d = detectCsv(fx('06-kpo-semicolon.csv'));
    expect(d.kind).toBe('kpo');
    const { rows, errors } = parseKpoBook('06.csv', fx('06-kpo-semicolon.csv'), d.mapping as KpoMapping);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.entryDate, r.productsRSD, r.servicesRSD, r.totalRSD])).toEqual([
      ['2026-01-15', '0', '250000', '250000'],
      ['2026-02-20', '80000', '0', '80000'],
    ]);
  });

  it('07: quoted fields containing commas, and a byte order mark', () => {
    const { rows, errors } = statement('07-quoted-bom.csv');
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      description: 'Uplata, po fakturi 2026-006',
      counterparty: 'Bor Studio, d.o.o.',
      amount: '64000',
    });
  });

  it('classifies files by name and content', () => {
    expect(detectKind('izvod.csv', fx('01-semicolon-comma-decimals.csv'))).toBe('statement');
    expect(detectKind('knjiga.csv', fx('06-kpo-semicolon.csv'))).toBe('kpo');
    expect(detectKind('f.pdf', Buffer.from('%PDF-1.7'))).toBe('invoice_pdf');
    expect(detectKind('notes.csv', Buffer.from('a,b\n1,2\n'))).toBe('unknown');
  });

  it('never guesses a row it cannot parse: it is listed with file and line', () => {
    const bad = Buffer.from(
      'Datum,Iznos,Smer\n2026-01-05,100.00,PRILIV\n2026-13-40,5.00,PRILIV\n2026-01-07,12;5,PRILIV\n',
    );
    const d = detectCsv(bad);
    const { rows, errors } = parseStatement('bad.csv', bad, {
      ...((d.mapping ?? d.guess) as StatementMapping),
      accountCurrency: 'RSD',
    });
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.lineNo)).toEqual([3, 4]);
  });
});
