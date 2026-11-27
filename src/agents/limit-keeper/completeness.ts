// Is every input behind the headroom card read and verified? Until it is, the card says "incomplete" and
// shows no band: a total built from part of the files must never look like room left. Code only.
import { keys, parseKey, type InvoiceField } from '../../domain/keys.ts';
import { compareIso, yearOf } from '../../domain/dates.ts';
import { cmp } from '../../domain/money.ts';
import { statementRowRef, type RunInputs } from '../../engine/inputs.ts';
import { invoiceRecords, sixMFacts, eightMFacts, verifiedInvoiceFigures } from '../facts.ts';
import { computeTotals } from './compute.ts';
import type { HeadroomState } from '../../runtime/state.ts';
import type { RuleBook } from '../../domain/rules/engine.ts';
import type { Figure } from '../../domain/types.ts';

/**
 * failed: an agent loop or handler failed. missing: an input could not be read or is not supported by its
 * document. needs_you: a figure waits for the user's answer. pending: still being read or checked.
 */
export type GapKind = 'failed' | 'missing' | 'needs_you' | 'pending';

export interface Gap {
  kind: GapKind;
  text: string;
}

export interface Completeness {
  complete: boolean;
  gaps: Gap[];
}

/** Invoice facts that must come from the invoice itself, not only from the user's own KPO book. */
const DOCUMENT_FIELDS: InvoiceField[] = ['issueDate', 'amount', 'kind', 'clientCountry'];

const list = (items: string[], max = 4): string =>
  items.length > max ? `${items.slice(0, max).join(', ')} and ${items.length - max} more` : items.join(', ');

function hasDocumentSource(state: HeadroomState, f: Figure): boolean {
  if (f.sources.some((s) => s.type === 'document')) return true;
  return (state.corroborations.get(f.id) ?? []).some((c) => c.sources.some((s) => s.type === 'document'));
}

/** The draft invoice in RSD, only if it was converted from the draft as it is now. */
export function currentDraftRsd(state: HeadroomState, inputs: RunInputs, today: string): Figure | undefined {
  const draft = inputs.draft;
  const amount = state.verified(keys.draft('amount'));
  if (
    amount?.value.t !== 'money' ||
    amount.value.currency !== draft.currency ||
    cmp(amount.value.amount, draft.amount) !== 0
  )
    return undefined;
  const rsd = state.verified(keys.draft('amountRSD'));
  const used = rsd?.derivation?.inputs ?? [];
  if (!rsd || used[0] !== amount.id) return undefined;
  if (draft.currency === 'RSD') return rsd;
  const rateDate = compareIso(draft.issueDate, today) > 0 ? today : draft.issueDate;
  const rate = state.figures.get(used[1] ?? '');
  return rate?.key === keys.fx(draft.currency, rateDate) ? rsd : undefined;
}

