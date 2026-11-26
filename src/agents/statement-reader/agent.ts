// StatementReader (PRD 8.2): code parses the statement, the model classifies incoming rows and proposes
// invoice links in chunks of 25 (one loop per chunk, at most 4 at a time). After its own loops and the
// InvoiceReader's are done, a code pass raises E1 for client payments with no matching invoice.
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
import { keys, normalizeInvoiceNumber, isValidInvoiceNumber, parseKey } from '../../domain/keys.ts';
import { cmp } from '../../domain/money.ts';
import { sha256 } from '../../util/hash.ts';
import { statementRowRef } from '../../engine/inputs.ts';
import { postDiscrepancy } from '../discrepancy.ts';
import type { StatementRow } from '../../inputs/tables.ts';
import type { SourceRef } from '../../domain/types.ts';

const ID = AGENTS.statementReader;
const CHUNK = 25;

export const RowClasses = ['client_payment', 'own_transfer', 'refund', 'fee', 'other'] as const;

export const RowsSubmission = z.object({
  rows: z
    .array(
      z.object({
        index: z.number().int().min(1),
        class: z.enum(RowClasses),
        invoiceNumber: z.string().max(64).nullable(),
        reasonExcerpt: z.string().min(1).max(200),
      }),
    )
    .min(1),
});
type RowsSubmission = z.infer<typeof RowsSubmission>;

export function rowSource(row: StatementRow): Extract<SourceRef, { type: 'statement_row' }> {
  return {
    type: 'statement_row',
    file: row.file,
    rowIndex: row.rowIndex,
    rawLine: row.rawLine,
    rawLineSha256: sha256(row.rawLine),
  };
}

/** Does the row text name this invoice number? Compared without spaces and case. */
export function rowNamesInvoice(rawLine: string, invNo: string): boolean {
  const flat = normalizeInvoiceNumber(rawLine);
  return flat.includes(normalizeInvoiceNumber(invNo));
}

export interface Classified {
  row: StatementRow;
  cls: (typeof RowClasses)[number];
  invoiceNumber: string | null;
  reasonExcerpt: string;
}

/** Validate a chunk submission against the rows it covers. Throws a readable reason. */
export function validateRows(rows: StatementRow[], x: RowsSubmission): Classified[] {
  const byIndex = new Map(rows.map((r) => [r.rowIndex, r]));
  const seen = new Set<number>();
  const out: Classified[] = [];
  for (const r of x.rows) {
    const row = byIndex.get(r.index);
    if (!row) throw new Error(`row ${r.index} is not in this chunk`);
    if (seen.has(r.index)) throw new Error(`row ${r.index} appears twice`);
    seen.add(r.index);
    if (!row.rawLine.includes(r.reasonExcerpt))
      throw new Error(`reasonExcerpt for row ${r.index} is not in the row text`);
    let inv: string | null = null;
    if (r.invoiceNumber !== null) {
      const n = normalizeInvoiceNumber(r.invoiceNumber);
      if (!isValidInvoiceNumber(n) || !rowNamesInvoice(row.rawLine, n)) {
        throw new Error(
          `invoiceNumber "${r.invoiceNumber}" for row ${r.index} is not written in the row text`,
        );
      }
      inv = n;
    }
    out.push({ row, cls: r.class, invoiceNumber: inv, reasonExcerpt: r.reasonExcerpt });
  }
  const missingRows = rows.filter((r) => !seen.has(r.rowIndex)).map((r) => r.rowIndex);
  if (missingRows.length > 0) throw new Error(`rows ${missingRows.join(', ')} are missing`);
  return out;
}

