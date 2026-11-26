// Verifier step 3 (PRD 8.6): re-derive a derived figure from its cited input figures, to the cent, with
// the same pure functions the producers use. Inputs must be verified first; otherwise the check waits.
import { parseKey } from '../../domain/keys.ts';
import { convertToRsd } from '../../domain/fx.ts';
import { cmp, sub } from '../../domain/money.ts';
import { headroom, ratio } from '../../domain/limits.ts';
import {
  countCriteria,
  criterion6Met,
  independenceStatus,
  maxShare,
  type IncomeFact,
  type Tri,
} from '../../domain/independence.ts';
import { invoiceRecords, sixMFacts, eightMFacts } from '../facts.ts';
import { computeTotals } from '../limit-keeper/compute.ts';
import { figureValueEquals } from '../../runtime/state.ts';
import type { Figure, FigureValue } from '../../domain/types.ts';
import type { SourceContext } from './sources.ts';
import { coverageStart } from '../../engine/inputs.ts';

export type DerivationCheck =
  | { kind: 'ok' }
  | { kind: 'not_derived' }
  | { kind: 'waiting'; inputs: string[] }
  | { kind: 'stale'; inputs: string[] }
  | { kind: 'mismatch'; expected: string; posted: string };

const show = (v: FigureValue): string =>
  v.t === 'money'
    ? `${v.amount} ${v.currency}`
    : v.t === 'ratio'
      ? v.value
      : v.t === 'tri'
        ? v.value
        : v.t === 'text'
          ? v.text
          : JSON.stringify(v);

export function checkDerivation(f: Figure, ctx: SourceContext): DerivationCheck {
  const d = f.derivation;
  if (!d) return { kind: 'not_derived' };
  const inputs = d.inputs.map((id) => ctx.state.figures.get(id));
  const stale = d.inputs.filter((id, i) => {
    const s = inputs[i]?.status;
    return s === undefined || s === 'superseded' || s === 'contested' || s === 'needs_user';
  });
  if (stale.length > 0) return { kind: 'stale', inputs: stale };
  const waiting = d.inputs.filter((_, i) => inputs[i]?.status !== 'verified');
  if (waiting.length > 0) return { kind: 'waiting', inputs: waiting };
  const ins = inputs.filter((x): x is Figure => x !== undefined);
  const expected = expectedValue(f, ins, ctx);
  if (expected === undefined)
    return {
      kind: 'mismatch',
      expected: 'a value the rule can produce from these inputs',
      posted: show(f.value),
    };
  return figureValueEquals(expected, f.value)
    ? { kind: 'ok' }
    : { kind: 'mismatch', expected: show(expected), posted: show(f.value) };
}

