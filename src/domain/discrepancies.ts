// Discrepancy catalogue (PRD 12.4) and the code-only checks: E6 duplicate KPO rows, E8 numbering
// gaps, E3 invoices missing from the book. Wording is neutral and never states a legal obligation.
import { parseDigits } from './int.ts';
import type { DiscrepancyType } from './types.ts';

export const DISCREPANCY_INFO: Record<DiscrepancyType, { title: string; severity: 'error' | 'check' }> = {
  E1: { title: 'Payment received with no matching invoice', severity: 'error' },
  E2: { title: 'KPO book uses a different date than the invoice', severity: 'error' },
  E3: { title: 'Issued invoice missing from the KPO book', severity: 'error' },
  E4: { title: 'KPO amount differs from the invoice amount in RSD', severity: 'error' },
  E5: { title: 'KPO amount uses a rate other than the NBS middle rate', severity: 'error' },
  E6: { title: 'Duplicate KPO row for one invoice', severity: 'error' },
  E7: { title: 'Previous-year invoice counted in this year', severity: 'error' },
  E8: { title: 'Gap in invoice numbering (worth checking)', severity: 'check' },
  E9: { title: 'Client country differs between invoice and client details', severity: 'error' },
  'E-CONFLICT': { title: 'Two sources of equal weight disagree', severity: 'check' },
  'E-DOC-UNREADABLE': { title: 'Document could not be read', severity: 'error' },
};

/** E6: invoice numbers matched by more than one KPO row, with the row indexes. */
export function duplicateMatches(
  matches: Array<{ rowIndex: number; invNo: string | null }>,
): Map<string, number[]> {
  const byInv = new Map<string, number[]>();
  for (const m of matches) {
    if (!m.invNo) continue;
    byInv.set(m.invNo, [...(byInv.get(m.invNo) ?? []), m.rowIndex]);
  }
  return new Map(
    [...byInv].filter(([, rows]) => rows.length > 1).map(([k, rows]) => [k, rows.sort((a, b) => a - b)]),
  );
}

export interface NumberingGap {
  series: string; // the number with its counter shown as "#", e.g. "2026-#" or "#/2026"
  missing: string[]; // the missing numbers, formatted like their neighbours
  after: string;
  before: string;
}

/** Split an invoice number into series text and counter. "7/2026" -> counter 7, "2026-041" -> 41. */
function splitCounter(raw: string): { prefix: string; digits: string; suffix: string } | undefined {
  const yearSuffix = /^(\d+)([/-])((?:19|20)\d{2})$/.exec(raw);
  if (yearSuffix)
    return {
      prefix: '',
      digits: yearSuffix[1] ?? '',
      suffix: `${yearSuffix[2] ?? ''}${yearSuffix[3] ?? ''}`,
    };
  const last = /^(.*?)(\d+)$/.exec(raw);
  return last ? { prefix: last[1] ?? '', digits: last[2] ?? '', suffix: '' } : undefined;
}

/**
 * E8: within each series (same text around the counter), list numbers missing between the lowest and
 * highest seen. Shown as "worth checking" (R-NUMBERING is an assumption).
 */
export function numberingGaps(invoiceNumbers: string[]): NumberingGap[] {
  const series = new Map<string, Array<{ n: number; raw: string; digits: string }>>();
  for (const raw of invoiceNumbers) {
    const parts = splitCounter(raw);
    if (!parts) continue;
    const k = `${parts.prefix}#${parts.suffix}`;
    series.set(k, [...(series.get(k) ?? []), { n: parseDigits(parts.digits), raw, digits: parts.digits }]);
  }
  const gaps: NumberingGap[] = [];
  for (const [k, items] of series) {
    const [prefix = '', suffix = ''] = k.split('#');
    // Zero-padded series keep their width; unpadded series ("8, 9, 10") are not split by length.
    const padded = items.some((i) => i.digits.length > 1 && i.digits.startsWith('0'));
    const width = padded ? Math.max(...items.map((i) => i.digits.length)) : 0;
    const sorted = [...new Map(items.map((i) => [i.n, i])).values()].sort((a, b) => a.n - b.n);
    for (const [i, cur] of sorted.entries()) {
      const prev = sorted[i - 1];
      if (prev && cur.n - prev.n > 1) {
        const missing: string[] = [];
        for (let n = prev.n + 1; n < cur.n && missing.length < 50; n++) {
          missing.push(prefix + String(n).padStart(width, '0') + suffix);
        }
        gaps.push({ series: k, missing, after: prev.raw, before: cur.raw });
      }
    }
  }
  return gaps;
}

/** E3: verified invoices dated in the year that no KPO row claims. */
export function missingFromBook(invoicesInYear: string[], claimedByBook: Set<string>): string[] {
  return invoicesInYear.filter((n) => !claimedByBook.has(n)).sort();
}
