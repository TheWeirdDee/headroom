// Intake detection (PRD 12.6), code only: file kind, encoding, delimiter, header row, column guesses,
// decimal separator and date format. A guess is only a starting point for the mapping dialog; anything not
// recognised with confidence is left for the user to map.
import {
  decode,
  guessKpoColumns,
  guessStatementColumns,
  parseTable,
  sniffDelimiter,
  type Delimiter,
  type Encoding,
  type KpoMapping,
  type StatementMapping,
} from './tables.ts';
import { DATE_FORMATS, parseAmount, parseDate, type DateFormat, type DecimalSeparator } from './parse.ts';

export type FileKind = 'statement' | 'kpo' | 'invoice_pdf' | 'clients' | 'unknown';

export interface CsvDetection {
  kind: 'statement' | 'kpo' | 'unknown';
  encoding: Encoding;
  delimiter: Delimiter;
  headerRow: number;
  header: string[];
  preview: string[][]; // first 10 data rows
  mapping?: StatementMapping | KpoMapping; // complete guess, when every required column was found
}

/** First line (1-based) within the first 15 whose cells look like a statement or KPO header. */
export function findHeaderRow(text: string, delimiter: Delimiter): number | undefined {
  const lines = text.split(/\r?\n/).slice(0, 15);
  for (const [i, line] of lines.entries()) {
    const cells = line.split(delimiter).map((c) => c.replace(/^"|"$/g, '').trim());
    if (guessStatementColumns(cells) || guessKpoColumns(cells)) return i + 1;
  }
  return undefined;
}

function guessDecimal(samples: string[]): DecimalSeparator {
  let comma = 0;
  let dot = 0;
  for (const s of samples) {
    if (parseAmount(s, ',') !== undefined && /,\d{1,2}$/.test(s.trim())) comma += 1;
    if (parseAmount(s, '.') !== undefined && /\.\d{1,2}$/.test(s.trim())) dot += 1;
  }
  return comma > dot ? ',' : '.';
}

function guessDateFormat(samples: string[]): DateFormat | undefined {
  const usable = samples.map((s) => s.trim().split(/\s+/)[0] ?? '').filter((s) => s !== '');
  if (usable.length === 0) return undefined;
  // The format that parses the most samples wins (at least half); DD.MM before MM/DD on ties (Serbian
  // convention). Rows it cannot parse are reported later with their line, never guessed.
  let best: { f: DateFormat; n: number } | undefined;
  for (const f of DATE_FORMATS) {
    const n = usable.filter((s) => parseDate(s, f) !== undefined).length;
    if (!best || n > best.n) best = { f, n };
  }
  return best && best.n * 2 >= usable.length ? best.f : undefined;
}

export function detectCsv(bytes: Buffer, forcedKind?: 'statement' | 'kpo'): CsvDetection {
  const { text, encoding } = decode(bytes);
  const delimiter = sniffDelimiter(text);
  const headerRow = findHeaderRow(text, delimiter) ?? 1;
  const table = parseTable(text, delimiter, headerRow);
  const preview = table.rows.slice(0, 10).map((r) => r.cells);
  const base = { encoding, delimiter, headerRow, header: table.header, preview };
  const stmt = guessStatementColumns(table.header);
  const kpo = guessKpoColumns(table.header);
  const kind =
    forcedKind ??
    (kpo && (!stmt || /proizvod|uslug/i.test(table.header.join(' ')))
      ? 'kpo'
      : stmt
        ? 'statement'
        : 'unknown');
  const col = (i: number | undefined): string[] =>
    i === undefined ? [] : table.rows.slice(0, 30).map((r) => r.cells[i] ?? '');
  if (kind === 'statement' && stmt) {
    const amountSamples = [...col(stmt.amount), ...col(stmt.credit), ...col(stmt.debit)].filter(
      (s) => s.trim() !== '',
    );
    const dateFormat = guessDateFormat(col(stmt.date));
    if (!dateFormat) return { kind, ...base };
    return {
      kind,
      ...base,
      mapping: {
        kind: 'statement',
        encoding,
        delimiter,
        headerRow,
        decimal: guessDecimal(amountSamples),
        dateFormat,
        columns: stmt,
      },
    };
  }
  if (kind === 'kpo' && kpo) {
    const amountSamples = [...col(kpo.products), ...col(kpo.services), ...col(kpo.total)].filter(
      (s) => s.trim() !== '',
    );
    const dateFormat = guessDateFormat(col(kpo.date).filter((s) => !/^(ukupno|svega|total)/i.test(s)));
    if (!dateFormat) return { kind, ...base };
    return {
      kind,
      ...base,
      mapping: {
        kind: 'kpo',
        encoding,
        delimiter,
        headerRow,
        decimal: guessDecimal(amountSamples),
        dateFormat,
        columns: kpo,
      },
    };
  }
  return { kind: kind === 'unknown' ? 'unknown' : kind, ...base };
}

/** Classify an uploaded file by extension and content. */
export function detectKind(fileName: string, bytes: Buffer): FileKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf') || bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'invoice_pdf';
  if (lower.endsWith('.json')) return 'clients';
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) {
    const d = detectCsv(bytes);
    return d.kind;
  }
  return 'unknown';
}
