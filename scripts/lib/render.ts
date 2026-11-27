// Renderers for synthetic sample files: invoice PDFs in two layouts ("tool A" in Serbian, "tool B" in
// English), the bank statement CSV (synthetic format) and the KPO book CSV. Deterministic: the
// same spec gives the same bytes.
import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { formatSr } from '../../src/domain/money.ts';
import { formatDateSr } from '../../src/domain/dates.ts';

const FONT_DIR = join(import.meta.dirname, '..', '..', 'assets', 'fonts');
export const FONT_REGULAR = join(FONT_DIR, 'Inter_400Regular.ttf');
export const FONT_BOLD = join(FONT_DIR, 'Inter_700Bold.ttf');

export interface InvoiceSpec {
  number: string;
  issueDate: string; // ISO
  supplyDate?: string;
  seller: { name: string; pib: string; address: string };
  client: { name: string; address: string; countryName: string; taxId?: string };
  currency: string;
  amount: string; // decimal string
  kind: 'product' | 'service';
  lineText: string;
  template: 'A' | 'B';
  /** Extra free-text line in the notes (used for the prompt-injection profile). */
  note?: string;
}

const COUNTRY_EN: Record<string, string> = {
  Srbija: 'Serbia',
  Nemačka: 'Germany',
  Holandija: 'Netherlands',
  'Velika Britanija': 'United Kingdom',
  SAD: 'United States',
  Švajcarska: 'Switzerland',
};

function enAmount(amount: string): string {
  const [i = '0', f = '00'] = formatSr(amount).split(',');
  return `${i.replace(/\./g, ',')}.${f}`;
}

export async function renderInvoicePdf(inv: InvoiceSpec): Promise<Buffer> {
  // Fixed metadata so the bytes are reproducible.
  const doc = new PDFDocument({
    size: 'A4',
    margin: 56,
    info: {
      Title: `Invoice ${inv.number}`,
      Producer: 'Headroom sample generator',
      Creator: 'Headroom sample generator',
      CreationDate: new Date(Date.UTC(2026, 0, 1)),
      ModDate: new Date(Date.UTC(2026, 0, 1)),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
  doc.font(FONT_REGULAR).fontSize(10);
  const line = (text: string, bold = false): void => {
    doc.font(bold ? FONT_BOLD : FONT_REGULAR).text(text);
  };
  if (inv.template === 'A') {
    line('FAKTURA', true);
    line(`Broj fakture: ${inv.number}`);
    line(`Datum izdavanja: ${formatDateSr(inv.issueDate)}`);
    if (inv.supplyDate) line(`Datum prometa: ${formatDateSr(inv.supplyDate)}`);
    line(`Izdavalac: ${inv.seller.name}, PIB ${inv.seller.pib}, ${inv.seller.address}`);
    line(`Kupac: ${inv.client.name}`);
    line(`Adresa kupca: ${inv.client.address}, ${inv.client.countryName}`);
    if (inv.client.taxId) line(`PIB/VAT kupca: ${inv.client.taxId}`);
    line(`Opis: ${inv.lineText} (${inv.kind === 'service' ? 'usluga' : 'proizvod'})`);
    line(`Ukupno za uplatu: ${formatSr(inv.amount)} ${inv.currency}`);
    line(`Poziv na broj: ${inv.number}`);
    if (inv.note) line(`Napomena: ${inv.note}`);
    line('Faktura je izdata u elektronskom obliku i važi bez pečata i potpisa.');
  } else {
    line('INVOICE', true);
    line(`Invoice No. ${inv.number}`);
    line(`Issue date: ${inv.issueDate}`);
    if (inv.supplyDate) line(`Date of supply: ${inv.supplyDate}`);
    line(`From: ${inv.seller.name}, Tax ID ${inv.seller.pib}, ${inv.seller.address}`);
    line(`Bill to: ${inv.client.name}`);
    line(`Address: ${inv.client.address}, ${COUNTRY_EN[inv.client.countryName] ?? inv.client.countryName}`);
    if (inv.client.taxId) line(`Customer VAT ID: ${inv.client.taxId}`);
    line(`Item: ${inv.lineText} (${inv.kind})`);
    line(`Total due: ${inv.currency} ${enAmount(inv.amount)}`);
    line(`Payment reference: ${inv.number}`);
    if (inv.note) line(`Notes: ${inv.note}`);
  }
  line('SYNTHETIC SAMPLE DOCUMENT. NOT A REAL INVOICE.');
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

export interface StatementRowSpec {
  date: string;
  valueDate: string;
  description: string;
  counterparty: string;
  reference: string;
  amount: string;
  currency: string;
  direction: 'PRILIV' | 'ODLIV';
  balance: string;
}

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function renderStatementCsv(rows: StatementRowSpec[]): string {
  const header = 'Datum,Datum valute,Opis,Nalogodavac/Primalac,Poziv na broj,Iznos,Valuta,Smer,Stanje';
  const body = rows.map((r) =>
    [
      r.date,
      r.valueDate,
      r.description,
      r.counterparty,
      r.reference,
      r.amount,
      r.currency,
      r.direction,
      r.balance,
    ]
      .map(csvCell)
      .join(','),
  );
  return `${[header, ...body].join('\n')}\n`;
}

export interface KpoRowSpec {
  date: string;
  description: string;
  products: string;
  services: string;
  total: string;
}

export function renderKpoCsv(rows: KpoRowSpec[]): string {
  const header =
    'Redni broj,Datum,Opis knjiženja,Prihod od prodaje proizvoda,Prihod od izvršenih usluga,Svega prihodi od delatnosti';
  const body = rows.map((r, i) =>
    [String(i + 1), r.date, r.description, r.products, r.services, r.total].map(csvCell).join(','),
  );
  return `${[header, ...body].join('\n')}\n`;
}