function expectedValue(f: Figure, ins: Figure[], ctx: SourceContext): FigureValue | undefined {
  const p = parseKey(f.key);
  const cfg = ctx.state.config;
  const rsd = (amount: string): FigureValue => ({ t: 'money', amount, currency: 'RSD' });
  if (
    (p?.kind === 'invoice' && p.field === 'amountRSD') ||
    (p?.kind === 'draft' && p.field === 'amountRSD')
  ) {
    const amount = ins.find((x) => x.value.t === 'money');
    const rate = ins.find((x) => x.value.t === 'rate');
    if (amount?.value.t !== 'money') return undefined;
    if (!rate) return amount.value.currency === 'RSD' ? rsd(amount.value.amount) : undefined;
    if (rate.value.t !== 'rate' || rate.value.base !== amount.value.currency) return undefined;
    return rsd(convertToRsd(amount.value.amount, rate.value.rate, rate.value.parity, cfg.rsdRounding));
  }
  if (p?.kind === 'total' || p?.kind === 'headroom' || p?.kind === 'ratio') {
    if (p.kind !== 'total') {
      const total = ins[0];
      if (total?.value.t !== 'money') return undefined;
      const limit = ctx.rules.decimalParam(
        p.limit === 'limit6m' ? 'R-LIMIT-6M' : 'R-VAT-8M',
        p.limit === 'limit6m' ? 'limitRSD' : 'thresholdRSD',
      );
      return p.kind === 'headroom'
        ? rsd(headroom(limit, total.value.amount))
        : { t: 'ratio', value: ratio(total.value.amount, limit) };
    }
    if (p.scope === 'withDraft' && p.limit === 'limit6m') {
      // committed total (by its own inputs) + draft
      const invoiceFigs = ins.filter((x) => x.key.startsWith('invoice:'));
      const draft = ins.find((x) => x.key === 'draft:amountRSD');
      const t = computeTotals({
        facts6m: sixMFacts(invoiceRecords(invoiceFigs), ctx.inputs.clients),
        facts8m: [],
        draft: ctx.inputs.draft,
        draftFact:
          draft?.value.t === 'money' ? { amountRSD: draft.value.amount, figureId: draft.id } : undefined,
        clients: ctx.inputs.clients,
        config: cfg,
        rules: ctx.rules,
      });
      return rsd(t.limit6m.withDraft.total);
    }
    const invoiceFigs = ins.filter((x) => x.key.startsWith('invoice:'));
    const records = invoiceRecords(invoiceFigs);
    const draft = ins.find((x) => x.key === 'draft:amountRSD');
    const t = computeTotals({
      facts6m: sixMFacts(records, ctx.inputs.clients),
      facts8m: eightMFacts(records, ctx.inputs.clients),
      draft: ctx.inputs.draft,
      draftFact:
        draft?.value.t === 'money' ? { amountRSD: draft.value.amount, figureId: draft.id } : undefined,
      clients: ctx.inputs.clients,
      config: cfg,
      rules: ctx.rules,
    });
    if (p.limit === 'limit6m') return rsd(t.limit6m.committed.total);
    return rsd(p.scope === 'committed' ? t.vat8m.committed.total : t.vat8m.withDraft.total);
  }
  if (p?.kind === 'share12m') {
    const records = invoiceRecords(ins.filter((x) => x.key.startsWith('invoice:')));
    const incomes: IncomeFact[] = [];
    for (const r of records.values()) {
      if (r.issueDate?.value.t !== 'date' || r.amountRSD?.value.t !== 'money' || r.client?.value.t !== 'text')
        continue;
      incomes.push({
        clientId: r.client.value.text,
        date: r.issueDate.value.iso,
        amountRSD: r.amountRSD.value.amount,
        figureIds: [],
      });
    }
    const draft = ins.find((x) => x.key === 'draft:amountRSD');
    if (draft?.value.t === 'money')
      incomes.push({
        clientId: ctx.inputs.draft.clientId,
        date: ctx.inputs.draft.issueDate,
        amountRSD: draft.value.amount,
        figureIds: [],
      });
    const through = p.scope === 'withDraft' ? ctx.inputs.draft.issueDate : cfg.asOf;
    const r = maxShare(incomes, p.clientId, cfg.year, through, coverageStart(ctx.inputs));
    return r ? { t: 'ratio', value: r.share, window: r.window } : undefined;
  }
  if (p?.kind === 'criterion' && p.n === 6) {
    const share = ins[0];
    if (share?.value.t !== 'ratio') return undefined;
    // Re-derive from the share's own inputs to compare the exact fraction, not the rounded share.
    const shareInputs = (share.derivation?.inputs ?? [])
      .map((id) => ctx.state.figures.get(id))
      .filter((x): x is Figure => x !== undefined);
    const exact = expectedShareFraction(shareInputs, p.clientId, share.key.endsWith('withDraft'), ctx);
    const threshold = ctx.rules.decimalParam('R-INDEP-C6-WINDOWS', 'shareThreshold');
    return { t: 'tri', value: exact && criterion6Met(exact, threshold) ? 'met' : 'not_met' };
  }
  if (p?.kind === 'indep') {
    const tri: Tri[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
      const c = ins.find((x) => x.key === `criterion:${p.clientId}:${n}`);
      return c?.value.t === 'tri' ? c.value.value : 'unknown';
    });
    return {
      t: 'text',
      text: independenceStatus(countCriteria(tri), ctx.rules.intParam('R-INDEP', 'metThreshold'), false),
    };
  }
  return undefined;
}

function expectedShareFraction(
  ins: Figure[],
  clientId: string,
  withDraft: boolean,
  ctx: SourceContext,
): { clientIncome: string; totalIncome: string } | undefined {
  const records = invoiceRecords(ins.filter((x) => x.key.startsWith('invoice:')));
  const incomes: IncomeFact[] = [];
  for (const r of records.values()) {
    if (r.issueDate?.value.t !== 'date' || r.amountRSD?.value.t !== 'money' || r.client?.value.t !== 'text')
      continue;
    incomes.push({
      clientId: r.client.value.text,
      date: r.issueDate.value.iso,
      amountRSD: r.amountRSD.value.amount,
      figureIds: [],
    });
  }
  const draft = ins.find((x) => x.key === 'draft:amountRSD');
  if (draft?.value.t === 'money')
    incomes.push({
      clientId: ctx.inputs.draft.clientId,
      date: ctx.inputs.draft.issueDate,
      amountRSD: draft.value.amount,
      figureIds: [],
    });
  return maxShare(
    incomes,
    clientId,
    ctx.state.config.year,
    withDraft ? ctx.inputs.draft.issueDate : ctx.state.config.asOf,
    coverageStart(ctx.inputs),
  );
}

/** Exact signed difference of two money figures (used for discrepancy effects). */
export function moneyDelta(a: Figure, b: Figure): string | undefined {
  if (a.value.t !== 'money' || b.value.t !== 'money' || a.value.currency !== b.value.currency)
    return undefined;
  return cmp(a.value.amount, b.value.amount) === 0 ? '0' : sub(a.value.amount, b.value.amount);
}
