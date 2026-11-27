// LimitKeeper (PRD 8.4, deterministic). Recomputes the 6M and 8M totals, headroom and ratios from
// verified figures only (debounced 150 ms) and proposes them with derivations listing every input figure.
// Own initiative: E3 (invoice missing from the KPO book), E8 (numbering gaps, "worth checking") and
// crossing attribution (hr.headroom.crossing when correcting one discrepancy flips the band).
import { AGENTS, setStatus, type AgentDeps } from '../common.ts';
import { computeTotals, type DraftFact } from './compute.ts';
import { invoiceRecords, sixMFacts, eightMFacts, verifiedInvoiceFigures } from '../facts.ts';
import { buildCard } from './card.ts';
import { totalWithUnbilled, unbilledInputs, unbilledPayments } from './unbilled.ts';
import { keys, parseKey } from '../../domain/keys.ts';
import { add } from '../../domain/money.ts';
import { convertToRsd } from '../../domain/fx.ts';
import { band, headroom, ratio, type Band, type BandThresholds } from '../../domain/limits.ts';
import { yearOf } from '../../domain/dates.ts';
import { missingFromBook, numberingGaps } from '../../domain/discrepancies.ts';
import { postDiscrepancy } from '../discrepancy.ts';
import type { Figure, FigureValue, SourceRef } from '../../domain/types.ts';
import type { HrEvent } from '../../runtime/types.ts';

const ID = AGENTS.limitKeeper;
const DEBOUNCE_MS = 150;

