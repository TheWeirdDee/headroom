// R-INDEP: criterion 6 share computation over every qualifying 12-month window, and the per-client
// status from criterion counts. Criteria other than 6 come from contract fields or user answers.
import { add, cmp, div, isZero, mul, type DecimalString } from './money.ts';
import {
  compareIso,
  daysInMonth,
  isBetween,
  parseIso,
  toIso,
  twelveMonthWindowsForTaxYear,
  type DateWindow,
  type IsoDate,
} from './dates.ts';

export interface IncomeFact {
  clientId: string;
  date: IsoDate;
  amountRSD: DecimalString;
  figureIds: string[];
}

export interface ShareResult {
  clientId: string;
  share: DecimalString; // 0..1, 6 decimals
  window: DateWindow;
  clientIncome: DecimalString;
  totalIncome: DecimalString;
  inputFigureIds: string[];
  windowsEvaluated: number;
}

function endOfMonth(d: IsoDate): IsoDate {
  const { y, m } = parseIso(d);
  return toIso({ y, m, d: daysInMonth(y, m) });
}

function firstOfMonth(d: IsoDate): IsoDate {
  const { y, m } = parseIso(d);
  return toIso({ y, m, d: 1 });
}

/**
 * Windows evaluated for criterion 6 (R-INDEP-C6-WINDOWS, R-INDEP-C6-HORIZON): every 12-calendar-month
 * window that starts or ends in the tax year and has ended by the end of the `through` month, and either
 * lies inside the period the inputs cover (from `coverageFrom`) or is the trailing window ending with the
 * `through` month. Windows reaching into the future, or mostly before the data starts, hold only part of
 * their income and would give a misleading share.
 */
export function criterion6Windows(taxYear: number, through: IsoDate, coverageFrom?: IsoDate): DateWindow[] {
  const limit = endOfMonth(through);
  const covered = coverageFrom ? firstOfMonth(coverageFrom) : undefined;
  return twelveMonthWindowsForTaxYear(taxYear).filter(
    (w) =>
      compareIso(w.to, limit) <= 0 &&
      (covered === undefined || compareIso(w.from, covered) >= 0 || w.to === limit),
  );
}

/** Highest share of total income from `clientId` across the evaluated windows (ties: earliest window). */
export function maxShare(
  incomes: IncomeFact[],
  clientId: string,
  taxYear: number,
  through: IsoDate,
  coverageFrom?: IsoDate,
): ShareResult | undefined {
  let best: ShareResult | undefined;
  const windows = criterion6Windows(taxYear, through, coverageFrom);
  for (const w of windows) {
    const inW = incomes.filter((i) => isBetween(i.date, w.from, w.to));
    if (inW.length === 0) continue;
    const total = add(...inW.map((i) => i.amountRSD));
    if (isZero(total)) continue;
    const mine = inW.filter((i) => i.clientId === clientId);
    const clientIncome = mine.length === 0 ? '0' : add(...mine.map((i) => i.amountRSD));
    const share = div(clientIncome, total, 6, 'half_up');
    // Compare exact fractions (clientIncome / total), not the rounded display share.
    if (!best || cmp(mul(clientIncome, best.totalIncome), mul(best.clientIncome, total)) > 0) {
      best = {
        clientId,
        share,
        window: w,
        clientIncome,
        totalIncome: total,
        inputFigureIds: inW.flatMap((i) => i.figureIds),
        windowsEvaluated: windows.length,
      };
    }
  }
  return best;
}

/** Met when clientIncome >= threshold x totalIncome, computed exactly (never from the rounded share). */
export function criterion6Met(
  r: Pick<ShareResult, 'clientIncome' | 'totalIncome'>,
  threshold: DecimalString,
): boolean {
  return cmp(r.clientIncome, mul(r.totalIncome, threshold)) >= 0;
}

export type Tri = 'met' | 'not_met' | 'unknown';
export type IndepStatus = 'passes' | 'at_risk' | 'fails' | 'not_applicable';

export interface CriteriaCount {
  met: number;
  notMet: number;
  unknown: number;
}

export function countCriteria(values: Tri[]): CriteriaCount {
  return {
    met: values.filter((v) => v === 'met').length,
    notMet: values.filter((v) => v === 'not_met').length,
    unknown: values.filter((v) => v === 'unknown').length,
  };
}

/** fails if met >= 5; at risk if met + unknown >= 5; otherwise passes. Exempt activities: not applicable. */
export function independenceStatus(c: CriteriaCount, threshold: number, exempt: boolean): IndepStatus {
  if (exempt) return 'not_applicable';
  if (c.met >= threshold) return 'fails';
  if (c.met + c.unknown >= threshold) return 'at_risk';
  return 'passes';
}
