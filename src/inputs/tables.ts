// CSV statements and KPO books: decoding, column mapping and row parsing by code (no model). Every row
// keeps its raw line, which becomes the statement_row / kpo_row SourceRef. Unparseable rows are listed
// with file and line and left out, never guessed.
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import { z } from 'zod';
import { parseAmount, parseDate, type DateFormat, type DecimalSeparator, DATE_FORMATS } from './parse.ts';
import { add, canonical, cmp, isPositive } from '../domain/money.ts';
import { isCurrency, type Currency } from '../domain/types.ts';
import type { IsoDate } from '../domain/dates.ts';
import type { ExistingKpoRow } from '../domain/kpo.ts';

export type Encoding = 'utf-8' | 'windows-1250';
export type Delimiter = ',' | ';' | '\t';

export interface DecodedText {
  text: string;
  encoding: Encoding;
}

/** Decode bytes: UTF-8 (BOM stripped) when valid, otherwise Windows-1250, unless an encoding is forced. */
export function decode(bytes: Buffer, forced?: Encoding): DecodedText {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  if (forced === 'windows-1250') return { text: iconv.decode(body, 'win1250'), encoding: 'windows-1250' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    if (forced === 'utf-8') throw new Error('File is not valid UTF-8');
    return { text: iconv.decode(body, 'win1250'), encoding: 'windows-1250' };
  }
}

export interface TableRow {
  lineNo: number; // 1-based line in the file
  cells: string[];
  rawLine: string;
}

export interface Table {
  header: string[];
  headerLine: number;
  rows: TableRow[];
}

export function sniffDelimiter(text: string): Delimiter {
  const sample = text.split('\n').slice(0, 20);
  const score = (d: string): number => sample.reduce((s, l) => s + (l.split(d).length - 1), 0);
  const candidates: Delimiter[] = [';', ',', '\t'];
  return candidates.reduce((best, d) => (score(d) > score(best) ? d : best), ',');
}

/** Parse CSV text into rows; `headerRow` is the 1-based line of the header (preamble lines skipped). */
export function parseTable(text: string, delimiter: Delimiter, headerRow = 1): Table {
  const records = parse(text, {
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    raw: true,
    info: true,
    trim: true,
  }) as unknown as Array<{ record: string[]; raw: string; info: { lines: number } }>;
  const headerRec = records.find((r) => r.info.lines >= headerRow);
  if (!headerRec) throw new Error('No header row found');
  const rows = records
    .filter((r) => r.info.lines > headerRec.info.lines)
    .map((r) => ({ lineNo: r.info.lines, cells: r.record, rawLine: r.raw.replace(/\r?\n$/, '') }));
  return { header: headerRec.record, headerLine: headerRec.info.lines, rows };
}

const FormatSchema = z.object({
  delimiter: z.enum([',', ';', '\t']),
  decimal: z.enum([',', '.']),
  dateFormat: z.enum(DATE_FORMATS as [DateFormat, ...DateFormat[]]),
  encoding: z.enum(['utf-8', 'windows-1250']),
  headerRow: z.number().int().min(1),
});

export const StatementMappingSchema = FormatSchema.extend({
  kind: z.literal('statement'),
  columns: z.object({
    date: z.number().int().min(0),
    amount: z.number().int().min(0).optional(),
    credit: z.number().int().min(0).optional(),
    debit: z.number().int().min(0).optional(),
    currency: z.number().int().min(0).optional(),
    direction: z.number().int().min(0).optional(),
    counterparty: z.number().int().min(0).optional(),
    reference: z.number().int().min(0).optional(),
    description: z.number().int().min(0).optional(),
  }),
  /** Currency of the account when the file has no currency column. */
  accountCurrency: z.enum(['RSD', 'EUR', 'USD', 'GBP', 'CHF']).optional(),
});

