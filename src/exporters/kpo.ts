// KPO book export: the corrected book built from verified figures only, in the official layout
// (R-KPO-LAYOUT), with a correction log against the user's own book. CSV is UTF-8 with BOM.
import { z } from 'zod';
import { buildKpoBook, type KpoBook, type KpoInvoice } from '../domain/kpo.ts';
import { cmp } from '../domain/money.ts';
import { invoiceRecords, verifiedInvoiceFigures } from '../agents/facts.ts';
import { keys } from '../domain/keys.ts';
import { DISCLAIMER, DISCLAIMER_USER_FILES } from '../domain/copy.ts';
import type { HeadroomState } from '../runtime/state.ts';
import type { RunInputs } from '../engine/inputs.ts';
import type { RuleBook } from '../domain/rules/engine.ts';
import type { SourceRef } from '../domain/types.ts';

export class ExportError extends Error {
  constructor(
    readonly code: 'TOTALS_MISMATCH' | 'NOT_READY',
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export interface Correction {
  type: string;
  invoice: string;
  original: string; // the user's book row, as written, or "(no row)"
  corrected: string;
  why: string;
  figureIds: string[];
  sources: SourceRef[];
}

export interface KpoExport {
  book: KpoBook;
  header: Array<[string, string]>;
  columns: string[];
  corrections: Correction[];
  disclaimer: string;
  synthetic: boolean;
  /** Why this book is not complete; empty when every input behind it is verified. */
  incomplete: string[];
}

export const INCOMPLETE_BOOK = 'INCOMPLETE: not every input is verified. Do not use this as your KPO book.';

/** Discrepancies that change a row of the KPO book itself. E1, E8 and E9 do not; they stay in the report. */
const KPO_CORRECTION_TYPES = new Set(['E2', 'E3', 'E4', 'E5', 'E6', 'E7']);

export function buildKpoExport(
  state: HeadroomState,
  inputs: RunInputs,
  rules: RuleBook,
  incomplete: string[] = [],
): KpoExport {
  const committed = state.verified(keys.total('limit6m', 'committed'));
  if (committed?.value.t !== 'money') throw new ExportError('NOT_READY', 'The 6M total is not verified yet.');
  const records = invoiceRecords(verifiedInvoiceFigures(state));
  const rows: KpoInvoice[] = [];
  for (const r of records.values()) {
    if (r.issueDate?.value.t !== 'date' || r.amountRSD?.value.t !== 'money' || r.kind?.value.t !== 'text')
      continue;
    const clientId = r.client?.value.t === 'text' ? r.client.value.text : '';
    rows.push({
      invNo: r.invNo,
      entryDate: r.issueDate.value.iso,
      clientName: inputs.clients.find((c) => c.id === clientId)?.name ?? clientId,
      kind: r.kind.value.text === 'product' ? 'product' : 'service',
      amountRSD: r.amountRSD.value.amount,
      figureIds: [r.issueDate.id, r.amountRSD.id, r.kind.id],
    });
  }
  const book = buildKpoBook(rows, state.config.year, state.config.rsdRounding);
  // The totals row must equal the verified 6M committed total: a mismatch is refused.
  if (cmp(book.totals.totalRSD, committed.value.amount) !== 0) {
    throw new ExportError(
      'TOTALS_MISMATCH',
      `KPO total ${book.totals.totalRSD} differs from the verified 6M total ${committed.value.amount}.`,
    );
  }
  const columns = z.array(z.string()).length(5).parse(rules.get('R-KPO-LAYOUT').params['columns']);
  const p = inputs.profile;
  const header: Array<[string, string]> = [
    ['PIB', p.pib],
    ['Obveznik', p.name],
    ['Firma - radnje', p.name],
    ['Sedište', p.address],
    ['Šifra poreskog obveznika', p.taxpayerCode ?? ''],
    ['Šifra delatnosti', p.activityCode],
    ['Godina', String(state.config.year)],
  ];
  const corrections: Correction[] = [];
  for (const d of state.discrepancies.values()) {
    if (!KPO_CORRECTION_TYPES.has(d.type)) continue;
    if (d.status !== 'verified' || d.baseline !== 'book' || !d.subjectKey?.startsWith('invoice:')) continue;
    const invNo = d.subjectKey.slice('invoice:'.length);
    const kpoRows = d.sources.filter(
      (s): s is Extract<SourceRef, { type: 'kpo_row' }> => s.type === 'kpo_row',
    );
    const row = book.rows.find((r) => r.invNo === invNo);
    corrections.push({
      type: d.type,
      invoice: invNo,
      original: kpoRows.map((s) => s.rawLine).join(' | ') || '(no row)',
      corrected: row
        ? `${row.rowNo}, ${row.date}, ${row.description}, ${row.productsRSD}, ${row.servicesRSD}, ${row.totalRSD}`
        : '(not in this year)',
      why: `${d.title}. ${d.detail}`,
      figureIds: d.figureIds,
      sources: d.sources,
    });
  }
  corrections.sort(
    (a, b) => a.invoice.localeCompare(b.invoice, 'en', { numeric: true }) || a.type.localeCompare(b.type),
  );
  return {
    book,
    header,
    columns,
    corrections,
    disclaimer: inputs.synthetic ? DISCLAIMER : DISCLAIMER_USER_FILES,
    synthetic: inputs.synthetic,
    incomplete,
  };
}

const cell = (s: string, sep = ','): string =>
  s.includes(sep) || /["\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
const BOM = '﻿';

/** Amounts with a dot (default) or, for locale 'sr', with a decimal comma. */
function amount(s: string, locale: 'default' | 'sr'): string {
  return locale === 'sr' ? s.replace('.', ',') : s;
}

/** CSV of the book. locale 'sr' uses a decimal comma and ';' between columns (Excel in Serbian locales). */
export function kpoCsv(x: KpoExport, locale: 'default' | 'sr' = 'default'): string {
  const sep = locale === 'sr' ? ';' : ',';
  const join = (cells: string[]): string => cells.map((c) => cell(c, sep)).join(sep);
  const lines: string[] = [];
  lines.push('KPO - KNJIGA O OSTVARENOM PROMETU PAUŠALNO OPOREZOVANIH OBVEZNIKA');
  if (x.incomplete.length > 0)
    lines.push(cell(INCOMPLETE_BOOK, sep), ...x.incomplete.map((g) => cell(g, sep)));
  for (const [k, v] of x.header) lines.push(join([k, v]));
  if (x.synthetic) lines.push('SYNTHETIC DATA');
  lines.push(cell(x.disclaimer, sep));
  lines.push('');
  lines.push(join(x.columns));
  lines.push(join(['1', '2', '3', '4', '5']));
  for (const r of x.book.rows) {
    lines.push(
      join([
        String(r.rowNo),
        `${r.date} ${r.description}`,
        amount(r.productsRSD, locale),
        amount(r.servicesRSD, locale),
        amount(r.totalRSD, locale),
      ]),
    );
  }
  lines.push(
    join([
      '',
      'Ukupno',
      amount(x.book.totals.productsRSD, locale),
      amount(x.book.totals.servicesRSD, locale),
      amount(x.book.totals.totalRSD, locale),
    ]),
  );
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function correctionsCsv(x: KpoExport): string {
  const lines = [['Type', 'Invoice', 'Original KPO row', 'Corrected row', 'Why', 'Figure ids'].join(',')];
  for (const c of x.corrections)
    lines.push(
      [c.type, c.invoice, c.original, c.corrected, c.why, c.figureIds.join(' ')]
        .map((v) => cell(v))
        .join(','),
    );
  if (x.incomplete.length > 0) lines.push(cell(INCOMPLETE_BOOK));
  lines.push(cell(x.disclaimer));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
