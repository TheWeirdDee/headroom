// A deterministic stand-in for the model, for tests only. It reads the request text it is given (the
// invoice lines, statement rows, KPO rows, contract fields, or the excerpt to check) the way a model
// would, using the known layouts of the synthetic samples. It never sees ground truth.
import { parse } from 'csv-parse/sync';
import type { HrInferenceRequest, HrInferenceResponse, ModelBackend } from '../../src/runtime/types.ts';
import { parseAmount, parseDate } from '../../src/inputs/parse.ts';

const COUNTRY: Record<string, string> = {
  srbija: 'RS',
  serbia: 'RS',
  nemačka: 'DE',
  germany: 'DE',
  holandija: 'NL',
  netherlands: 'NL',
  'velika britanija': 'GB',
  'united kingdom': 'GB',
  sad: 'US',
  'united states': 'US',
  švajcarska: 'CH',
  switzerland: 'CH',
};

const INVOICE_NO = /\b(\d{4}-\d{3})\b/;

function block(text: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text);
  return m?.[1] ?? '';
}

function countryIn(text: string): string | undefined {
  const lower = text.toLowerCase();
  const hit = Object.keys(COUNTRY).find((name) => lower.endsWith(name) || lower.includes(`, ${name}`));
  return hit ? COUNTRY[hit] : undefined;
}

function rowClass(text: string): 'client_payment' | 'own_transfer' | 'refund' | 'fee' | 'other' {
  const t = text.toLowerCase();
  if (/provizija|naknada|kamata/.test(t)) return 'fee';
  if (/prenos sopstvenih|konverzija|interni prenos/.test(t)) return 'own_transfer';
  if (/povraćaj|refund/.test(t)) return 'refund';
  return 'client_payment';
}

function readInvoice(req: HrInferenceRequest): unknown {
  const lines = block(req.user, 'document')
    .split('\n')
    .filter((l) => !l.startsWith('--- page'))
    .map((l) => l.replace(/^\d+: /, ''));
  const find = (re: RegExp): { line: string; m: RegExpExecArray } | undefined => {
    for (const line of lines) {
      const m = re.exec(line);
      if (m) return { line, m };
    }
    return undefined;
  };
  const field = (
    re: RegExp,
    value: (m: RegExpExecArray) => string | undefined,
  ): { value: string; excerpt: string } | null => {
    const hit = find(re);
    const v = hit ? value(hit.m) : undefined;
    return hit && v ? { value: v, excerpt: hit.line } : null;
  };
  const number = field(/^(?:Broj fakture:|Invoice No\.) (\S+)$/, (m) => m[1]);
  if (!number)
    return {
      isInvoice: false,
      invoiceNumber: null,
      issueDate: null,
      supplyDate: null,
      clientName: null,
      clientTaxId: null,
      clientCountry: null,
      currency: null,
      amount: null,
      kind: null,
    };
  const sr = lines.some((l) => l.startsWith('Broj fakture:'));
  const date = (s: string): string | undefined =>
    sr ? parseDate(s, 'DD.MM.YYYY') : parseDate(s, 'YYYY-MM-DD');
  const total = sr
    ? find(/^Ukupno za uplatu: ([\d.,]+) ([A-Z]{3})$/)
    : find(/^Total due: ([A-Z]{3}) ([\d.,]+)$/);
  const amountText = total ? (sr ? total.m[1] : total.m[2]) : undefined;
  const currency = total ? (sr ? total.m[2] : total.m[1]) : undefined;
  const amount = amountText ? parseAmount(amountText, sr ? ',' : '.') : undefined;
  return {
    isInvoice: true,
    invoiceNumber: number,
    issueDate: field(/^(?:Datum izdavanja:|Issue date:) (\S+)$/, (m) => date(m[1] ?? '')),
    supplyDate: field(/^(?:Datum prometa:|Date of supply:) (\S+)$/, (m) => date(m[1] ?? '')),
    clientName: field(/^(?:Kupac:|Bill to:) (.+)$/, (m) => m[1]),
    clientTaxId: field(/^(?:PIB\/VAT kupca:|Customer VAT ID:) (.+)$/, (m) => m[1]),
    clientCountry: field(/^(?:Adresa kupca:|Address:) (.+)$/, (m) => countryIn(m[1] ?? '')),
    currency: total && currency ? { value: currency, excerpt: total.line } : null,
    amount:
      total && amount ? { value: amount.includes('.') ? amount : `${amount}.00`, excerpt: total.line } : null,
    kind: field(/^(?:Opis:|Item:) .+\((usluga|proizvod|service|product)\)$/, (m) =>
      m[1] === 'usluga' || m[1] === 'service' ? 'service' : 'product',
    ),
  };
}