export function assessCompleteness(
  state: HeadroomState,
  rules: RuleBook,
  inputs: RunInputs,
  today: string,
): Completeness {
  const gaps: Gap[] = [];
  const add = (kind: GapKind, text: string): void => void gaps.push({ kind, text });

  if (state.failedLoops.length > 0) {
    const agents = [...new Set(state.failedLoops.map((l) => l.agentId))];
    add('failed', `${state.failedLoops.length} agent loop(s) failed (${list(agents)}).`);
  }
  if (state.handlerErrors.length > 0)
    add('failed', `An agent hit an error: ${state.handlerErrors[0] ?? ''}`.slice(0, 200));

  const live = [...state.figures.values()].filter(
    (f) => f.status !== 'superseded' && f.status !== 'contested',
  );

  // Every invoice document yields an invoice whose facts are verified and stated by the document itself.
  const invoicesOfDoc = new Map<string, Set<string>>();
  for (const f of live) {
    const p = parseKey(f.key);
    if (p?.kind !== 'invoice') continue;
    const sources = [...f.sources, ...(state.corroborations.get(f.id) ?? []).flatMap((c) => c.sources)];
    for (const s of sources)
      if (s.type === 'document')
        invoicesOfDoc.set(s.docId, (invoicesOfDoc.get(s.docId) ?? new Set()).add(p.invNo));
  }
  const unreadable = inputs.documents.filter((d) => d.kind === 'unreadable').map((d) => d.fileName);
  if (unreadable.length > 0) add('missing', `Not readable: ${list(unreadable)}.`);
  const notRead: string[] = [];
  const notVerified = new Set<string>();
  for (const d of inputs.documents) {
    if (d.kind !== 'readable') continue;
    const numbers = invoicesOfDoc.get(d.docId);
    if (!numbers) {
      notRead.push(d.fileName);
      continue;
    }
    for (const n of numbers) {
      const supported = DOCUMENT_FIELDS.every((field) => {
        const f = state.verified(keys.invoice(n, field));
        return f !== undefined && hasDocumentSource(state, f);
      });
      if (!supported || !state.verified(keys.invoice(n, 'amountRSD'))) notVerified.add(n);
    }
  }
  const reading = !state.progress.invoicesRead;
  if (notRead.length > 0) add(reading ? 'pending' : 'missing', `No invoice figures from: ${list(notRead)}.`);
  if (notVerified.size > 0)
    add(reading ? 'pending' : 'missing', `Invoices not fully verified: ${list([...notVerified].sort())}.`);

  // An invoice counted in the totals needs its document: the KPO book is what is being checked.
  const documented = new Set([...invoicesOfDoc.values()].flatMap((s) => [...s]));
  const records = invoiceRecords(verifiedInvoiceFigures(state));
  const bookOnly = [...records.values()]
    .filter((r) => {
      const date = r.issueDate?.value;
      return date?.t === 'date' && yearOf(date.iso) === state.config.year && !documented.has(r.invNo);
    })
    .map((r) => r.invNo);
  if (bookOnly.length > 0)
    add(reading ? 'pending' : 'missing', `Only your KPO book states: ${list(bookOnly.sort())}.`);

  // Every incoming bank row is classified, and every client payment is linked (or shown as unlinked).
  let rows = 0;
  for (const st of inputs.statements)
    for (const row of st.rows) {
      if (row.direction !== 'in') continue;
      const ref = statementRowRef(row, inputs.statements);
      const cls = state.verified(keys.payment(ref, 'class'));
      const isPayment = cls?.value.t === 'text' && cls.value.text === 'client_payment';
      if (!cls || (isPayment && !state.verified(keys.paymentLink(ref)))) rows += 1;
    }
  if (rows > 0)
    add(state.progress.statementsRead ? 'missing' : 'pending', `${rows} incoming bank row(s) not verified.`);

  const parseErrors =
    inputs.statements.reduce((n, s) => n + s.errors.length, 0) + (inputs.kpo?.errors.length ?? 0);
  if (parseErrors > 0) add('missing', `${parseErrors} line(s) of your CSV files could not be parsed.`);
  if (state.progress.kpo === undefined) add('pending', 'Your KPO book is still being read.');
  else if (!state.progress.kpo.complete) add('missing', 'Some KPO book rows could not be matched.');

  const counted = new Set(['invoice', 'payment', 'link', 'fx', 'draft', 'total', 'discrepancy']);
  const open = live.filter((f) => counted.has(parseKey(f.key)?.kind ?? ''));
  const asked = open.filter((f) => f.status === 'needs_user').length;
  if (asked > 0) add('needs_you', `${asked} figure(s) wait for your answer.`);
  const proposed = open.filter((f) => f.status === 'proposed').length;
  if (proposed > 0) add('pending', `${proposed} figure(s) still being checked.`);

  const draft = currentDraftRsd(state, inputs, today);
  if (!draft) {
    const rateAsked = [...state.questions.values()].some(
      (q) => q.answer === undefined && q.subjectKey.startsWith('fx:'),
    );
    add(rateAsked ? 'needs_you' : 'pending', 'The invoice you are about to send is not converted yet.');
  }

  // The totals on the board are the totals of what is verified now.
  const expected = computeTotals({
    facts6m: sixMFacts(records, inputs.clients),
    facts8m: eightMFacts(records, inputs.clients),
    draft: inputs.draft,
    draftFact: draft?.value.t === 'money' ? { amountRSD: draft.value.amount, figureId: draft.id } : undefined,
    clients: inputs.clients,
    config: state.config,
    rules,
  });
  const matches = (key: string, total: string): boolean => {
    const f = state.verified(key);
    return f?.value.t === 'money' && cmp(f.value.amount, total) === 0;
  };
  if (
    !matches(keys.total('limit6m', 'committed'), expected.limit6m.committed.total) ||
    !matches(keys.total('limit6m', 'withDraft'), expected.limit6m.withDraft.total) ||
    !matches(keys.total('vat8m', 'committed'), expected.vat8m.committed.total) ||
    !matches(keys.total('vat8m', 'withDraft'), expected.vat8m.withDraft.total)
  )
    add('pending', 'The totals are being recalculated.');

  return { complete: gaps.length === 0, gaps };
}
