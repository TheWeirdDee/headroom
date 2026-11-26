import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import PDFDocument from 'pdfkit';
import { amountsIn, datesIn, parseAmount, parseDate } from '../../src/inputs/parse.ts';
import {
  decode,
  guessKpoColumns,
  guessStatementColumns,
  parseKpoBook,
  parseStatement,
  sniffDelimiter,
  type StatementMapping,
} from '../../src/inputs/tables.ts';
import {
  locateExcerpt,
  numberedText,
  readPdf,
  ExcerptNotFoundError,
  type ReadableDocument,
} from '../../src/inputs/documents.ts';

describe('amount parsing', () => {
  it('reads Serbian and English formats exactly', () => {
    expect(parseAmount('4.000,00', ',')).toBe('4000');
    expect(parseAmount('1.234.567,89', ',')).toBe('1234567.89');
    expect(parseAmount('1 234 567,89', ',')).toBe('1234567.89');
    expect(parseAmount('1,234,567.89', '.')).toBe('1234567.89');
    expect(parseAmount('-150,50', ',')).toBe('-150.5');
    expect(parseAmount('(150.50)', '.')).toBe('-150.5');
    expect(parseAmount('117.6412', '.')).toBe('117.6412');
  });

  it('refuses ambiguous or malformed amounts instead of guessing', () => {
    expect(parseAmount('1.23.4', ',')).toBeUndefined();
    expect(parseAmount('12,34,56', '.')).toBeUndefined();
    expect(parseAmount('abc', '.')).toBeUndefined();
    expect(parseAmount('', '.')).toBeUndefined();
    expect(parseAmount('1e5', '.')).toBeUndefined();
  });

  it('finds every amount and date in a text', () => {
    expect([...amountsIn('Iznos: 4.000,00 EUR')]).toContain('4000');
    expect([...datesIn('Datum izdavanja: 14.03.2026.')]).toContain('2026-03-14');
  });
});

describe('date parsing', () => {
  it('supports the common formats and refuses impossible dates', () => {
    expect(parseDate('14.03.2026.', 'DD.MM.YYYY')).toBe('2026-03-14');
    expect(parseDate('4.3.2026', 'DD.MM.YYYY')).toBe('2026-03-04');
    expect(parseDate('2026-03-14', 'YYYY-MM-DD')).toBe('2026-03-14');
    expect(parseDate('03/14/2026', 'MM/DD/YYYY')).toBe('2026-03-14');
    expect(parseDate('31.02.2026', 'DD.MM.YYYY')).toBeUndefined();
    expect(parseDate('2026-03-14', 'DD.MM.YYYY')).toBeUndefined();
  });
});

const SYNTHETIC_HEADER =
  'Datum,Datum valute,Opis,Nalogodavac/Primalac,Poziv na broj,Iznos,Valuta,Smer,Stanje';

describe('statement parsing', () => {
  it('guesses the synthetic layout from its header and parses rows with raw lines', () => {
    const header = SYNTHETIC_HEADER.split(',');
    const columns = guessStatementColumns(header);
    expect(columns).toEqual({
      date: 0,
      amount: 5,
      currency: 6,
      direction: 7,
      counterparty: 3,
      reference: 4,
      description: 2,
    });
    const csv = `${SYNTHETIC_HEADER}\n2026-03-20,2026-03-20,Uplata po fakturi 2026-041,Acme GmbH,2026-041,470564.80,RSD,PRILIV,1000000.00\n2026-03-21,2026-03-21,Provizija,Banka,,150.00,RSD,ODLIV,999850.00\nbad-date,x,y,z,,1,RSD,PRILIV,0\n`;
    const m: StatementMapping = {
      kind: 'statement',
      delimiter: ',',
      decimal: '.',
      dateFormat: 'YYYY-MM-DD',
      encoding: 'utf-8',
      headerRow: 1,
      columns: columns ?? { date: 0 },
    };
    const { rows, errors } = parseStatement('statement.csv', Buffer.from(csv), m);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      rowIndex: 1,
      lineNo: 2,
      date: '2026-03-20',
      amount: '470564.8',
      currency: 'RSD',
      direction: 'in',
      reference: '2026-041',
    });
    expect(rows[0]?.rawLine.startsWith('2026-03-20,2026-03-20,Uplata')).toBe(true);
    expect(rows[1]).toMatchObject({ direction: 'out', amount: '150' });
    expect(errors).toEqual([
      { file: 'statement.csv', lineNo: 4, message: 'date "bad-date" does not match YYYY-MM-DD' },
    ]);
  });

  it('handles ; delimiters, comma decimals, dd.mm.yyyy dates and Windows-1250 text', () => {
    const csv =
      'Datum;Opis;Uplata;Isplata\n05.01.2026;Uplata od klijenta Šumadija d.o.o.;120.000,00;\n06.01.2026;Naknada;;1.500,50\n';
    const bytes = iconv.encode(csv, 'win1250');
    const decoded = decode(bytes);
    expect(decoded.encoding).toBe('windows-1250');
    expect(decoded.text).toContain('Šumadija');
    expect(sniffDelimiter(decoded.text)).toBe(';');
    const columns = guessStatementColumns(['Datum', 'Opis', 'Uplata', 'Isplata']);
    expect(columns).toEqual({ date: 0, description: 1, credit: 2, debit: 3 });
    const { rows, errors } = parseStatement('izvod.csv', bytes, {
      kind: 'statement',
      delimiter: ';',
      decimal: ',',
      dateFormat: 'DD.MM.YYYY',
      encoding: 'windows-1250',
      headerRow: 1,
      columns: columns ?? { date: 0 },
      accountCurrency: 'RSD',
    });
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.date, r.direction, r.amount, r.currency])).toEqual([
      ['2026-01-05', 'in', '120000', 'RSD'],
      ['2026-01-06', 'out', '1500.5', 'RSD'],
    ]);
  });
});

