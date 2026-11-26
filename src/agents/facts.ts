// Build domain facts from verified board figures. Used by LimitKeeper to compute totals and by the
// Verifier to re-derive them from the cited input figure ids, so both sides use the same definition.
import { parseKey } from '../domain/keys.ts';
import type { InvoiceFact } from '../domain/limits.ts';
import type { Client, Figure } from '../domain/types.ts';
import type { HeadroomState } from '../runtime/state.ts';

export interface InvoiceRecord {
  invNo: string;
  issueDate?: Figure;
  amountRSD?: Figure;
  kind?: Figure;
  clientCountry?: Figure;
  client?: Figure;
}

/** Group invoice figures by invoice number (the caller decides which figures to pass in). */
export function invoiceRecords(figures: Figure[]): Map<string, InvoiceRecord> {
  const out = new Map<string, InvoiceRecord>();
  for (const f of figures) {
    const p = parseKey(f.key);
    if (p?.kind !== 'invoice') continue;
    const rec = out.get(p.invNo) ?? { invNo: p.invNo };
    if (
      p.field === 'issueDate' ||
      p.field === 'amountRSD' ||
      p.field === 'kind' ||
      p.field === 'clientCountry' ||
      p.field === 'client'
    ) {
      rec[p.field] = f;
    }
    out.set(p.invNo, rec);
  }
  return out;
}

export function verifiedInvoiceFigures(state: HeadroomState): Figure[] {
  return state.figuresWhere((f) => f.status === 'verified' && f.key.startsWith('invoice:'));
}

/** Facts for the 6M limit: issue date and RSD amount verified. */
export function sixMFacts(records: Map<string, InvoiceRecord>, clients: Client[]): InvoiceFact[] {
  const out: InvoiceFact[] = [];
  for (const r of records.values()) {
    if (r.issueDate?.value.t !== 'date' || r.amountRSD?.value.t !== 'money') continue;
    out.push(toFact(r, clients, [r.issueDate.id, r.amountRSD.id]));
  }
  return out;
}

/** Facts for the 8M threshold: also need verified kind and client country to apply the scope rule. */
export function eightMFacts(records: Map<string, InvoiceRecord>, clients: Client[]): InvoiceFact[] {
  const out: InvoiceFact[] = [];
  for (const r of records.values()) {
    if (r.issueDate?.value.t !== 'date' || r.amountRSD?.value.t !== 'money') continue;
    if (r.kind?.value.t !== 'text' || r.clientCountry?.value.t !== 'text') continue;
    out.push(
      toFact(r, clients, [
        r.issueDate.id,
        r.amountRSD.id,
        r.kind.id,
        r.clientCountry.id,
        ...(r.client ? [r.client.id] : []),
      ]),
    );
  }
  return out;
}

function toFact(r: InvoiceRecord, clients: Client[], figureIds: string[]): InvoiceFact {
  const clientId = r.client?.value.t === 'text' ? r.client.value.text : '';
  const client = clients.find((c) => c.id === clientId);
  return {
    invNo: r.invNo,
    issueDate: r.issueDate?.value.t === 'date' ? r.issueDate.value.iso : '',
    amountRSD: r.amountRSD?.value.t === 'money' ? r.amountRSD.value.amount : '0',
    kind: r.kind?.value.t === 'text' && r.kind.value.text === 'product' ? 'product' : 'service',
    clientId,
    clientCountry: r.clientCountry?.value.t === 'text' ? r.clientCountry.value.text : '',
    // Unknown clients are treated as businesses (the usual case for invoices); clients.json overrides.
    clientIsBusiness: client ? client.isBusiness : true,
    figureIds,
  };
}
