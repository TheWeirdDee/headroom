// KpoReader (PRD 8.2a): code parses the user's KPO book; the model only matches each row's description to
// an invoice number. Code then claims, on the same keys InvoiceReader uses, what the book says about each
// invoice (entry date, RSD amount, products or services column). Collisions with the invoices are real.
import { createAgent } from '@mozaik-ai/core';
import { EventIs } from '../situations.ts';
import { z } from 'zod';
import {
  AGENTS,
  Semaphore,
  chunk,
  jsonSchema,
  loadPrompt,
  setStatus,
  submitTool,
  type AgentDeps,
} from '../common.ts';
import { fenceSafe } from '../common.ts';
import { isValidInvoiceNumber, keys, normalizeInvoiceNumber } from '../../domain/keys.ts';
import { duplicateMatches } from '../../domain/discrepancies.ts';
import { existingRowKind, type ExistingKpoRow } from '../../domain/kpo.ts';
import { sha256 } from '../../util/hash.ts';
import { add, neg } from '../../domain/money.ts';
import { postDiscrepancy } from '../discrepancy.ts';
import type { SourceRef } from '../../domain/types.ts';

const ID = AGENTS.kpoReader;
const CHUNK = 25;

export const MatchesSubmission = z.object({
  rows: z
    .array(
      z.object({
        index: z.number().int().min(1),
        invoiceNumber: z.string().max(64).nullable(),
        reasonExcerpt: z.string().max(200),
      }),
    )
    .min(1),
});
type MatchesSubmission = z.infer<typeof MatchesSubmission>;

export function kpoSource(file: string, row: ExistingKpoRow): Extract<SourceRef, { type: 'kpo_row' }> {
  return {
    type: 'kpo_row',
    file,
    rowIndex: row.rowIndex,
    rawLine: row.rawLine,
    rawLineSha256: sha256(row.rawLine),
  };
}

/** Digit groups of an invoice number without leading zeros: "2026-041" -> ["2026", "41"]. */
function digitGroups(s: string): string[] {
  return (s.match(/\d+/g) ?? []).map((g) => g.replace(/^0+(?=\d)/, ''));
}

/**
 * Does the description plausibly name this invoice? Either the normalised number appears in it, or the
 * excerpt (a verbatim piece of the description) holds every digit group of the number ("41/2026" names
 * "2026-041").
 */
export function descriptionNames(description: string, excerpt: string, invNo: string): boolean {
  if (normalizeInvoiceNumber(description).includes(normalizeInvoiceNumber(invNo))) return true;
  if (!description.includes(excerpt)) return false;
  const have = new Set(digitGroups(excerpt));
  const need = digitGroups(invNo);
  return need.length > 0 && need.every((g) => have.has(g));
}

export interface Match {
  row: ExistingKpoRow;
  invNo: string | null;
}

export function validateMatches(rows: ExistingKpoRow[], x: MatchesSubmission): Match[] {
  const byIndex = new Map(rows.map((r) => [r.rowIndex, r]));
  const seen = new Set<number>();
  const out: Match[] = [];
  for (const m of x.rows) {
    const row = byIndex.get(m.index);
    if (!row) throw new Error(`row ${m.index} is not in this chunk`);
    if (seen.has(m.index)) throw new Error(`row ${m.index} appears twice`);
    seen.add(m.index);
    if (m.invoiceNumber === null) {
      out.push({ row, invNo: null });
      continue;
    }
    const n = normalizeInvoiceNumber(m.invoiceNumber);
    if (!isValidInvoiceNumber(n))
      throw new Error(`invoiceNumber "${m.invoiceNumber}" for row ${m.index} is not usable`);
    if (!descriptionNames(row.description, m.reasonExcerpt, n)) {
      throw new Error(`row ${m.index}: the description does not name invoice "${m.invoiceNumber}"`);
    }
    out.push({ row, invNo: n });
  }
  const missingRows = rows.filter((r) => !seen.has(r.rowIndex)).map((r) => r.rowIndex);
  if (missingRows.length > 0) throw new Error(`rows ${missingRows.join(', ')} are missing`);
  return out;
}