describe('KPO book parsing', () => {
  it('parses rows, skips the totals line and rejects rows where column 5 is not 3 + 4', () => {
    const csv = [
      'Redni broj,Datum,Opis knjiženja,Prihod od prodaje proizvoda,Prihod od izvršenih usluga,Svega prihodi od delatnosti',
      '1,2026-01-15,Faktura 2026-001 Acme,0.00,250000.00,250000.00',
      '2,2026-02-15,Faktura 2026-002 Beta,0.00,100000.00,90000.00',
      ',,Ukupno,0.00,350000.00,350000.00',
    ].join('\n');
    const header = csv.split('\n')[0]?.split(',') ?? [];
    const columns = guessKpoColumns(header);
    expect(columns).toEqual({ date: 1, description: 2, products: 3, services: 4, total: 5 });
    const { rows, errors } = parseKpoBook('kpo.csv', Buffer.from(csv), {
      kind: 'kpo',
      delimiter: ',',
      decimal: '.',
      dateFormat: 'YYYY-MM-DD',
      encoding: 'utf-8',
      headerRow: 1,
      columns: columns ?? { date: 0, description: 0, products: 0, services: 0, total: 0 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowIndex: 1,
      entryDate: '2026-01-15',
      servicesRSD: '250000',
      totalRSD: '250000',
    });
    expect(errors).toEqual([{ file: 'kpo.csv', lineNo: 3, message: 'column 5 is not column 3 + column 4' }]);
  });
});

async function pdf(lines: string[][]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', info: { CreationDate: new Date(0) } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((r) => doc.on('end', () => r()));
  lines.forEach((page, i) => {
    if (i > 0) doc.addPage();
    for (const l of page) doc.text(l);
  });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

describe('PDF documents', () => {
  it('reads the text layer per page and locates excerpts to page and line', async () => {
    const bytes = await pdf([
      ['FAKTURA br. 2026-041', 'Datum izdavanja: 14.03.2026.', 'Iznos: 4.000,00 EUR'],
      ['Napomena'],
    ]);
    const doc = await readPdf('inv-041', 'inv-041.pdf', bytes);
    expect(doc.kind).toBe('readable');
    const readable = doc as ReadableDocument;
    expect(readable.pages).toHaveLength(2);
    expect(numberedText(readable)).toContain('2: Datum izdavanja: 14.03.2026.');
    const ref = locateExcerpt(readable, 'Iznos: 4.000,00 EUR');
    expect(ref).toMatchObject({
      type: 'document',
      docId: 'inv-041',
      page: 1,
      lineStart: 3,
      lineEnd: 3,
      excerpt: 'Iznos: 4.000,00 EUR',
    });
    expect(ref.excerptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(locateExcerpt(readable, 'Datum izdavanja: 14.03.2026. Iznos:').lineEnd).toBe(3);
    expect(() => locateExcerpt(readable, 'Iznos: 5.000,00 EUR')).toThrow(ExcerptNotFoundError);
  });

  it('reports a PDF without a text layer and a non-PDF as unreadable', async () => {
    const empty = await pdf([[]]);
    expect(await readPdf('d', 'scan.pdf', empty)).toMatchObject({
      kind: 'unreadable',
      reason: 'no text layer, no OCR',
    });
    expect(await readPdf('d', 'x.pdf', Buffer.from('hello'))).toMatchObject({
      kind: 'unreadable',
      reason: 'not a PDF file',
    });
  });
});
