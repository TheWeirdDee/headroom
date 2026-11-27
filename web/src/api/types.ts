// Shapes the API and the event stream deliver (mirrors src/domain/types.ts, src/events/schemas.ts and the
// card view model in src/agents/limit-keeper/card.ts). The UI only reads these; it computes nothing.

export type ClaimStatus = 'proposed' | 'verified' | 'contested' | 'superseded' | 'needs_user';

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
  | { type: 'derived'; figureIds: string[] };

export type FigureValue =
  | { t: 'money'; amount: string; currency: string }
  | {
      t: 'rate';
      rate: string;
      base: string;
      quote: 'RSD';
      parity: number;
      requestedDate: string;
      rateDate: string;
    }
  | { t: 'date'; iso: string }
  | { t: 'text'; text: string }
  | { t: 'ratio'; value: string; window?: { from: string; to: string } }
  | { t: 'tri'; value: 'met' | 'not_met' | 'unknown' }
  | {
      t: 'kpoRow';
      rowNo: number;
      date: string;
      description: string;
      productsRSD: string;
      servicesRSD: string;
      totalRSD: string;
    };

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface Figure {
  id: string;
  key: string;
  kind: string;
  value: FigureValue;
  sources: SourceRef[];
  derivation?: { ruleId: string; inputs: string[]; formula: string };
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

export interface Discrepancy {
  id: string;
  type: string;
  title: string;
  detail: string;
  figureIds: string[];
  sources: SourceRef[];
  status: ClaimStatus;
  deltaRSD?: string;
  baseline?: 'book' | 'corrected';
  subjectKey?: string;
  producedBy?: string;
}

export interface LoopMetric {
  loopId: string;
  agentId: string;
  loopInputKey: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'completed' | 'failed';
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  error?: string;
}

export interface MoneyVM {
  display: string;
  amount: string;
  figureId?: string;
  ruleId?: string;
}

export type Band = 'green' | 'amber' | 'red' | 'crossed';
/** The band a card shows: none until every input is verified. */
export type CardBand = Band | 'incomplete';

export interface Completeness {
  complete: boolean;
  gaps: Array<{ kind: 'failed' | 'missing' | 'needs_you' | 'pending'; text: string }>;
}

export interface CardVM {
  completeness: Completeness;
  asOf: string;
  limit6m: {
    committed: MoneyVM;
    withDraft: MoneyVM;
    headroomWithDraft: MoneyVM;
    limit: MoneyVM;
    ratioWithDraft: { display: string; value: string; figureId: string };
    band: CardBand;
    consequenceRuleId?: string;
    /** Present when client payments of the year have no invoice: where they would put the total. */
    unbilled?: {
      payments: Array<{ date: string; display: string; figureId: string }>;
      total: MoneyVM;
      headroom: MoneyVM;
      over?: MoneyVM;
      band: CardBand;
      crossed: boolean;
    };
  };
  vat8m: {
    committed: MoneyVM;
    withDraft: MoneyVM;
    headroomWithDraft: MoneyVM;
    threshold: MoneyVM;
    band: CardBand;
    consequenceRuleId?: string;
    assumptionRuleIds: string[];
  };
  independence: Array<{
    clientId: string;
    clientName: string;
    met: number;
    notMet: number;
    unknown: number;
    status: string;
    statusFigureId?: string;
    share12mWithDraft?: {
      display: string;
      value: string;
      figureId: string;
      window?: { from: string; to: string };
    };
  }>;
  draft: {
    amount: { display: string; amount: string; currency: string; figureId?: string };
    amountRSD?: MoneyVM;
  };
  assumptionRuleIds: string[];
  disclaimer: string;
}

export interface Crossing {
  bandBefore: Band;
  bandAfter: Band;
  discrepancyId: string;
  discrepancyType: string;
  subjectKey?: string;
  baseline?: 'book' | 'corrected';
  deltaRSD: string;
}

export interface RunSummary {
  runId: string;
  profileId: string;
  mode: 'live' | 'replay';
  mozaik: { package: string; version: string };
  models: { reader: string; verifier: string };
  wallTimeMs: number;
  sumLoopTimeMs: number;
  maxConcurrentLoops: number;
  loops: number;
  failedLoops: number;
  figures: Record<ClaimStatus, number>;
  unsourcedFigures: number;
  conflicts: { raised: number; resolved: number; escalated: number };
  discrepancies: Record<string, number>;
  rejections: Record<string, number>;
  tokens: { in: number; out: number };
  openQuestions: number;
  participantErrors: number;
  status: 'completed' | 'awaiting_user' | 'degraded' | 'failed';
}

export interface HrEvent<P = unknown> {
  eventId: string;
  runId: string;
  type: string;
  producerId: string;
  occurredAt: string;
  payload: P;
}

export interface AgentStatus {
  agentId: string;
  state: 'idle' | 'working' | 'waiting' | 'error';
  doingNow: string;
  loopId?: string;
}

export interface Snapshot {
  runId: string;
  mode: 'live' | 'replay';
  /** The shared landing-page showcase: it cannot be answered or changed. */
  readOnly?: boolean;
  source: { kind: 'sample'; profileId: string } | { kind: 'upload'; uploadId: string };
  synthetic: boolean;
  startedAt: string;
  recording: { recordedAt: string; models: { reader: string; verifier: string } } | null;
  status: 'running' | 'completed' | 'awaiting_user' | 'degraded' | 'failed';
  lastEventId: number;
  config: { year: number; asOf: string };
  profile: { name: string; pib: string };
  clients: Array<{ id: string; name: string; country: string }>;
  draft: Draft;
  figures: Figure[];
  questions: Question[];
  discrepancies: Discrepancy[];
  rejections: Record<string, number>;
  loops: LoopMetric[];
  agents: Record<string, AgentStatus>;
  card: CardVM | null;
  /** Events the board does not keep (crossings, errors, vetoes, corroborations), folded into the view. */
  viewEvents?: HrEvent[];
  summary: RunSummary | null;
  parseErrors: Array<{ file: string; lineNo: number; message: string }>;
  unreadable: Array<{ fileName: string; reason: string }>;
}

export type ResolvedSource =
  | {
      type: 'document';
      source: SourceRef;
      fileName: string;
      page: number;
      lines: Array<{ n: number; text: string; cited: boolean }>;
    }
  | { type: 'statement_row' | 'kpo_row'; source: SourceRef; header: string[]; rawLine: string }
  | {
      type: 'url';
      source: SourceRef;
      url: string;
      fetchedAt: string;
      httpStatus: number;
      body: string;
      value: string | undefined;
    }
  | {
      type: 'rule';
      source: SourceRef;
      ruleId: string;
      title: string;
      status: string;
      statementSr: string;
      statementEn: string;
      links: Array<{ url: string; title: string; locator?: string; quote?: string }>;
    }
  | { type: 'user_answer'; source: SourceRef; question: string; answer: string; answeredAt: string }
  | { type: 'contract_field'; source: SourceRef; clientName: string; field: string; value: string }
  | {
      type: 'derived';
      source: SourceRef;
      inputs: Array<{ id: string; key: string; value: FigureValue; status: string }>;
    }
  | { type: 'missing'; source: SourceRef; reason: string };

export interface FigureDetail {
  figure: Figure;
  sources: ResolvedSource[];
  versions: Figure[];
}

export interface Rule {
  id: string;
  status: 'verified' | 'assumption' | 'product';
  title: string;
  statement_sr: string;
  statement_en: string;
  sources: Array<{ url: string; title: string; accessed: string; locator?: string; quote?: string }>;
  note?: string;
  params?: Record<string, unknown>;
}

export interface Health {
  ok: boolean;
  /** A hosted read-only sample instance: recorded samples only, uploads refused. */
  publicDemo?: boolean;
  version: string;
  mozaikVersion: string;
  mode: 'live' | 'offline';
  hasModelKey: boolean;
  keyEnv: string;
  maxRpm: number;
  models: { reader: string; verifier: string };
  disclaimer: string;
  authorityBoundary: string;
}

export interface ProfileInfo {
  id: string;
  label: string;
  synthetic: true;
  hasDraft: boolean;
  hasRecording: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface KpoRow {
  rowNo: number;
  date: string;
  description: string;
  productsRSD: string;
  servicesRSD: string;
  totalRSD: string;
  invNo: string;
  figureIds: string[];
}

export interface KpoExport {
  book: {
    year: number;
    rows: KpoRow[];
    totals: { productsRSD: string; servicesRSD: string; totalRSD: string };
  };
  header: Array<[string, string]>;
  columns: string[];
  corrections: Array<{
    type: string;
    invoice: string;
    original: string;
    corrected: string;
    why: string;
    figureIds: string[];
    sources: SourceRef[];
  }>;
  disclaimer: string;
  synthetic: boolean;
}

export type FileKind = 'statement' | 'kpo' | 'invoice_pdf' | 'clients' | 'unknown';

export interface FormatMapping {
  delimiter: ',' | ';' | '\t';
  decimal: ',' | '.';
  dateFormat: string;
  encoding: 'utf-8' | 'windows-1250';
  headerRow: number;
}
export type StatementMapping = FormatMapping & {
  kind: 'statement';
  columns: Partial<
    Record<
      'amount' | 'credit' | 'debit' | 'currency' | 'direction' | 'counterparty' | 'reference' | 'description',
      number
    >
  > & { date: number };
  accountCurrency?: 'RSD' | 'EUR' | 'USD' | 'GBP' | 'CHF';
};
export type KpoMapping = FormatMapping & {
  kind: 'kpo';
  columns: { date: number; description: number; products: number; services: number; total: number };
};

export interface CsvDetection {
  kind: 'statement' | 'kpo' | 'unknown';
  encoding: 'utf-8' | 'windows-1250';
  delimiter: ',' | ';' | '\t';
  headerRow: number;
  header: string[];
  preview: string[][];
  mapping?: StatementMapping | KpoMapping;
  guess?: StatementMapping;
}

export interface UploadedFile {
  name: string;
  kind: FileKind;
  size: number;
  detection?: CsvDetection;
  mapping?: StatementMapping | KpoMapping;
}

export interface UploadInfo {
  uploadId: string;
  files: UploadedFile[];
  mappingNeeded: string[];
  detailsSaved: boolean;
}

export interface Draft {
  clientId: string;
  currency: 'RSD' | 'EUR' | 'USD' | 'GBP' | 'CHF';
  amount: string;
  issueDate: string;
  description: string;
  kind: 'product' | 'service';
}

/** Written by scripts/eval.ts (PRD 19). */
export interface Evidence {
  generatedAt: string;
  conditions: {
    date: string;
    mode: 'live' | 'replay' | 'fake';
    models: { reader: string; verifier: string };
    mozaikVersion: string;
    runsPerProfile: Record<string, number>;
    stopped?: string;
    profiles: string[];
  };
  metrics: Array<{ name: string; value: string; target?: string; passed?: boolean; note?: string }>;
  perType: Array<{ type: string; planted: number; found: number; missed: number; extra: number }>;
  misses: Array<{ profileId: string; type: string; detail: string }>;
}