export function registerLimitKeeper(deps: AgentDeps): void {
  const { rt, rules, inputs } = deps;
  const state = rt.state;
  const cfg = state.config;
  let timer: NodeJS.Timeout | undefined;
  let invoicesDone = false;
  let kpoClaims: Set<string> | undefined;
  let gapsChecked = false;
  const crossingsSent = new Set<string>();
  const thresholds: BandThresholds = {
    amberFrom: rules.decimalParam('R-LIMIT-BANDS', 'amberFrom'),
    redFrom: rules.decimalParam('R-LIMIT-BANDS', 'redFrom'),
    crossedFrom: rules.decimalParam('R-LIMIT-BANDS', 'crossedFrom'),
  };

  rt.join({ id: ID, name: 'LimitKeeper', kind: 'agent' });

  const ruleSrc = (ruleId: string): SourceRef => ({ type: 'rule', ruleId, url: rules.url(ruleId) });

  function post(
    key: string,
    kind: Figure['kind'],
    value: FigureValue,
    ruleId: string,
    inputs: string[],
    formula: string,
    extraRules: string[] = [],
  ): Figure {
    const [first, ...rest] = inputs;
    const sources: SourceRef[] = [
      ...(first ? [{ type: 'derived' as const, figureIds: [first, ...rest] as [string, ...string[]] }] : []),
      ruleSrc(ruleId),
      ...extraRules.map(ruleSrc),
    ];
    const valueText =
      value.t === 'money' ? value.amount : value.t === 'ratio' ? value.value : JSON.stringify(value);
    return state.postFigure({
      key,
      kind,
      value,
      sources,
      derivation: { ruleId, inputs, formula },
      producedBy: ID,
      idempotencyKey: `${ID}/${key}/${valueText}/${inputs.join(',')}`,
      scope: /:with(Draft|Unbilled)$/.test(key) ? 'draft' : 'committed',
    }).figure;
  }

  function draftFact(): DraftFact | undefined {
    const f = state.verified(keys.draft('amountRSD'));
    return f?.value.t === 'money' ? { amountRSD: f.value.amount, figureId: f.id } : undefined;
  }

  function recompute(): void {
    const records = invoiceRecords(verifiedInvoiceFigures(state));
    const facts6m = sixMFacts(records, inputs.clients);
    const facts8m = eightMFacts(records, inputs.clients);
    setStatus(rt, ID, { kind: 'recomputing_totals', invoices: facts6m.length });
    const t = computeTotals({
      facts6m,
      facts8m,
      draft: inputs.draft,
      draftFact: draftFact(),
      clients: inputs.clients,
      config: cfg,
      rules,
    });
    const money = (amount: string): FigureValue => ({ t: 'money', amount, currency: 'RSD' });

    const c6 = post(
      keys.total('limit6m', 'committed'),
      'total',
      money(t.limit6m.committed.total),
      'R-LIMIT-6M',
      t.limit6m.committed.inputs,
      `sum of ${t.limit6m.committed.included.length} verified invoice amounts in RSD issued in ${cfg.year}`,
      ['R-LIMIT-6M-BASIS'],
    );
    const w6 = post(
      keys.total('limit6m', 'withDraft'),
      'total',
      money(t.limit6m.withDraft.total),
      'R-LIMIT-6M',
      t.limit6m.withDraft.inputs,
      t.limit6m.withDraft.draftCounted
        ? 'committed total + draft invoice in RSD'
        : 'committed total (draft not in this year)',
      ['R-LIMIT-6M-BASIS'],
    );
    post(
      keys.headroom('limit6m', 'committed'),
      'headroom',
      money(headroom(t.limit6m.limit, t.limit6m.committed.total)),
      'R-LIMIT-6M',
      [c6.id],
      `${t.limit6m.limit} - committed total`,
    );
    post(
      keys.headroom('limit6m', 'withDraft'),
      'headroom',
      money(headroom(t.limit6m.limit, t.limit6m.withDraft.total)),
      'R-LIMIT-6M',
      [w6.id],
      `${t.limit6m.limit} - total with draft`,
    );
    post(
      keys.ratio('limit6m', 'withDraft'),
      'ratio',
      { t: 'ratio', value: ratio(t.limit6m.withDraft.total, t.limit6m.limit) },
      'R-LIMIT-6M',
      [w6.id],
      `total with draft / ${t.limit6m.limit}`,
    );

    const c8 = post(
      keys.total('vat8m', 'committed'),
      'total',
      money(t.vat8m.committed.total),
      'R-VAT-8M',
      t.vat8m.committed.inputs,
      `sum of ${t.vat8m.committed.included.length} verified invoices in scope from ${t.vat8m.committed.window.from} to ${t.vat8m.committed.window.to}${t.vat8m.committed.excluded.length ? `; ${t.vat8m.committed.excluded.length} out of scope` : ''}`,
      ['R-VAT-8M-SCOPE', 'R-VAT-8M-BASIS'],
    );
    const w8 = post(
      keys.total('vat8m', 'withDraft'),
      'total',
      money(t.vat8m.withDraft.total),
      'R-VAT-8M',
      t.vat8m.withDraft.inputs,
      `invoices in scope from ${t.vat8m.withDraft.window.from} to ${t.vat8m.withDraft.window.to}${t.vat8m.withDraft.draftCounted ? ' + draft invoice' : ' (draft out of scope)'}`,
      ['R-VAT-8M-SCOPE', 'R-VAT-8M-BASIS'],
    );
    post(
      keys.headroom('vat8m', 'committed'),
      'headroom',
      money(headroom(t.vat8m.threshold, t.vat8m.committed.total)),
      'R-VAT-8M',
      [c8.id],
      `${t.vat8m.threshold} - committed total`,
    );
    post(
      keys.headroom('vat8m', 'withDraft'),
      'headroom',
      money(headroom(t.vat8m.threshold, t.vat8m.withDraft.total)),
      'R-VAT-8M',
      [w8.id],
      `${t.vat8m.threshold} - total with draft`,
    );
    post(
      keys.ratio('vat8m', 'withDraft'),
      'ratio',
      { t: 'ratio', value: ratio(t.vat8m.withDraft.total, t.vat8m.threshold) },
      'R-VAT-8M',
      [w8.id],
      `total with draft / ${t.vat8m.threshold}`,
    );

    const unbilled = unbilledPayments(state);
    for (const r of unbilled.rates) rt.publish('hr.rate.needed', ID, r);
    if (unbilled.payments.length > 0 && unbilled.waiting === 0) {
      const total = totalWithUnbilled(t.limit6m.withDraft.total, unbilled.payments);
      const u6 = post(
        keys.total('limit6m', 'withUnbilled'),
        'total',
        money(total),
        'R-LIMIT-6M',
        unbilledInputs(w6.id, unbilled.payments),
        `total with draft + ${unbilled.payments.length} client payment(s) of ${cfg.year} that no invoice accounts for, in RSD`,
        ['R-LIMIT-6M-BASIS', 'R-PAYMENT-NO-INVOICE'],
      );
      post(
        keys.headroom('limit6m', 'withUnbilled'),
        'headroom',
        money(headroom(t.limit6m.limit, total)),
        'R-LIMIT-6M',
        [u6.id],
        `${t.limit6m.limit} - total with draft and unbilled payments`,
      );
    }

    checkBookCoverage(
      facts6m.map((f) => f.invNo),
      records,
    );
    checkNumbering([...records.keys()]);
    checkCrossings();
    setStatus(rt, ID, { kind: 'done', summary: `Totals from ${facts6m.length} verified invoices` });
  }

  /** E3: once both readers are done, verified invoices of the year that the book does not claim. */
  function checkBookCoverage(invoicesWithFacts: string[], records: ReturnType<typeof invoiceRecords>): void {
    if (!invoicesDone || !kpoClaims || !inputs.kpo) return;
    const inYear = invoicesWithFacts.filter((n) => {
      const d = records.get(n)?.issueDate;
      return d?.value.t === 'date' && yearOf(d.value.iso) === cfg.year;
    });
    setStatus(rt, ID, { kind: 'checking_book_coverage', invoices: inYear.length });
    for (const invNo of missingFromBook(inYear, kpoClaims)) {
      const rec = records.get(invNo);
      if (!rec?.issueDate || !rec.amountRSD || rec.amountRSD.value.t !== 'money') continue;
      postDiscrepancy(deps, {
        type: 'E3',
        subjectKey: `invoice:${invNo}`,
        producedBy: ID,
        detail: `Invoice ${invNo} (${rec.amountRSD.value.amount} RSD) is not in the KPO book.`,
        sources: [...rec.issueDate.sources.filter((s) => s.type === 'document'), ruleSrc('R-KPO')],
        figureIds: [rec.issueDate.id, rec.amountRSD.id],
        baseline: 'book',
        deltaRSD: rec.amountRSD.value.amount,
      });
    }
  }

  /** E8: gaps in verified invoice numbering, once the InvoiceReader is done. */
  function checkNumbering(invoiceNumbers: string[]): void {
    // Wait until every invoice figure has been checked, so a number still being verified is not a gap.
    if (
      !invoicesDone ||
      gapsChecked ||
      state.figuresWhere((f) => f.status === 'proposed' && f.key.startsWith('invoice:')).length > 0
    )
      return;
    gapsChecked = true;
    const records = invoiceRecords(verifiedInvoiceFigures(state));
    for (const gap of numberingGaps(invoiceNumbers)) {
      const around = [records.get(gap.after)?.issueDate, records.get(gap.before)?.issueDate].filter(
        (f): f is Figure => f !== undefined,
      );
      const docSources = around.flatMap((f) => f.sources.filter((s) => s.type === 'document'));
      postDiscrepancy(deps, {
        type: 'E8',
        subjectKey: `series:${gap.after}..${gap.before}`,
        producedBy: ID,
        detail: `No invoice ${gap.missing.join(', ')} between ${gap.after} and ${gap.before}.`,
        sources: [...docSources, ruleSrc('R-NUMBERING')],
        figureIds: around.map((f) => f.id),
      });
    }
  }

  /** The user's own book total for the year, plus the draft: the baseline for book discrepancies. */
  function bookWithDraft(): string | undefined {
    const draft = draftFact();
    if (!inputs.kpo || !draft) return undefined;
    const rows = inputs.kpo.rows.filter((r) => yearOf(r.entryDate) === cfg.year);
    const book = rows.length === 0 ? '0' : add(...rows.map((r) => r.totalRSD));
    return yearOf(inputs.draft.issueDate) === cfg.year ? add(book, draft.amountRSD) : book;
  }

  function rsdDelta(d: {
    deltaRSD?: string;
    payment?: { currency: string; amount: string; date: string };
  }): string | undefined {
    if (d.deltaRSD !== undefined) return d.deltaRSD;
    if (!d.payment) return undefined;
    const fx = state.verified(keys.fx(d.payment.currency, d.payment.date));
    if (fx?.value.t !== 'rate') {
      rt.publish('hr.rate.needed', ID, { currency: d.payment.currency, date: d.payment.date });
      return undefined;
    }
    return convertToRsd(d.payment.amount, fx.value.rate, fx.value.parity, cfg.rsdRounding);
  }

  let cardDue = false;
  /** Publish the card once per burst of changes; crossings are only meaningful on a complete card. */
  function scheduleCard(): void {
    if (cardDue) return;
    cardDue = true;
    queueMicrotask(() => {
      cardDue = false;
      const card = buildCard(state, rules, inputs, deps.today());
      if (!card) return;
      rt.publish('hr.headroom.updated', ID, card);
      if (card.completeness.complete) checkCrossings();
    });
  }

  function checkCrossings(): void {
    if (!buildCard(state, rules, inputs, deps.today())?.completeness.complete) return;
    const corrected = state.verified(keys.total('limit6m', 'withDraft'));
    if (corrected?.value.t !== 'money') return;
    const limit = rules.decimalParam('R-LIMIT-6M', 'limitRSD');
    const book = bookWithDraft();
    for (const d of state.discrepancies.values()) {
      if (d.status !== 'verified') continue;
      const delta = rsdDelta(d);
      if (delta === undefined) continue;
      const base = d.baseline === 'corrected' ? corrected.value.amount : book;
      if (base === undefined) continue;
      const before: Band = band(base, limit, thresholds);
      const after: Band = band(add(base, delta), limit, thresholds);
      if (before === after) continue;
      const sig = `${d.id}:${before}:${after}`;
      if (crossingsSent.has(sig)) continue;
      crossingsSent.add(sig);
      rt.publish('hr.headroom.crossing', ID, {
        bandBefore: before,
        bandAfter: after,
        discrepancyId: d.id,
        discrepancyType: d.type,
        subjectKey: d.subjectKey,
        baseline: d.baseline,
        baseRSD: base,
        deltaRSD: delta,
      });
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    state.debouncing.add(ID);
    timer = setTimeout(() => {
      timer = undefined;
      try {
        recompute();
      } finally {
        state.debouncing.delete(ID);
      }
    }, DEBOUNCE_MS);
  }

  rt.on(ID, { types: ['hr.figure.verified', 'hr.figure.superseded'] }, (e: HrEvent) => {
    const p = parseKey((e.payload as { key: string }).key);
    if (
      p?.kind === 'invoice' &&
      ['amountRSD', 'issueDate', 'clientCountry', 'kind', 'client'].includes(p.field)
    )
      schedule();
    else if (p?.kind === 'draft' && p.field === 'amountRSD') schedule();
    else if (p?.kind === 'fx' || (p?.kind === 'discrepancy' && p.type === 'E1')) schedule();
    scheduleCard();
  });

  // Anything that can make the card complete or incomplete publishes it again.
  rt.on(
    ID,
    {
      types: [
        'hr.figure.proposed',
        'hr.figure.contested',
        'hr.figure.needs_user',
        'hr.loop.failed',
        'hr.participant.error',
        'hr.reader.done',
        'hr.payments.matched',
        'hr.question.asked',
        'hr.question.answered',
        'hr.draft.changed',
      ],
    },
    () => scheduleCard(),
  );

  rt.on(ID, { types: ['hr.reader.done'], producerId: AGENTS.invoiceReader }, () => {
    invoicesDone = true;
    schedule();
  });

  rt.on(ID, { types: ['hr.kpo.claims'] }, (e: HrEvent) => {
    const p = e.payload as { invoiceNumbers: string[]; complete: boolean };
    // A book with rows that could not be read cannot show that an invoice is missing from it.
    kpoClaims = p.complete ? new Set(p.invoiceNumbers) : undefined;
    schedule();
  });

  rt.on(ID, { types: ['hr.run.started', 'hr.draft.changed'] }, () => schedule());

  rt.on(ID, { types: ['hr.run.stopping'] }, () => {
    if (timer) clearTimeout(timer);
    state.debouncing.delete(ID);
  });
}
