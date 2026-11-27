// Verifier steps 4 and 5 (PRD 8.6). Fidelity: does the cited source say what the figure claims? Dates,
// amounts, currencies, invoice numbers and code-parsed rows are checked by code; only judgements a model
// made (country, product or service, payment class, contract criteria) go to the model, which sees just
// the excerpt and the claimed value. Plausibility is code.
import { parseKey } from '../../domain/keys.ts';
import { amountsIn, datesIn } from '../../inputs/parse.ts';
import { canonical, cmp, isPositive } from '../../domain/money.ts';
import { isCurrency, type Figure, type SourceRef } from '../../domain/types.ts';
import { normalizeInvoiceNumber, isValidInvoiceNumber } from '../../domain/keys.ts';
import { parseKursRate } from '../../domain/fx.ts';
import { existingRowKind } from '../../domain/kpo.ts';
import { compareIso, toIso } from '../../domain/dates.ts';
import type { SourceContext } from './sources.ts';
import { wrongAmount, wrongDate } from './fields.ts';
import type { ReadableDocument } from '../../inputs/documents.ts';

export interface ModelQuestion {
  field: string; // what the claim is about, in plain words
  claimed: string;
  excerpt: string;
  excerptSha256: string;
  allowed: string[]; // the normalised answers a model may give
  /** What each allowed value means, in the words the producing agent was given (same definitions). */
  meanings?: string;
}

export type FidelityCheck =
  { kind: 'ok' } | { kind: 'fail'; detail: string } | { kind: 'model'; question: ModelQuestion };

const CURRENCY_MARKS: Record<string, RegExp> = {
  RSD: /\bRSD\b|\bdin\b|dinar|дин/i,
  EUR: /\bEUR\b|€|\beuro?\b/i,
  USD: /\bUSD\b|\$/i,
  GBP: /\bGBP\b|£/i,
  CHF: /\bCHF\b/i,
};

const flat = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '');

function firstOf<T extends SourceRef['type']>(
  f: Figure,
  type: T,
): Extract<SourceRef, { type: T }> | undefined {
  return f.sources.find((s): s is Extract<SourceRef, { type: T }> => s.type === type);
}