export const KpoMappingSchema = FormatSchema.extend({
  kind: z.literal('kpo'),
  columns: z.object({
    date: z.number().int().min(0),
    description: z.number().int().min(0),
    products: z.number().int().min(0),
    services: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
});

export type StatementMapping = z.infer<typeof StatementMappingSchema>;
export type KpoMapping = z.infer<typeof KpoMappingSchema>;

export interface RowError {
  file: string;
  lineNo: number;
  message: string;
}

export interface StatementRow {
  file: string;
  rowIndex: number; // 1-based data row index
  lineNo: number;
  rawLine: string;
  date: IsoDate;
  amount: string; // positive decimal
  currency: Currency;
  direction: 'in' | 'out';
  counterparty: string;
  reference: string;
  description: string;
}

const cell = (row: TableRow, i: number | undefined): string =>
  i === undefined ? '' : (row.cells[i] ?? '').trim();

const IN_WORDS = /^(priliv|uplata|in|credit|cr|potražuje|potrazuje|\+)$/i;
const OUT_WORDS = /^(odliv|isplata|out|debit|dr|duguje|-)$/i;

export function parseStatement(
  file: string,
  bytes: Buffer,
  m: StatementMapping,
): { rows: StatementRow[]; errors: RowError[] } {
  const table = parseTable(decode(bytes, m.encoding).text, m.delimiter, m.headerRow);
  const rows: StatementRow[] = [];
  const errors: RowError[] = [];
  const c = m.columns;
  table.rows.forEach((row, i) => {
    const fail = (message: string): void => void errors.push({ file, lineNo: row.lineNo, message });
    const date = parseDate(cell(row, c.date), m.dateFormat);
    if (!date) return fail(`date "${cell(row, c.date)}" does not match ${m.dateFormat}`);
    let amount: string | undefined;
    let direction: 'in' | 'out' | undefined;
    if (c.credit !== undefined || c.debit !== undefined) {
      const cr = cell(row, c.credit);
      const dr = cell(row, c.debit);
      const crV = cr ? parseAmount(cr, m.decimal) : undefined;
      const drV = dr ? parseAmount(dr, m.decimal) : undefined;
      if (cr && crV === undefined) return fail(`credit amount "${cr}" is not a number`);
      if (dr && drV === undefined) return fail(`debit amount "${dr}" is not a number`);
      if (crV !== undefined && isPositive(crV)) [amount, direction] = [crV, 'in'];
      else if (drV !== undefined && isPositive(drV)) [amount, direction] = [drV, 'out'];
      else return fail('row has no credit or debit amount');
    } else {
      const raw = cell(row, c.amount);
      const v = parseAmount(raw, m.decimal);
      if (v === undefined) return fail(`amount "${raw}" is not a number`);
      const dirText = cell(row, c.direction);
      if (c.direction !== undefined) {
        if (IN_WORDS.test(dirText)) direction = 'in';
        else if (OUT_WORDS.test(dirText)) direction = 'out';
        else return fail(`direction "${dirText}" is not recognised`);
        amount = v.startsWith('-') ? v.slice(1) : v;
      } else {
        direction = v.startsWith('-') ? 'out' : 'in';
        amount = v.startsWith('-') ? v.slice(1) : v;
      }
    }
    const curText = (cell(row, c.currency) || m.accountCurrency || '').toUpperCase();
    const currency = curText === 'DIN' ? 'RSD' : curText;
    if (!isCurrency(currency)) return fail(`currency "${curText || '(none)'}" is not supported`);
    rows.push({
      file,
      rowIndex: i + 1,
      lineNo: row.lineNo,
      rawLine: row.rawLine,
      date,
      amount,
      currency,
      direction,
      counterparty: cell(row, c.counterparty),
      reference: cell(row, c.reference),
      description: cell(row, c.description),
    });
  });
  return { rows, errors };
}

export function parseKpoBook(
  file: string,
  bytes: Buffer,
  m: KpoMapping,
): { rows: ExistingKpoRow[]; errors: RowError[] } {
  const table = parseTable(decode(bytes, m.encoding).text, m.delimiter, m.headerRow);
  const rows: ExistingKpoRow[] = [];
  const errors: RowError[] = [];
  const c = m.columns;
  table.rows.forEach((row, i) => {
    const fail = (message: string): void => void errors.push({ file, lineNo: row.lineNo, message });
    const rawDate = cell(row, c.date);
    const date = parseDate(rawDate, m.dateFormat) ?? parseDate(rawDate.split(/\s+/)[0] ?? '', m.dateFormat);
    // Totals lines ("Ukupno", "Svega") carry no date: they are not entries.
    if (!date && /^(ukupno|svega|total|zbir)/i.test(cell(row, c.description) || rawDate)) return;
    if (!date) return fail(`date "${rawDate}" does not match ${m.dateFormat}`);
    const amounts = (['products', 'services', 'total'] as const).map((k) => {
      const raw = cell(row, c[k]);
      return raw === '' ? '0' : parseAmount(raw, m.decimal);
    });
    const [products, services, total] = amounts;
    if (products === undefined || services === undefined || total === undefined) {
      return fail('an amount column is not a number');
    }
    if (cmp(canonical(add(products, services)), canonical(total)) !== 0) {
      return fail('column 5 is not column 3 + column 4');
    }
    rows.push({
      rowIndex: i + 1,
      rawLine: row.rawLine,
      entryDate: date,
      description: cell(row, c.description),
      productsRSD: products,
      servicesRSD: services,
      totalRSD: total,
    });
  });
  return { rows, errors };
}

// --- mapping guesses from header names (Serbian and English hints) -----------------------------------

const HINTS: Record<string, RegExp> = {
  date: /^(datum( knji[zž]enja| transakcije| izvr[sš]enja)?|date|booking date|transaction date)$/i,
  amount: /^(iznos|amount|suma)$/i,
  credit: /^(uplata|priliv|potra[zž]uje|credit|cr)$/i,
  debit: /^(isplata|odliv|duguje|debit|dr)$/i,
  currency: /^(valuta|currency|ccy)$/i,
  direction: /^(smer|direction|vrsta)$/i,
  counterparty: /^(nalogodavac\/primalac|nalogodavac|primalac|platilac|counterparty|payer|name)$/i,
  reference: /^(poziv na broj|reference|ref|svrha plaćanja)$/i,
  description: /^(opis|svrha|description|details)$/i,
};

const KPO_HINTS: Record<string, RegExp> = {
  date: /datum/i,
  description: /opis|description/i,
  products: /proizvod|products|goods/i,
  services: /uslug|services/i,
  total: /svega|ukupno|total/i,
};

export function guessStatementColumns(header: string[]): StatementMapping['columns'] | undefined {
  const find = (k: string): number | undefined => {
    const i = header.findIndex((h) => HINTS[k]?.test(h.trim()));
    return i >= 0 ? i : undefined;
  };
  const date = find('date');
  const amount = find('amount');
  const credit = find('credit');
  const debit = find('debit');
  if (date === undefined || (amount === undefined && credit === undefined && debit === undefined))
    return undefined;
  const cols: StatementMapping['columns'] = { date };
  for (const k of [
    'amount',
    'credit',
    'debit',
    'currency',
    'direction',
    'counterparty',
    'reference',
    'description',
  ] as const) {
    const v = find(k);
    if (v !== undefined) cols[k] = v;
  }
  if (amount !== undefined && (credit !== undefined || debit !== undefined)) {
    delete cols.credit;
    delete cols.debit;
  }
  return cols;
}

export function guessKpoColumns(header: string[]): KpoMapping['columns'] | undefined {
  const find = (k: string): number => header.findIndex((h) => KPO_HINTS[k]?.test(h));
  const cols = {
    date: find('date'),
    description: find('description'),
    products: find('products'),
    services: find('services'),
    total: find('total'),
  };
  // KPO column 2 is "Datum i opis knjiženja": date and description may share one column.
  return Object.values(cols).some((v) => v < 0) ? undefined : cols;
}

export type { DecimalSeparator, DateFormat };
