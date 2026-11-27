// RateClerk (PRD 8.3, deterministic). When an invoice's currency, date and amount are verified it fetches
// the NBS middle rate (R-FX, R-FX-DATE, R-FX-NONPUB), proposes fx:<CUR>:<date> and invoice:<n>:amountRSD
// with a derivation. On its own initiative it raises E5 when the KPO book's RSD amount for a foreign
// invoice implies a different rate. Rates are never guessed: if Kurs cannot answer, it asks the user.
import { AGENTS, setStatus, type AgentDeps } from '../common.ts';
import { keys, parseKey } from '../../domain/keys.ts';
import { classifyBookedRate, convertToRsd, fxDate } from '../../domain/fx.ts';
import { cmp, sub } from '../../domain/money.ts';
import { compareIso } from '../../domain/dates.ts';
import { postDiscrepancy } from '../discrepancy.ts';
import type { Figure, FigureValue, Question, SourceRef } from '../../domain/types.ts';
import type { HrEvent } from '../../runtime/types.ts';
import type { KursResult } from '../../integrations/kurs/client.ts';

const ID = AGENTS.rateClerk;
const MAX_ATTEMPTS = 3; // first try + 2 retries (the Kurs client retries transient errors itself)

export function registerRateClerk(deps: AgentDeps): void {
  const { rt, rules } = deps;
  const state = rt.state;
  const cfg = state.config;
  // Invoice number -> ids of the verified inputs last converted; a new verified input re-converts.
  const converted = new Map<string, string>();
  const e5Done = new Set<string>();
  const rateFigures = new Map<string, Figure>(); // fx key -> figure

  rt.join({ id: ID, name: 'RateClerk', kind: 'agent' });

  const ruleSrc = (ruleId: string): SourceRef => ({ type: 'rule', ruleId, url: rules.url(ruleId) });

  function verifiedValue(
    invNo: string,
    field: 'currency' | 'issueDate' | 'supplyDate' | 'amount',
  ): Figure | undefined {
    return state.verified(keys.invoice(invNo, field));
  }

  function askForRate(currency: string, date: string, detail: string): void {
    const id = `q-rate-${currency}-${date}`;
    if (state.questions.has(id)) return;
    const q: Question = {
      id,
      askedBy: ID,
      subjectKey: keys.fx(currency, date),
      text: `The NBS middle rate for ${currency} on ${date} could not be fetched (${detail}). Enter it from nbs.rs to continue.`,
      options: [],
      ruleId: 'R-FX',
    };
    state.questions.set(id, q);
    rt.publish('hr.question.asked', ID, { question: q });
  }

  /** Fetch (or reuse) the rate figure for a currency and date. */
  async function rateFigure(currency: string, date: string): Promise<Figure | undefined> {
    const fxKey = keys.fx(currency, date);
    const known = rateFigures.get(fxKey);
    if (known) return known;
    setStatus(rt, ID, { kind: 'fetching_rate', currency, date, attempt: 1, maxAttempts: MAX_ATTEMPTS });
    const res: KursResult = await deps.kurs.rate(currency, date, deps.today());
    if (!res.ok && res.reason === 'not_published_yet') return undefined;
    if (!res.ok) {
      setStatus(rt, ID, {
        kind: 'fetching_rate',
        currency,
        date,
        attempt: MAX_ATTEMPTS,
        maxAttempts: MAX_ATTEMPTS,
      });
      askForRate(currency, date, res.detail);
      return undefined;
    }
    const value: FigureValue = {
      t: 'rate',
      rate: res.rate.middle,
      base: currency as 'EUR',
      quote: 'RSD',
      parity: res.rate.parity,
      requestedDate: res.rate.requestedDate,
      rateDate: res.rate.rateDate,
    };
    const sources: SourceRef[] = [res.source, ruleSrc('R-FX')];
    if (res.rate.rateDate !== res.rate.requestedDate) sources.push(ruleSrc('R-FX-NONPUB'));
    const { figure } = state.postFigure({
      key: fxKey,
      kind: 'fx_rate',
      value,
      sources,
      producedBy: ID,
      idempotencyKey: `${ID}/${fxKey}`,
    });
    rateFigures.set(fxKey, figure);
    return figure;
  }

  async function convertInvoice(invNo: string): Promise<void> {
    const cur = verifiedValue(invNo, 'currency');
    const issue = verifiedValue(invNo, 'issueDate');
    const amount = verifiedValue(invNo, 'amount');
    if (
      !cur ||
      !issue ||
      !amount ||
      cur.value.t !== 'text' ||
      issue.value.t !== 'date' ||
      amount.value.t !== 'money'
    )
      return;
    const supplyFig = verifiedValue(invNo, 'supplyDate');
    const signature = [cur.id, issue.id, amount.id, supplyFig?.id ?? ''].join(',');
    if (converted.get(invNo) === signature) return;
    converted.set(invNo, signature);
    const key = keys.invoice(invNo, 'amountRSD');
    if (cur.value.text === 'RSD') {
      state.postFigure({
        key,
        kind: 'amount_rsd',
        value: { t: 'money', amount: amount.value.amount, currency: 'RSD' },
        sources: [{ type: 'derived', figureIds: [amount.id] }, ruleSrc('R-FX')],
        derivation: { ruleId: 'R-FX', inputs: [amount.id], formula: 'amount already in RSD' },
        producedBy: ID,
        idempotencyKey: `${ID}/${key}/${signature}`,
      });
      return;
    }
    const supply = supplyFig;
    const date = fxDate(cfg.fxDateRule, {
      issueDate: issue.value.iso,
      ...(supply?.value.t === 'date' ? { supplyDate: supply.value.iso } : {}),
    });
    if (!date) return;
    const fx = await rateFigure(cur.value.text, date);
    if (!fx || fx.value.t !== 'rate') {
      converted.delete(invNo);
      return;
    }
    const rsd = convertToRsd(amount.value.amount, fx.value.rate, fx.value.parity, cfg.rsdRounding);
    const dateInput = cfg.fxDateRule === 'supply_date' && supply ? supply.id : issue.id;
    state.postFigure({
      key,
      kind: 'amount_rsd',
      value: { t: 'money', amount: rsd, currency: 'RSD' },
      sources: [
        { type: 'derived', figureIds: [amount.id, fx.id, dateInput] },
        ruleSrc('R-FX'),
        ruleSrc('R-FX-DATE'),
        ruleSrc('R-FX-ROUNDING'),
      ],
      derivation: {
        ruleId: 'R-FX',
        inputs: [amount.id, fx.id, dateInput],
        formula: `${amount.value.amount} ${cur.value.text} x ${fx.value.rate} / ${fx.value.parity}, rounded ${cfg.rsdRounding.replace('_', ' ')} to 2 decimals`,
      },
      producedBy: ID,
      idempotencyKey: `${ID}/${key}/${signature}/${fx.id}`,
    });
    setStatus(rt, ID, { kind: 'idle' });
  }

  /** E5 (own initiative): the book's RSD amount for a foreign invoice differs from the NBS conversion. */
  async function checkBookRate(invNo: string): Promise<void> {
    if (e5Done.has(invNo)) return;
    const cur = verifiedValue(invNo, 'currency');
    const amount = verifiedValue(invNo, 'amount');
    if (!cur || !amount || cur.value.t !== 'text' || cur.value.text === 'RSD' || amount.value.t !== 'money')
      return;
    const versions = state.board
      .versions(keys.invoice(invNo, 'amountRSD'))
      .map((r) => state.figures.get(r.id));
    const book = versions.find((f) => f?.producedBy === AGENTS.kpoReader);
    const ours = versions.find((f) => f?.producedBy === ID && f.status !== 'contested');
    if (!book || !ours || book.value.t !== 'money' || ours.value.t !== 'money') return;
    if (cmp(book.value.amount, ours.value.amount) === 0) return;
    e5Done.add(invNo);
    setStatus(rt, ID, { kind: 'checking_book_rate', invNo });
    // Is the book's figure the conversion at the payment-date rate? Find a payment linked to this invoice.
    const link = state.figuresWhere(
      (f) =>
        f.key.startsWith('link:payment:') &&
        f.status !== 'contested' &&
        f.value.t === 'text' &&
        f.value.text === invNo,
    )[0];
    const parsed = link ? parseKey(link.key) : undefined;
    const paymentDate =
      parsed?.kind === 'link'
        ? state.figuresWhere((f) => f.key === keys.payment(parsed.rowRef, 'date'))[0]
        : undefined;
    let paymentFx: Figure | undefined;
    if (paymentDate?.value.t === 'date') paymentFx = await rateFigure(cur.value.text, paymentDate.value.iso);
    const finding = classifyBookedRate({
      bookedRsd: book.value.amount,
      amountForeign: amount.value.amount,
      rounding: cfg.rsdRounding,
      ...(paymentFx?.value.t === 'rate'
        ? { paymentDateRate: { middle: paymentFx.value.rate, parity: paymentFx.value.parity } }
        : {}),
    });
    const ourRate = ours.derivation?.inputs[1] ? state.figures.get(ours.derivation.inputs[1]) : undefined;
    const ourRateText =
      ourRate?.value.t === 'rate'
        ? `${ourRate.value.rate} (NBS, ${ourRate.value.rateDate})`
        : 'the NBS middle rate';
    const how =
      finding.kind === 'matches_payment_date_rate' && paymentDate?.value.t === 'date'
        ? `the NBS rate of the payment date ${paymentDate.value.iso}`
        : 'a rate other than the NBS middle rate';
    const sources: SourceRef[] = [
      ...book.sources,
      ...(ourRate ? ourRate.sources : []),
      ...(paymentFx ? paymentFx.sources : []),
    ];
    postDiscrepancy(deps, {
      type: 'E5',
      subjectKey: `invoice:${invNo}`,
      producedBy: ID,
      detail: `The KPO book records ${book.value.amount} RSD for ${amount.value.amount} ${cur.value.text}, an implied rate of ${finding.impliedRate}: ${how}. Converted at ${ourRateText} it is ${ours.value.amount} RSD.`,
      sources,
      figureIds: [book.id, ours.id, ...(ourRate ? [ourRate.id] : []), ...(paymentFx ? [paymentFx.id] : [])],
      baseline: 'book',
      deltaRSD: sub(ours.value.amount, book.value.amount),
    });
  }

  let conversions = 0; // each conversion is a new proposal; the board ignores one that changes nothing
  async function convertDraft(): Promise<void> {
    const draft = deps.inputs.draft;
    const amountFig = state
      .figuresWhere((f) => f.key === keys.draft('amount') && f.status !== 'superseded')
      .pop();
    if (!amountFig) return;
    const key = keys.draft('amountRSD');
    if (draft.currency === 'RSD') {
      state.postFigure({
        key,
        kind: 'draft_field',
        value: { t: 'money', amount: draft.amount, currency: 'RSD' },
        sources: [{ type: 'derived', figureIds: [amountFig.id] }, ruleSrc('R-FX')],
        derivation: { ruleId: 'R-FX', inputs: [amountFig.id], formula: 'amount already in RSD' },
        producedBy: ID,
        idempotencyKey: `${ID}/${key}/${++conversions}`,
        scope: 'draft',
      });
      return;
    }
    // The draft may be dated after the last published rate; then the latest published rate is used and
    // the requested and rate dates are both shown (R-FX-NONPUB applies, marked as an assumption).
    const today = deps.today();
    const date = compareIso(draft.issueDate, today) > 0 ? today : draft.issueDate;
    const fx = await rateFigure(draft.currency, date);
    if (!fx || fx.value.t !== 'rate') return;
    const rsd = convertToRsd(draft.amount, fx.value.rate, fx.value.parity, cfg.rsdRounding);
    state.postFigure({
      key,
      kind: 'draft_field',
      value: { t: 'money', amount: rsd, currency: 'RSD' },
      sources: [
        { type: 'derived', figureIds: [amountFig.id, fx.id] },
        ruleSrc('R-FX'),
        ruleSrc('R-FX-NONPUB'),
      ],
      derivation: {
        ruleId: 'R-FX',
        inputs: [amountFig.id, fx.id],
        formula: `${draft.amount} ${draft.currency} x ${fx.value.rate} / ${fx.value.parity}${date !== draft.issueDate ? ` (latest published rate, ${fx.value.rateDate}; the rate for ${draft.issueDate} is not published yet)` : ''}`,
      },
      producedBy: ID,
      idempotencyKey: `${ID}/${key}/${++conversions}`,
      scope: 'draft',
    });
  }

  rt.on(ID, { types: ['hr.figure.verified'] }, async (e: HrEvent) => {
    const { key } = e.payload as { key: string };
    const p = parseKey(key);
    if (p?.kind === 'invoice' && ['currency', 'issueDate', 'supplyDate', 'amount'].includes(p.field)) {
      await convertInvoice(p.invNo);
      await checkBookRate(p.invNo);
    }
    if (p?.kind === 'draft' && p.field === 'amount') await convertDraft();
    // A rate the user typed in: convert what was waiting for it.
    if (p?.kind === 'fx' && state.verified(key)?.sources.some((s) => s.type === 'user_answer')) {
      const numbers = new Set<string>();
      for (const f of state.figuresWhere((x) => x.key.startsWith('invoice:'))) {
        const k = parseKey(f.key);
        if (k?.kind === 'invoice') numbers.add(k.invNo);
      }
      for (const invNo of numbers) await convertInvoice(invNo);
      await convertDraft();
    }
  });

  rt.on(ID, { types: ['hr.figure.conflict', 'hr.figure.proposed'] }, async (e: HrEvent) => {
    const key =
      (e.payload as { key?: string; figure?: { key: string } }).key ??
      (e.payload as { figure?: { key: string } }).figure?.key;
    const p = key ? parseKey(key) : undefined;
    if (p?.kind === 'invoice' && p.field === 'amountRSD') await checkBookRate(p.invNo);
  });

  // LimitKeeper asks for the rate of a foreign payment's date to measure an E1's effect on the total.
  // What-if: a changed draft (amount, currency or date) is converted again at the right rate.
  rt.on(ID, { types: ['hr.draft.changed'] }, async () => {
    await convertDraft();
  });

  rt.on(ID, { types: ['hr.rate.needed'] }, async (e: HrEvent) => {
    const { currency, date } = e.payload as { currency: string; date: string };
    await rateFigure(currency, date);
  });

  rt.on(ID, { types: ['hr.question.answered'] }, (e: HrEvent) => {
    const { questionId, answer } = e.payload as { questionId: string; answer: string };
    const q = state.questions.get(questionId);
    if (!q || q.askedBy !== ID) return;
    const p = parseKey(q.subjectKey);
    if (p?.kind !== 'fx' || !/^\d+(\.\d{1,6})?$/.test(answer.trim())) return;
    const answeredAt = new Date(deps.now()).toISOString();
    const { figure } = state.postFigure({
      key: q.subjectKey,
      kind: 'fx_rate',
      value: {
        t: 'rate',
        rate: answer.trim(),
        base: p.currency as 'EUR',
        quote: 'RSD',
        parity: 1,
        requestedDate: p.date,
        rateDate: p.date,
      },
      sources: [{ type: 'user_answer', questionId, answeredAt, answer: answer.trim() }],
      producedBy: ID,
      idempotencyKey: `${ID}/${q.subjectKey}/answer`,
    });
    rateFigures.set(q.subjectKey, figure);
  });
}