function classifyRows(req: HrInferenceRequest): unknown {
  const rows = block(req.user, 'rows')
    .split('\n')
    .map((l) => {
      const idx = /^(\d+): (.*)$/.exec(l);
      return idx ? { index: +(idx[1] ?? 0), raw: idx[2] ?? '' } : undefined;
    })
    .filter((r): r is { index: number; raw: string } => r !== undefined);
  return {
    rows: rows.map((r) => {
      const cells = (parse(r.raw, { relax_quotes: true }) as string[][])[0] ?? [];
      const description = cells[2] ?? '';
      const reference = cells[4] ?? '';
      const cls = rowClass(description);
      const inv = INVOICE_NO.exec(`${reference} ${description}`)?.[1] ?? null;
      return {
        index: r.index,
        class: cls,
        invoiceNumber: cls === 'client_payment' ? inv : null,
        reasonExcerpt: description || r.raw.slice(0, 20),
      };
    }),
  };
}

function matchKpo(req: HrInferenceRequest): unknown {
  const rows = block(req.user, 'rows')
    .split('\n')
    .map((l) => /^(\d+): \S+ \| (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  return {
    rows: rows.map((m) => {
      const inv = INVOICE_NO.exec(m[2] ?? '')?.[1] ?? null;
      return { index: +(m[1] ?? 0), invoiceNumber: inv, reasonExcerpt: inv ?? '' };
    }),
  };
}

function judgeCriteria(req: HrInferenceRequest): unknown {
  const fields = new Map(
    block(req.user, 'contract')
      .split('\n')
      .map((l) => /^([A-Za-z]+): (.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1] ?? '', m[2] ?? '']),
  );
  const criteria = block(req.user, 'criteria')
    .split('\n')
    .map((l) => /^(\d) \(field (\w+)\):/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  return {
    criteria: criteria.map((m) => {
      const field = m[2] ?? '';
      const v = fields.get(field) ?? '';
      return {
        n: +(m[1] ?? 0),
        value: /^(yes|da)\b/i.test(v) ? 'met' : /^(no|ne)\b/i.test(v) ? 'not_met' : 'unknown',
        field,
        fieldValue: v,
      };
    }),
  };
}

function checkFidelity(req: HrInferenceRequest): string {
  const about = /^Claim is about: (.*)$/m.exec(req.user)?.[1] ?? '';
  const claimed = /^Claimed value: (.*)$/m.exec(req.user)?.[1] ?? '';
  const source = block(req.user, 'source');
  let normalized = '';
  if (about.includes('country code')) normalized = countryIn(source.replace(/^[^:]+: /, '')) ?? '';
  else if (about.includes('goods'))
    normalized = /usluga|\(service\)/.test(source)
      ? 'service'
      : /proizvod|\(product\)/.test(source)
        ? 'product'
        : '';
  else if (about.includes('bank payment')) {
    const cells = (parse(source, { relax_quotes: true }) as string[][])[0] ?? [];
    normalized = rowClass(cells[2] ?? '');
  } else if (about.includes('contract field')) {
    const v = source.replace(/^\w+: /, '');
    normalized = /^(yes|da)\b/i.test(v) ? 'met' : /^(no|ne)\b/i.test(v) ? 'not_met' : 'unknown';
  }
  return JSON.stringify({
    normalizedValue: normalized,
    supports: normalized === claimed,
    reason: `The source shows ${normalized || 'nothing for this'}.`,
  });
}

const TOOL: Record<string, string> = {
  'invoice-reader': 'submit_invoice',
  'statement-reader': 'submit_rows',
  'kpo-reader': 'submit_matches',
  'independence-checker': 'submit_criteria',
};

export function fakeModel(opts: { delayMs?: number } = {}): ModelBackend & { calls: number } {
  const backend = {
    calls: 0,
    async infer(req: HrInferenceRequest): Promise<HrInferenceResponse> {
      backend.calls += 1;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (req.agentId === 'verifier')
        return { items: [{ type: 'message', text: checkFidelity(req) }], tokensIn: 120, tokensOut: 30 };
      const tool = TOOL[req.agentId];
      if (!tool) throw new Error(`fake model has no behaviour for ${req.agentId}`);
      if (req.step > 0) return { items: [{ type: 'message', text: 'done' }], tokensIn: 50, tokensOut: 2 };
      const args =
        req.agentId === 'invoice-reader'
          ? readInvoice(req)
          : req.agentId === 'statement-reader'
            ? classifyRows(req)
            : req.agentId === 'kpo-reader'
              ? matchKpo(req)
              : judgeCriteria(req);
      return {
        items: [{ type: 'function_call', name: tool, args: JSON.stringify(args) }],
        tokensIn: 800,
        tokensOut: 200,
      };
    },
  };
  return backend;
}
