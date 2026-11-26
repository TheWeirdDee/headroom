// KPO book PDF (PRD 16.1): official layout, header fields, totals, disclaimer, and the correction log on a
// second page. Inter (OFL, assets/fonts) renders Serbian letters.
import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { formatSr } from '../domain/money.ts';
import { formatDateSr } from '../domain/dates.ts';
import type { KpoExport } from './kpo.ts';

const FONT_DIR = join(import.meta.dirname, '..', '..', 'assets', 'fonts');
const REGULAR = join(FONT_DIR, 'Inter_400Regular.ttf');
const BOLD = join(FONT_DIR, 'Inter_700Bold.ttf');

export async function kpoPdf(x: KpoExport): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 40,
    info: { Title: 'KPO knjiga', Producer: 'Headroom' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  doc.font(BOLD).fontSize(13).text('KPO - KNJIGA O OSTVARENOM PROMETU PAUŠALNO OPOREZOVANIH OBVEZNIKA');
  doc.moveDown(0.4).font(REGULAR).fontSize(9);
  for (const [k, v] of x.header) doc.text(`${k}: ${v}`);
  if (x.synthetic) doc.font(BOLD).text('SYNTHETIC DATA').font(REGULAR);
  doc.text(x.disclaimer, { width: 740 });
  doc.moveDown(0.6);

  const cols = [40, 90, 420, 540, 660, 780];
  const widths = cols.slice(1).map((c, i) => c - (cols[i] ?? 0) - 6);
  const row = (cells: string[], bold = false): void => {
    if (doc.y > 520) doc.addPage();
    const y = doc.y;
    doc.font(bold ? BOLD : REGULAR).fontSize(8.5);
    let h = 0;
    cells.forEach((c, i) => {
      const align = i >= 2 ? 'right' : 'left';
      doc.text(c, cols[i] ?? 40, y, { width: widths[i] ?? 80, align });
      h = Math.max(h, doc.y - y);
    });
    doc.y = y + h + 3;
    doc.x = 40;
  };
  row(x.columns, true);
  row(['1', '2', '3', '4', '5'], true);
  for (const r of x.book.rows) {
    row([
      String(r.rowNo),
      `${formatDateSr(r.date)} ${r.description}`,
      formatSr(r.productsRSD),
      formatSr(r.servicesRSD),
      formatSr(r.totalRSD),
    ]);
  }
  row(
    [
      '',
      'Ukupno',
      formatSr(x.book.totals.productsRSD),
      formatSr(x.book.totals.servicesRSD),
      formatSr(x.book.totals.totalRSD),
    ],
    true,
  );

  doc.addPage();
  doc.font(BOLD).fontSize(12).text('Correction log', 40, 40);
  doc.font(REGULAR).fontSize(8.5).moveDown(0.4);
  if (x.corrections.length === 0)
    doc.text('No corrections: the KPO book you provided matches the verified invoices.');
  for (const c of x.corrections) {
    if (doc.y > 500) doc.addPage();
    doc.font(BOLD).text(`${c.type} - invoice ${c.invoice}`);
    doc.font(REGULAR).text(`Your book: ${c.original}`, { width: 740 });
    doc.text(`Corrected: ${c.corrected}`, { width: 740 });
    doc.text(c.why, { width: 740 });
    doc.text(`Figures: ${c.figureIds.join(', ')}`, { width: 740 });
    doc.moveDown(0.4);
  }
  doc.moveDown(0.6).text(x.disclaimer, { width: 740 });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
