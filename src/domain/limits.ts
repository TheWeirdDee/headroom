// R-LIMIT-6M and R-VAT-8M as pure functions over verified invoice facts. LimitKeeper maps verified
// board figures into InvoiceFact and records every input figure id in the derivation.
import { add, cmp, div, mul, sub, type DecimalString } from './money.ts';
import { isBetween, vatWindow, yearOf, type DateWindow, type IsoDate } from './dates.ts';

export interface InvoiceFact {
  invNo: string;
  issueDate: IsoDate;
  amountRSD: DecimalString;
  kind: 'product' | 'service';
  clientId: string;
  clientCountry: string;
  clientIsBusiness: boolean;
  /** Ids of the verified figures this fact is built from (issueDate, amountRSD, kind, country ...). */
  figureIds: string[];
}

export type Band = 'green' | 'amber' | 'red' | 'crossed';

export interface BandThresholds {
  amberFrom: DecimalString;
  redFrom: DecimalString;
  crossedFrom: DecimalString;
}

export interface Total {
  total: DecimalString;
  included: string[]; // invoice numbers counted
  inputFigureIds: string[];
}

function sumFacts(facts: InvoiceFact[]): Total {
  return {
    total: facts.length === 0 ? '0' : add(...facts.map((f) => f.amountRSD)),
    included: facts.map((f) => f.invNo),
    inputFigureIds: facts.flatMap((f) => f.figureIds),
  };
}

/** Calendar-year turnover by invoice issue date (R-LIMIT-6M, R-LIMIT-6M-BASIS). */
export function total6m(facts: InvoiceFact[], year: number): Total {
  return sumFacts(facts.filter((f) => yearOf(f.issueDate) === year));
}

export interface VatScope {
  includeProducts: boolean;
  includeServicesDomestic: boolean;
  includeServicesForeignNonBusiness: boolean;
  includeServicesForeignBusiness: boolean;
}

/** R-VAT-8M-SCOPE: does this invoice count toward the 8M VAT turnover? */
export function countsForVat(
  f: Pick<InvoiceFact, 'kind' | 'clientCountry' | 'clientIsBusiness'>,
  scope: VatScope,
): boolean {
  if (f.kind === 'product') return scope.includeProducts;
  if (f.clientCountry === 'RS') return scope.includeServicesDomestic;
  return f.clientIsBusiness ? scope.includeServicesForeignBusiness : scope.includeServicesForeignNonBusiness;
}

export function total8m(
  facts: InvoiceFact[],
  asOf: IsoDate,
  mode: '365d' | '12m',
  scope: VatScope,
): Total & { window: DateWindow; excluded: string[] } {
  const window = vatWindow(asOf, mode);
  const inWindow = facts.filter((f) => isBetween(f.issueDate, window.from, window.to));
  const counted = inWindow.filter((f) => countsForVat(f, scope));
  const excluded = inWindow.filter((f) => !countsForVat(f, scope)).map((f) => f.invNo);
  return { ...sumFacts(counted), window, excluded };
}

export function headroom(limit: DecimalString, total: DecimalString): DecimalString {
  return sub(limit, total);
}

/** total / limit to 6 decimals, for display. Bands never use this rounded value. */
export function ratio(total: DecimalString, limit: DecimalString): DecimalString {
  return div(total, limit, 6, 'half_up');
}

/** Band from the exact amounts: total compared with limit x threshold, no rounding involved. */
export function band(total: DecimalString, limit: DecimalString, t: BandThresholds): Band {
  if (cmp(total, mul(limit, t.crossedFrom)) >= 0) return 'crossed';
  if (cmp(total, mul(limit, t.redFrom)) >= 0) return 'red';
  if (cmp(total, mul(limit, t.amberFrom)) >= 0) return 'amber';
  return 'green';
}

/**
 * Crossing attribution: the band the with-draft 6M total would have if one open discrepancy were
 * corrected by `deltaRSD` (signed). LimitKeeper publishes hr.headroom.crossing when this differs.
 */
export function bandAfterCorrection(
  totalWithDraft: DecimalString,
  deltaRSD: DecimalString,
  limit: DecimalString,
  t: BandThresholds,
): { before: Band; after: Band } {
  return {
    before: band(totalWithDraft, limit, t),
    after: band(add(totalWithDraft, deltaRSD), limit, t),
  };
}