export function registerKpoReader(deps: AgentDeps): void {
  const { rt, inputs } = deps;
  const prompt = loadPrompt('kpo-reader');
  const schema = jsonSchema(MatchesSubmission);
  const limit = new Semaphore(rt.state.config.concurrency.kpo);
  const matches: Match[] = [];
  const unreadRows: number[] = [];

  async function readChunk(file: string, rows: ExistingKpoRow[]): Promise<void> {
    const from = rows[0]?.rowIndex ?? 0;
    const to = rows[rows.length - 1]?.rowIndex ?? 0;
    const tool = submitTool(
      'submit_matches',
      'Submit the invoice number each KPO row refers to.',
      MatchesSubmission,
      (x) => {
        try {
          matches.push(...validateMatches(rows, x));
        } catch (e) {
          return `Rejected: ${e instanceof Error ? e.message : String(e)}.`;
        }
        return `Accepted ${rows.length} rows.`;
      },
    );
    const user = [
      '<rows>',
      ...rows.map((r) => `${r.rowIndex}: ${r.entryDate} | ${fenceSafe(r.description)}`),
      '</rows>',
    ].join('\n');
    await limit.run(async () => {
      setStatus(rt, ID, { kind: 'reading_kpo_chunk', from, to });
      const result = await rt.think(agent, {
        gate: deps.gate,
        loopInputKey: `kpo:${sha256(user)}`,
        promptHash: prompt.hash,
        user,
        model: rt.state.config.models.reader,
        maxOutputTokens: 4000,
        tools: [tool],
        schemaHash: schema.hash,
      }).done;
      if (result.status === 'failed')
        setStatus(rt, ID, { kind: 'error', message: `rows ${from}-${to}: ${result.error ?? 'loop failed'}` });
      // Rows the reader could not match are reported, never silently dropped.
      const missing = rows.filter((r) => !matches.some((m) => m.row.rowIndex === r.rowIndex));
      if (missing.length > 0) {
        unreadRows.push(...missing.map((r) => r.rowIndex));
        postDiscrepancy(deps, {
          type: 'E-DOC-UNREADABLE',
          subjectKey: `kpo-rows:${from}-${to}`,
          producedBy: ID,
          detail: `KPO book rows ${missing.map((r) => r.rowIndex).join(', ')} could not be matched to invoices${result.error ? ` (${result.error})` : ''}.`,
          sources: missing.map((r) => kpoSource(file, r)),
          figureIds: [],
        });
      }
    });
  }

  /** Post the book's claims once every row is matched, so duplicates are known first (E6). */
  function postClaims(file: string): void {
    const dups = duplicateMatches(matches.map((m) => ({ rowIndex: m.row.rowIndex, invNo: m.invNo })));
    const claimed = new Set<string>();
    for (const m of [...matches].sort((a, b) => a.row.rowIndex - b.row.rowIndex)) {
      if (!m.invNo || claimed.has(m.invNo)) continue;
      claimed.add(m.invNo);
      const src = [kpoSource(file, m.row)];
      const post = (key: string, value: Parameters<typeof rt.state.postFigure>[0]['value']): void => {
        rt.state.postFigure({
          key,
          kind: key.endsWith('amountRSD') ? 'amount_rsd' : 'invoice_field',
          value,
          sources: src,
          producedBy: ID,
          idempotencyKey: `${ID}/${key}`,
        });
      };
      post(keys.invoice(m.invNo, 'issueDate'), { t: 'date', iso: m.row.entryDate });
      post(keys.invoice(m.invNo, 'amountRSD'), { t: 'money', amount: m.row.totalRSD, currency: 'RSD' });
      const kind = existingRowKind(m.row);
      if (kind !== 'mixed') post(keys.invoice(m.invNo, 'kind'), { t: 'text', text: kind });
    }
    for (const [invNo, rowIdx] of dups) {
      const rows = rowIdx
        .map((i) => matches.find((m) => m.row.rowIndex === i)?.row)
        .filter((r): r is ExistingKpoRow => r !== undefined);
      const [, ...extra] = rows;
      postDiscrepancy(deps, {
        type: 'E6',
        subjectKey: `invoice:${invNo}`,
        producedBy: ID,
        detail: `Invoice ${invNo} is entered on KPO rows ${rowIdx.join(' and ')}.`,
        sources: rows.map((r) => kpoSource(file, r)),
        figureIds: [],
        baseline: 'book',
        deltaRSD: extra.length > 0 ? neg(add(...extra.map((r) => r.totalRSD))) : '0',
      });
    }
    rt.state.progress.kpo = { complete: unreadRows.length === 0 };
    rt.publish('hr.kpo.claims', ID, {
      complete: unreadRows.length === 0,
      unreadRows,
      invoiceNumbers: [...claimed].sort(),
      rowsWithoutInvoice: matches.filter((m) => !m.invNo).map((m) => m.row.rowIndex),
    });
    setStatus(rt, ID, {
      kind: 'done',
      summary: `Matched ${claimed.size} invoices in ${matches.length} KPO rows`,
    });
  }
  const agent = createAgent({
    name: ID,
    capabilities: ['inference', 'reads-kpo-book'],
    instruction: prompt.text,
    tools: [], // each loop brings its own submit tool
    handlers: [
      ...rt.ownLoops(),
      rt.when(new EventIs('hr.run.started'), () => {
        const book = inputs.kpo;
        if (!book || book.rows.length === 0) {
          setStatus(rt, ID, { kind: 'done', summary: 'No KPO book provided' });
          rt.state.progress.kpo = { complete: true };
          rt.publish('hr.kpo.claims', ID, {
            complete: true,
            unreadRows: [],
            invoiceNumbers: [],
            rowsWithoutInvoice: [],
          });
          rt.publish('hr.reader.done', ID, { agentId: ID });
          return;
        }
        void Promise.all(chunk(book.rows, CHUNK).map((rows) => readChunk(book.file, rows))).then(() => {
          postClaims(book.file);
          rt.publish('hr.reader.done', ID, { agentId: ID });
        });
      }),
    ],
  });
  rt.join(agent);
}
