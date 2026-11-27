// Domain data model. Every Figure carries a non-empty `sources` tuple: "every number has a
// source" is enforced by the type system and again at runtime by the Verifier.
import type { DecimalString, Rounding } from './money.ts';
import type { IsoDate } from './dates.ts';

export type { DecimalString, IsoDate, Rounding };

/** Currencies NBS publishes a middle rate for that Headroom accepts. */
export const CURRENCIES = ['RSD', 'EUR', 'USD', 'GBP', 'CHF'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(s: unknown): s is Currency {
  return typeof s === 'string' && (CURRENCIES as readonly string[]).includes(s);
}

export type SourceRef =
  | {
      type: 'document';
      docId: string;
      page: number;
      lineStart: number;
      lineEnd: number;
      excerpt: string;
      excerptSha256: string;
    }
  | { type: 'statement_row'; file: string; rowIndex: number; rawLine: string; rawLineSha256: string }
  | { type: 'kpo_row'; file: string; rowIndex: number; rawLine: string; rawLineSha256: string }
  | {
      type: 'url';
      url: string;
      fetchedAt: string;
      httpStatus: number;
      responseSha256: string;
      jsonPath: string;
    }
  | { type: 'contract_field'; clientId: string; field: string; value: string }
  | { type: 'user_answer'; questionId: string; answeredAt: string; answer: string }
  | { type: 'rule'; ruleId: string; url: string }
  | { type: 'derived'; figureIds: [string, ...string[]] };

export type SourceType = SourceRef['type'];
export type NonEmpty<T> = [T, ...T[]];

export interface Derivation {
  ruleId: string;
  inputs: string[]; // figure ids
  formula: string; // human-readable
}

export type FigureKind =
  | 'invoice_field'
  | 'payment_field'
  | 'link'
  | 'fx_rate'
  | 'amount_rsd'
  | 'kpo_row'
  | 'total'
  | 'headroom'
  | 'ratio'
  | 'criterion'
  | 'share'
  | 'indep_status'
  | 'discrepancy'
  | 'draft_field';

export type FigureValue =
  | { t: 'money'; amount: DecimalString; currency: Currency }
  | {
      t: 'rate';
      rate: DecimalString;
      base: Currency;
      quote: 'RSD';
      parity: number;
      requestedDate: IsoDate;
      rateDate: IsoDate;
    }
  | { t: 'date'; iso: IsoDate }
  | { t: 'text'; text: string }
  | { t: 'ratio'; value: DecimalString; window?: { from: IsoDate; to: IsoDate } }
  | { t: 'tri'; value: 'met' | 'not_met' | 'unknown' }
  | {
      t: 'kpoRow';
      rowNo: number;
      date: IsoDate;
      description: string;
      productsRSD: DecimalString;
      servicesRSD: DecimalString;
      totalRSD: DecimalString;
    };

export type ClaimStatus = 'proposed' | 'verified' | 'contested' | 'superseded' | 'needs_user';

export type CheckName = 'source_presence' | 'integrity' | 'derivation' | 'fidelity' | 'plausibility';
export interface VerificationCheck {
  name: CheckName;
  passed: boolean;
  detail?: string;
}

export interface Figure {
  id: string;
  key: string;
  kind: FigureKind;
  value: FigureValue;
  sources: NonEmpty<SourceRef>;
  derivation?: Derivation;
  producedBy: string;
  version: number;
  status: ClaimStatus;
  checks?: VerificationCheck[];
  createdAt: string;
  scope: 'committed' | 'draft';
}

export interface Question {
  id: string;
  askedBy: string;
  subjectKey: string;
  text: string;
  options: string[];
  answer?: string;
  answeredAt?: string;
  ruleId?: string;
}

export const DISCREPANCY_TYPES = [
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
  'E6',
  'E7',
  'E8',
  'E9',
  'E-CONFLICT',
  'E-DOC-UNREADABLE',
] as const;
export type DiscrepancyType = (typeof DISCREPANCY_TYPES)[number];

export interface Discrepancy {
  id: string;
  type: DiscrepancyType;
  title: string;
  detail: string;
  figureIds: string[];
  sources: SourceRef[];
  status: ClaimStatus;
  /** Effect on the 6M with-draft total if corrected, in RSD (signed), when computable. */
  deltaRSD?: DecimalString;
  /**
   * What the delta is measured from: 'book' = the user's own KPO book total (E2-E7 move it toward the
   * corrected total); 'corrected' = Headroom's verified total (E1: a payment that has no invoice).
   */
  baseline?: 'book' | 'corrected';
  /** A foreign-currency payment whose RSD effect needs the NBS rate of its date. */
  payment?: { currency: Currency; amount: DecimalString; date: IsoDate };
  subjectKey?: string;
  producedBy?: string;
}

export type FxDateRule = 'invoice_issue_date' | 'supply_date' | 'payment_date';

export interface RunConfig {
  year: number;
  asOf: IsoDate;
  fxDateRule: FxDateRule;
  vatWindow: '365d' | '12m';
  indepIncomeBasis: 'invoiced' | 'received';
  rsdRounding: Rounding;
  models: { reader: string; verifier: string };
  /** Models to move to when a daily quota is used up. Empty for recordings and evaluations. */
  backupModels?: string[];
  concurrency: { invoice: number; statement: number; kpo: number; verifier: number };
  loopTimeoutMs: number;
  maxRetries: number;
}

/** A client as described in clients.json (synthetic for samples, user-provided otherwise). */
export interface Client {
  id: string;
  name: string;
  country: string; // ISO 3166-1 alpha-2
  isBusiness: boolean;
  pib?: string;
  vatId?: string;
  /** Contract summary fields, keyed by field name, used for contract_field criteria. */
  contract?: Record<string, string>;
}

export interface Profile {
  id: string;
  synthetic: boolean;
  name: string;
  pib: string;
  activityCode: string;
  registrationDate: IsoDate;
  municipality: string;
  address: string;
  taxpayerCode?: string;
  activityExemptFromIndependenceTest: boolean;
}

export interface Draft {
  clientId: string;
  currency: Currency;
  amount: DecimalString;
  issueDate: IsoDate;
  description: string;
  kind: 'product' | 'service';
}