export function checkFidelity(f: Figure, ctx: SourceContext): FidelityCheck {
  const p = parseKey(f.key);
  const ok: FidelityCheck = { kind: 'ok' };
  const fail = (detail: string): FidelityCheck => ({ kind: 'fail', detail });

  // Facts read from a KPO row by code: compare with the row the code parsed.
  const kpo = firstOf(f, 'kpo_row');
  if (kpo && p?.kind === 'invoice') {
    const row = ctx.inputs.kpo?.rows.find((r) => r.rowIndex === kpo.rowIndex);
    if (!row) return fail(`KPO row ${kpo.rowIndex} not found`);
    if (p.field === 'issueDate')
      return f.value.t === 'date' && f.value.iso === row.entryDate
        ? ok
        : fail(`KPO row ${row.rowIndex} has date ${row.entryDate}`);
    if (p.field === 'amountRSD')
      return f.value.t === 'money' && cmp(f.value.amount, row.totalRSD) === 0
        ? ok
        : fail(`KPO row ${row.rowIndex} total is ${row.totalRSD}`);
    if (p.field === 'kind')
      return f.value.t === 'text' && f.value.text === existingRowKind(row)
        ? ok
        : fail(`KPO row ${row.rowIndex} uses the ${existingRowKind(row)} column`);
    return ok;
  }

  // Facts read from a statement row by code, and judgements made on it by a model.
  const st = firstOf(f, 'statement_row');
  if (st && p?.kind === 'payment') {
    const row = ctx.inputs.statements
      .find((s) => s.file === st.file)
      ?.rows.find((r) => r.rowIndex === st.rowIndex);
    if (!row) return fail(`${st.file} row ${st.rowIndex} not found`);
    const v = f.value;
    switch (p.field) {
      case 'amount':
        return v.t === 'money' && v.currency === row.currency && cmp(v.amount, row.amount) === 0
          ? ok
          : fail(`row says ${row.amount} ${row.currency}`);
      case 'date':
        return v.t === 'date' && v.iso === row.date ? ok : fail(`row date is ${row.date}`);
      case 'currency':
        return v.t === 'text' && v.text === row.currency ? ok : fail(`row currency is ${row.currency}`);
      case 'counterparty':
        return v.t === 'text' &&
          (v.text === row.counterparty || (row.counterparty === '' && v.text === '(not stated)'))
          ? ok
          : fail('counterparty differs from the row');
      case 'class':
        return v.t === 'text'
          ? {
              kind: 'model',
              question: {
                field: 'the kind of incoming bank payment this row is',
                claimed: v.text,
                excerpt: row.rawLine,
                excerptSha256: st.rawLineSha256,
                allowed: ['client_payment', 'own_transfer', 'refund', 'fee', 'other'],
                meanings:
                  'client_payment: a client paying for work or goods; own_transfer: the entrepreneur moving their own money (another own account, a currency exchange); refund; fee: bank fees or interest; other.',
              },
            }
          : fail('class is not text');
    }
  }
  if (st && p?.kind === 'link') {
    if (f.value.t !== 'text') return fail('link is not text');
    if (f.value.text === 'none') return ok;
    return flat(st.rawLine).includes(flat(normalizeInvoiceNumber(f.value.text)))
      ? ok
      : fail(`row does not name invoice ${f.value.text}`);
  }

  // Facts read from an invoice document by a model.
  const doc = firstOf(f, 'document');
  if (doc && p?.kind === 'invoice') {
    const ex = doc.excerpt;
    // InvoiceReader appends the invoice-number excerpt as the last document source of every field.
    const docSources = f.sources.filter((s) => s.type === 'document');
    const numberSrc = docSources.length > 1 ? docSources[docSources.length - 1] : undefined;
    if (numberSrc?.type === 'document' && !flat(numberSrc.excerpt).includes(flat(p.invNo))) {
      return fail(`the cited excerpt does not show invoice number ${p.invNo}`);
    }
    const v = f.value;
    const read = ctx.inputs.documents.find(
      (d): d is ReadableDocument => d.kind === 'readable' && d.docId === doc.docId,
    );
    switch (p.field) {
      case 'issueDate':
      case 'supplyDate': {
        if (v.t !== 'date' || !datesIn(ex).has(v.iso))
          return fail(`excerpt "${ex}" does not show the date ${v.t === 'date' ? v.iso : ''}`);
        const why = read ? wrongDate(read, doc, v.iso, p.field) : undefined;
        return why ? fail(why) : ok;
      }
      case 'amount': {
        if (v.t !== 'money') return fail('amount is not money');
        if (!amountsIn(ex).has(canonical(v.amount)))
          return fail(`excerpt "${ex}" does not show the amount ${v.amount}`);
        if (!CURRENCY_MARKS[v.currency]?.test(ex))
          return fail(`excerpt "${ex}" does not show the currency ${v.currency}`);
        const why = read ? wrongAmount(read, doc, v.amount) : undefined;
        return why ? fail(why) : ok;
      }
      case 'currency':
        return v.t === 'text' && CURRENCY_MARKS[v.text]?.test(ex)
          ? ok
          : fail(`excerpt "${ex}" does not show the currency ${v.t === 'text' ? v.text : ''}`);
      case 'client': {
        if (v.t !== 'text') return fail('client is not text');
        const client = ctx.inputs.clients.find((c) => c.id === v.text);
        const names = client
          ? [client.name, client.pib, client.vatId].filter((x): x is string => !!x)
          : [v.text];
        const shown = f.sources
          .filter((s) => s.type === 'document')
          .map((s) => (s.type === 'document' ? flat(s.excerpt) : ''));
        return names.some((n) => shown.some((e) => e.includes(flat(n))))
          ? ok
          : fail(`excerpt does not name the client ${client?.name ?? v.text}`);
      }
      case 'clientCountry':
        return v.t === 'text'
          ? {
              kind: 'model',
              question: {
                field: 'the two-letter ISO country code of the buyer address',
                claimed: v.text,
                excerpt: ex,
                excerptSha256: doc.excerptSha256,
                allowed: [],
                meanings:
                  'The address may name the country in any language (for example Serbian "Nemačka" is DE, "Srbija" is RS) or only show a city or postcode format; give the code of the country it shows.',
              },
            }
          : fail('country is not text');
      case 'kind':
        return v.t === 'text'
          ? {
              kind: 'model',
              question: {
                field: 'whether this invoice line sells goods ("product") or services ("service")',
                claimed: v.text,
                excerpt: ex,
                excerptSha256: doc.excerptSha256,
                allowed: ['product', 'service'],
              },
            }
          : fail('kind is not text');
    }
  }

  // NBS rates: the recorded Kurs response must hold exactly this rate.
  const url = firstOf(f, 'url');
  if (url && p?.kind === 'fx' && f.value.t === 'rate') {
    const r = ctx.kurs.response(url.responseSha256);
    if (!r) return fail('Kurs response not recorded');
    const parsed = parseKursRate(r.body, f.value.base);
    return cmp(parsed.middle, f.value.rate) === 0 &&
      parsed.rateDate === f.value.rateDate &&
      parsed.parity === f.value.parity
      ? ok
      : fail(`Kurs says ${parsed.middle} on ${parsed.rateDate}`);
  }

  // Answers the user gave.
  const ua = firstOf(f, 'user_answer');
  if (ua && f.value.t === 'tri') {
    const expected = ua.answer === 'Yes' ? 'met' : ua.answer === 'No' ? 'not_met' : 'unknown';
    return f.value.value === expected ? ok : fail(`the answer was "${ua.answer}"`);
  }
  if (ua && f.value.t === 'rate')
    return cmp(ua.answer, f.value.rate) === 0 ? ok : fail(`the answer was ${ua.answer}`);

  // Contract criteria judged by a model: an independent model judges the same field text.
  const cf = firstOf(f, 'contract_field');
  if (cf && f.value.t === 'tri') {
    if (cf.value.trim() === '') return f.value.value === 'unknown' ? ok : fail('the contract field is empty');
    const rule = p?.kind === 'criterion' ? ctx.rules.criteria().find((c) => c.n === p.n) : undefined;
    return {
      kind: 'model',
      question: {
        field: `whether this contract field shows that the criterion is met: ${rule?.text_en ?? ''}`,
        claimed: f.value.value,
        excerpt: `${cf.field}: ${cf.value}`,
        excerptSha256: '',
        allowed: ['met', 'not_met', 'unknown'],
        meanings:
          'met: the field shows that what the criterion describes is true for this client; not_met: the field shows it is not true (for example "No" to the thing the criterion describes); unknown: the field does not say.',
      },
    };
  }
  return ok;
}

export function checkPlausibility(f: Figure, year: number): string | undefined {
  const p = parseKey(f.key);
  const v = f.value;
  const lo = toIso({ y: year - 1, m: 1, d: 1 });
  const hi = toIso({ y: year + 1, m: 12, d: 31 });
  if (v.t === 'date' && (compareIso(v.iso, lo) < 0 || compareIso(v.iso, hi) > 0))
    return `date ${v.iso} is outside ${year - 1}-${year + 1}`;
  if (v.t === 'money' && !isCurrency(v.currency)) return `currency ${v.currency} is not supported`;
  if (v.t === 'money' && (p?.kind === 'invoice' || p?.kind === 'payment') && !isPositive(v.amount))
    return `amount ${v.amount} is not positive`;
  if (p?.kind === 'invoice' && !isValidInvoiceNumber(p.invNo))
    return `invoice number ${p.invNo} is not valid`;
  if (p?.kind === 'invoice' && p.field === 'currency' && v.t === 'text' && !isCurrency(v.text))
    return `currency ${v.text} is not supported`;
  if (v.t === 'rate' && !isPositive(v.rate)) return `rate ${v.rate} is not positive`;
  return undefined;
}
