import { parseDigits } from './int.ts';

// Canonical figure keys. Shared keys are deliberate: readers that claim facts about the
// same invoice use the same key, so agreement corroborates and disagreement conflicts.

export type InvoiceField =
  'issueDate' | 'supplyDate' | 'amount' | 'currency' | 'client' | 'clientCountry' | 'kind' | 'amountRSD';

export type PaymentField = 'amount' | 'date' | 'currency' | 'counterparty' | 'class';
/** withUnbilled (6M only): the draft total plus client payments that have no invoice yet. */
export type Scope = 'committed' | 'withDraft' | 'withUnbilled';
export type LimitId = 'limit6m' | 'vat8m';

/** Trim, upper-case and remove internal whitespace: " inv 2026-041 " -> "INV2026-041". */
export function normalizeInvoiceNumber(raw: string): string {
  return raw.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidInvoiceNumber(n: string): boolean {
  return n.length > 0 && n.length <= 64 && /^[A-Z0-9][A-Z0-9/_.-]*$/.test(n);
}

export class InvalidInvoiceNumberError extends Error {
  constructor(raw: string) {
    super(`Not a usable invoice number: "${raw}"`);
    this.name = 'InvalidInvoiceNumberError';
  }
}

/** Normalise and validate; key builders never accept a number that would break the key format. */
export function invoiceNumberForKey(raw: string): string {
  const n = normalizeInvoiceNumber(raw);
  if (!isValidInvoiceNumber(n)) throw new InvalidInvoiceNumberError(raw);
  return n;
}

export const keys = {
  invoice: (invNo: string, field: InvoiceField): string => `invoice:${invoiceNumberForKey(invNo)}:${field}`,
  kpoRow: (invNo: string): string => `kpo_row:${invoiceNumberForKey(invNo)}`,
  payment: (rowRef: string, field: PaymentField): string => `payment:${rowRef}:${field}`,
  paymentLink: (rowRef: string): string => `link:payment:${rowRef}:invoice`,
  fx: (currency: string, date: string): string => `fx:${currency}:${date}`,
  draft: (field: 'amount' | 'currency' | 'issueDate' | 'client' | 'amountRSD'): string => `draft:${field}`,
  total: (limit: LimitId, scope: Scope): string => `total:${limit}:${scope}`,
  headroom: (limit: LimitId, scope: Scope): string => `headroom:${limit}:${scope}`,
  ratio: (limit: LimitId, scope: Scope): string => `ratio:${limit}:${scope}`,
  criterion: (clientId: string, n: number): string => `criterion:${clientId}:${n}`,
  share12m: (clientId: string, scope: Scope): string => `share12m:${clientId}:${scope}`,
  indepStatus: (clientId: string): string => `indep:${clientId}:status`,
  discrepancy: (type: string, subjectKey: string): string => `discrepancy:${type}:${subjectKey}`,
};

export type ParsedKey =
  | { kind: 'invoice'; invNo: string; field: InvoiceField }
  | { kind: 'kpo_row'; invNo: string }
  | { kind: 'payment'; rowRef: string; field: PaymentField }
  | { kind: 'link'; rowRef: string }
  | { kind: 'fx'; currency: string; date: string }
  | { kind: 'draft'; field: string }
  | { kind: 'total' | 'headroom' | 'ratio'; limit: LimitId; scope: Scope }
  | { kind: 'criterion'; clientId: string; n: number }
  | { kind: 'share12m'; clientId: string; scope: Scope }
  | { kind: 'indep'; clientId: string }
  | { kind: 'discrepancy'; type: string; subjectKey: string };

const INVOICE_FIELDS: readonly string[] = [
  'issueDate',
  'supplyDate',
  'amount',
  'currency',
  'client',
  'clientCountry',
  'kind',
  'amountRSD',
];
const PAYMENT_FIELDS: readonly string[] = ['amount', 'date', 'currency', 'counterparty', 'class'];

export function parseKey(key: string): ParsedKey | undefined {
  const parts = key.split(':');
  const [head = '', a = '', b = '', c = ''] = parts;
  const n = parts.length;
  const isScope = (x: string): x is Scope => x === 'committed' || x === 'withDraft' || x === 'withUnbilled';
  const isLimit = (x: string): x is LimitId => x === 'limit6m' || x === 'vat8m';
  switch (head) {
    case 'invoice':
      return n === 3 && INVOICE_FIELDS.includes(b)
        ? { kind: 'invoice', invNo: a, field: b as InvoiceField }
        : undefined;
    case 'kpo_row':
      return n === 2 ? { kind: 'kpo_row', invNo: a } : undefined;
    case 'payment':
      return n === 3 && PAYMENT_FIELDS.includes(b)
        ? { kind: 'payment', rowRef: a, field: b as PaymentField }
        : undefined;
    case 'link':
      return n === 4 && a === 'payment' && c === 'invoice' ? { kind: 'link', rowRef: b } : undefined;
    case 'fx':
      return n === 3 ? { kind: 'fx', currency: a, date: b } : undefined;
    case 'draft':
      return n === 2 ? { kind: 'draft', field: a } : undefined;
    case 'total':
    case 'headroom':
    case 'ratio':
      return n === 3 && isLimit(a) && isScope(b) ? { kind: head, limit: a, scope: b } : undefined;
    case 'criterion':
      return n === 3 && /^[1-9]$/.test(b) ? { kind: 'criterion', clientId: a, n: parseDigits(b) } : undefined;
    case 'share12m':
      return n === 3 && isScope(b) ? { kind: 'share12m', clientId: a, scope: b } : undefined;
    case 'indep':
      return n === 3 && b === 'status' ? { kind: 'indep', clientId: a } : undefined;
    case 'discrepancy':
      return n >= 3 ? { kind: 'discrepancy', type: a, subjectKey: parts.slice(2).join(':') } : undefined;
    default:
      return undefined;
  }
}
