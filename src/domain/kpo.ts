// R-KPO: the corrected KPO book, built only from verified invoice facts, in the official layout
// (R-KPO-LAYOUT). Also parses the user's existing book rows (code, never a model).
import { add, canonical, isDecimalString, money, type DecimalString, type Rounding } from './money.ts';
import { compareIso, yearOf, type IsoDate } from './dates.ts';

export interface KpoInvoice {
  invNo: string;
  entryDate: IsoDate; // R-KPO-DATE: invoice issue date by default
  clientName: string;
  kind: 'product' | 'service';
  amountRSD: DecimalString;
  figureIds: string[];
}

export interface KpoRow {
  rowNo: number;
  date: IsoDate;
  description: string;
  productsRSD: DecimalString;
  servicesRSD: DecimalString;
  totalRSD: DecimalString;
  invNo: string;
  figureIds: string[];
}

export interface KpoBook {
  year: number;
  rows: KpoRow[];
  totals: { productsRSD: DecimalString; servicesRSD: DecimalString; totalRSD: DecimalString };
}

/** One row per verified invoice issued in the year, sorted by entry date then invoice number. */
export function buildKpoBook(invoices: KpoInvoice[], year: number, rounding: Rounding = 'half_up'): KpoBook {
  const sorted = invoices
    .filter((i) => yearOf(i.entryDate) === year)
    .sort(
      (a, b) =>
        compareIso(a.entryDate, b.entryDate) || a.invNo.localeCompare(b.invNo, 'en', { numeric: true }),
    );
  const rows = sorted.map<KpoRow>((i, idx) => {
    const amount = money(i.amountRSD, rounding);
    const products = i.kind === 'product' ? amount : '0.00';
    const services = i.kind === 'service' ? amount : '0.00';
    return {
      rowNo: idx + 1,
      date: i.entryDate,
      description: `Faktura ${i.invNo}, ${i.clientName}`,
      productsRSD: products,
      servicesRSD: services,
      totalRSD: money(add(products, services)),
      invNo: i.invNo,
      figureIds: i.figureIds,
    };
  });
  const sum = (pick: (r: KpoRow) => DecimalString): DecimalString =>
    money(rows.length === 0 ? '0' : add(...rows.map(pick)));
  return {
    year,
    rows,
    totals: {
      productsRSD: sum((r) => r.productsRSD),
      servicesRSD: sum((r) => r.servicesRSD),
      totalRSD: sum((r) => r.totalRSD),
    },
  };
}

/** A row of the user's existing KPO book as parsed by code from their CSV. */
export interface ExistingKpoRow {
  rowIndex: number; // 1-based data row index in the file
  rawLine: string;
  entryDate: IsoDate;
  description: string;
  productsRSD: DecimalString;
  servicesRSD: DecimalString;
  totalRSD: DecimalString;
}

export class KpoRowError extends Error {
  constructor(
    readonly rowIndex: number,
    detail: string,
  ) {
    super(`KPO row ${rowIndex}: ${detail}`);
    this.name = 'KpoRowError';
  }
}

/** Validate a parsed row: amounts are decimals, and total equals products + services exactly. */
export function checkExistingRow(r: ExistingKpoRow): ExistingKpoRow {
  for (const [name, v] of [
    ['products', r.productsRSD],
    ['services', r.servicesRSD],
    ['total', r.totalRSD],
  ] as const) {
    if (!isDecimalString(v)) throw new KpoRowError(r.rowIndex, `${name} is not a number: "${v}"`);
  }
  if (canonical(add(r.productsRSD, r.servicesRSD)) !== canonical(r.totalRSD)) {
    throw new KpoRowError(r.rowIndex, 'column 5 is not column 3 + column 4');
  }
  return r;
}

/** The book's kind for a row: which column holds the amount. Mixed rows are reported as such. */
export function existingRowKind(r: ExistingKpoRow): 'product' | 'service' | 'mixed' {
  const p = canonical(r.productsRSD) !== '0';
  const s = canonical(r.servicesRSD) !== '0';
  if (p && s) return 'mixed';
  return p ? 'product' : 'service';
}
