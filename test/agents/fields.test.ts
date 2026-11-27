// The Verifier's code checks reject a value that is in the document but is a different field.
import { describe, expect, it } from 'vitest';
import { checkFidelity } from '../../src/agents/verifier/fidelity.ts';
import { locateExcerpt, type ReadableDocument } from '../../src/inputs/documents.ts';
import type { SourceContext } from '../../src/agents/verifier/sources.ts';
import type { Figure, FigureValue } from '../../src/domain/types.ts';

const doc = (text: string): ReadableDocument => ({
  kind: 'readable',
  docId: 'd1',
  fileName: 'd1.pdf',
  sha256: 'x',
  pages: [text],
});

const ENGLISH = doc(
  [
    'INVOICE',
    'Invoice No. 2026-001',
    'Issue date: 2026-03-02',
    'Date of supply: 2026-02-27',
    'Due date: 2026-03-17',
    'Unit price: EUR 50.00',
    'Quantity: 40',
    'Subtotal: EUR 2,000.00',
    'VAT: EUR 0.00',
    'Total due: EUR 2,000.50',
    'Payment reference: 2026-001',
  ].join('\n'),
);

const SERBIAN = doc(
  [
    'FAKTURA',
    'Broj fakture: 2026-001',
    'Datum izdavanja: 02.03.2026   Rok plaćanja: 17.03.2026',
    'Jedinična cena: 500,00 EUR',
    'Osnovica: 1.000,00 EUR',
    'Ukupan PDV: 200,00 EUR',
    'Ukupno za uplatu: 1.200,00 EUR',
  ].join('\n'),
);

function check(
  d: ReadableDocument,
  field: 'issueDate' | 'supplyDate' | 'amount',
  value: FigureValue,
  excerpt: string,
) {
  const figure = {
    key: `invoice:2026-001:${field}`,
    value,
    sources: [locateExcerpt(d, excerpt), locateExcerpt(d, '2026-001')],
  } as unknown as Figure;
  return checkFidelity(figure, { inputs: { documents: [d], clients: [] } } as unknown as SourceContext);
}
const date = (iso: string): FigureValue => ({ t: 'date', iso });
const eur = (amount: string): FigureValue => ({ t: 'money', amount, currency: 'EUR' });

describe('issue date against due and supply dates', () => {
  it('accepts the issue date', () => {
    expect(check(ENGLISH, 'issueDate', date('2026-03-02'), 'Issue date: 2026-03-02').kind).toBe('ok');
    expect(check(SERBIAN, 'issueDate', date('2026-03-02'), '02.03.2026').kind).toBe('ok');
    expect(check(ENGLISH, 'supplyDate', date('2026-02-27'), 'Date of supply: 2026-02-27').kind).toBe('ok');
  });

  it.each([
    ['the due date, with its label', ENGLISH, '2026-03-17', 'Due date: 2026-03-17'],
    ['the due date, label left out of the excerpt', ENGLISH, '2026-03-17', '2026-03-17'],
    ['the supply date', ENGLISH, '2026-02-27', 'Date of supply: 2026-02-27'],
    ['the Serbian due date on the same line as the issue date', SERBIAN, '2026-03-17', '17.03.2026'],
  ])('rejects %s', (_name, d, iso, excerpt) => {
    const r = check(d, 'issueDate', date(iso), excerpt);
    expect(r.kind).toBe('fail');
    expect(r.kind === 'fail' && r.detail).toMatch(/not the issue date|as the issue date/);
  });
});

describe('invoice total against unit price, subtotal and tax', () => {
  it('accepts the total', () => {
    expect(check(ENGLISH, 'amount', eur('2000.50'), 'Total due: EUR 2,000.50').kind).toBe('ok');
    expect(check(SERBIAN, 'amount', eur('1200'), '1.200,00 EUR').kind).toBe('ok');
  });

  it.each([
    ['the unit price', ENGLISH, '50', 'Unit price: EUR 50.00'],
    ['the subtotal', ENGLISH, '2000', 'Subtotal: EUR 2,000.00'],
    ['the Serbian unit price', SERBIAN, '500', '500,00 EUR'],
    ['the tax base', SERBIAN, '1000', 'Osnovica: 1.000,00 EUR'],
    ['the tax total', SERBIAN, '200', 'Ukupan PDV: 200,00 EUR'],
  ])('rejects %s', (_name, d, amount, excerpt) => {
    const r = check(d, 'amount', eur(amount), excerpt);
    expect(r.kind).toBe('fail');
    expect(r.kind === 'fail' && r.detail).toMatch(/not the invoice total|as the total/);
  });

  it('rejects an unlabelled line amount when the document labels another amount as the total', () => {
    const d = doc(
      ['Invoice No. 2026-001', 'Hosting EUR 90.00', 'Support EUR 10.00', 'Total: EUR 100.00'].join('\n'),
    );
    expect(check(d, 'amount', eur('90'), 'Hosting EUR 90.00').kind).toBe('fail');
    expect(check(d, 'amount', eur('100'), 'Total: EUR 100.00').kind).toBe('ok');
  });
});