export function registerStatementReader(deps: AgentDeps): void {
  const { rt, inputs } = deps;
  const prompt = loadPrompt('statement-reader');
  const schema = jsonSchema(RowsSubmission);
  const limit = new Semaphore(rt.state.config.concurrency.statement);
  const classified: Classified[] = [];
  let ownDone = false;
  let invoicesDone = false;
  let e1Checked = false;

  rt.join({ id: ID, name: 'StatementReader', kind: 'agent' });

  function postRow(c: Classified): void {
    const ref = statementRowRef(c.row, inputs.statements);
    const src = [rowSource(c.row)];
    const post = (
      key: string,
      kind: 'payment_field' | 'link',
      value: Parameters<typeof rt.state.postFigure>[0]['value'],
    ): void => {
      rt.state.postFigure({ key, kind, value, sources: src, producedBy: ID, idempotencyKey: `${ID}/${key}` });
    };
    // Code-parsed facts: the model never re-types a number or a date.
    post(keys.payment(ref, 'amount'), 'payment_field', {
      t: 'money',
      amount: c.row.amount,
      currency: c.row.currency,
    });
    post(keys.payment(ref, 'date'), 'payment_field', { t: 'date', iso: c.row.date });
    post(keys.payment(ref, 'counterparty'), 'payment_field', {
      t: 'text',
      text: c.row.counterparty || '(not stated)',
    });
    // Model judgements, each with the row as source.
    post(keys.payment(ref, 'class'), 'payment_field', { t: 'text', text: c.cls });
    if (c.cls === 'client_payment')
      post(keys.paymentLink(ref), 'link', { t: 'text', text: c.invoiceNumber ?? 'none' });
  }

  async function readChunk(file: string, rows: StatementRow[]): Promise<void> {
    const first = rows[0]?.rowIndex ?? 0;
    const last = rows[rows.length - 1]?.rowIndex ?? 0;
    const tool = submitTool(
      'submit_rows',
      'Submit the class and invoice link of every row in this chunk.',
      RowsSubmission,
      (x) => {
        let ok: Classified[];
        try {
          ok = validateRows(rows, x);
        } catch (e) {
          return `Rejected: ${e instanceof Error ? e.message : String(e)}.`;
        }
        for (const c of ok) {
          classified.push(c);
          postRow(c);
        }
        return `Accepted ${ok.length} rows.`;
      },
    );
    const user = ['<rows>', ...rows.map((r) => `${r.rowIndex}: ${r.rawLine}`), '</rows>'].join('\n');
    await limit.run(async () => {
      setStatus(rt, ID, { kind: 'reading_statement_chunk', file, from: first, to: last });
      const result = await rt.startLoop({
        agentId: ID,
        loopInputKey: `stmt:${sha256(user)}`,
        system: prompt.text,
        promptHash: prompt.hash,
        user,
        model: rt.state.config.models.reader,
        maxOutputTokens: 4000,
        tools: [tool],
        schemaHash: schema.hash,
      }).done;
      if (result.status === 'failed')
        setStatus(rt, ID, {
          kind: 'error',
          message: `${file} rows ${first}-${last}: ${result.error ?? 'loop failed'}`,
        });
    });
  }

  /** E1: client payments with no invoice link and no invoice of the same amount and currency on the board. */
  function checkUnmatched(): void {
    if (!ownDone || !invoicesDone || e1Checked) return;
    e1Checked = true;
    const candidates = classified.filter((c) => c.cls === 'client_payment' && c.invoiceNumber === null);
    setStatus(rt, ID, { kind: 'searching_unmatched_payments', count: candidates.length });
    const invoiceAmounts = rt.state
      .figuresWhere(
        (f) =>
          f.status !== 'contested' &&
          f.status !== 'superseded' &&
          parseKey(f.key)?.kind === 'invoice' &&
          f.key.endsWith(':amount'),
      )
      .map((f) => f.value);
    for (const c of candidates) {
      const matched = invoiceAmounts.some(
        (v) => v.t === 'money' && v.currency === c.row.currency && cmp(v.amount, c.row.amount) === 0,
      );
      if (matched) continue;
      const ref = statementRowRef(c.row, inputs.statements);
      postDiscrepancy(deps, {
        type: 'E1',
        subjectKey: `payment:${ref}`,
        producedBy: ID,
        detail: `${c.row.date}: ${c.row.amount} ${c.row.currency} from ${c.row.counterparty || 'an unnamed payer'}. No invoice names it and none has the same amount and currency.`,
        sources: [
          rowSource(c.row),
          { type: 'rule', ruleId: 'R-PAYMENT-NO-INVOICE', url: deps.rules.url('R-PAYMENT-NO-INVOICE') },
        ],
        figureIds: [],
        ...(c.row.currency === 'RSD' ? { deltaRSD: c.row.amount } : {}),
        payment: { currency: c.row.currency, amount: c.row.amount, date: c.row.date },
      });
    }
    setStatus(rt, ID, {
      kind: 'done',
      summary: `Classified ${classified.length} incoming rows; ${candidates.length} without an invoice reference`,
    });
  }

  rt.on(ID, { types: ['hr.run.started'] }, () => {
    const work: Array<Promise<void>> = [];
    for (const st of inputs.statements) {
      const incoming = st.rows.filter((r) => r.direction === 'in');
      for (const rows of chunk(incoming, CHUNK)) work.push(readChunk(st.file, rows));
    }
    void Promise.all(work).then(() => {
      ownDone = true;
      rt.publish('hr.reader.done', ID, { agentId: ID });
      checkUnmatched();
    });
  });

  rt.on(ID, { types: ['hr.reader.done'], producerId: AGENTS.invoiceReader }, () => {
    invoicesDone = true;
    if (!ownDone) setStatus(rt, ID, { kind: 'waiting_for', what: 'own statement chunks' });
    checkUnmatched();
  });
}
