// HeadroomState is the run's Mozaik RuntimeState: the Figure Board every participant reads and writes.
// All board writes go through postFigure / setFigureStatus, which are synchronous (no await), so they are
// atomic in Node.
import { createClaimStore, type ClaimRecord, type ClaimStore, type ProposeResult } from '@headroom/claims';
import { RuntimeState } from '@mozaik-ai/core';
import { cmp } from '../domain/money.ts';
import type {
  ClaimStatus,
  Discrepancy,
  Figure,
  FigureKind,
  FigureValue,
  NonEmpty,
  Question,
  RunConfig,
  SourceRef,
  VerificationCheck,
  Derivation,
} from '../domain/types.ts';

export type RejectionReason =
  'UNSOURCED' | 'SOURCE_MISMATCH' | 'DERIVATION_MISMATCH' | 'NOT_SUPPORTED_BY_SOURCE' | 'IMPLAUSIBLE';

export const REJECTION_REASONS: RejectionReason[] = [
  'UNSOURCED',
  'SOURCE_MISMATCH',
  'DERIVATION_MISMATCH',
  'NOT_SUPPORTED_BY_SOURCE',
  'IMPLAUSIBLE',
];

/** Exact equality of figure values: money and rates compared as decimals, never as floats. */
export function figureValueEquals(a: FigureValue, b: FigureValue): boolean {
  switch (a.t) {
    case 'money':
      return b.t === 'money' && a.currency === b.currency && cmp(a.amount, b.amount) === 0;
    case 'rate':
      return (
        b.t === 'rate' &&
        a.base === b.base &&
        a.parity === b.parity &&
        a.rateDate === b.rateDate &&
        cmp(a.rate, b.rate) === 0
      );
    case 'date':
      return b.t === 'date' && a.iso === b.iso;
    case 'text':
      return b.t === 'text' && a.text === b.text;
    case 'ratio':
      return (
        b.t === 'ratio' &&
        cmp(a.value, b.value) === 0 &&
        a.window?.from === b.window?.from &&
        a.window?.to === b.window?.to
      );
    case 'tri':
      return b.t === 'tri' && a.value === b.value;
    case 'kpoRow':
      return (
        b.t === 'kpoRow' &&
        a.rowNo === b.rowNo &&
        a.date === b.date &&
        a.description === b.description &&
        cmp(a.productsRSD, b.productsRSD) === 0 &&
        cmp(a.servicesRSD, b.servicesRSD) === 0 &&
        cmp(a.totalRSD, b.totalRSD) === 0
      );
  }
}

export interface PostFigureInput {
  key: string;
  kind: FigureKind;
  value: FigureValue;
  sources: SourceRef[];
  derivation?: Derivation;
  producedBy: string;
  idempotencyKey: string;
  scope?: 'committed' | 'draft';
}

export class UnsourcedFigureError extends Error {
  constructor(key: string) {
    super(`Refused to post ${key}: a figure must cite at least one source`);
    this.name = 'UnsourcedFigureError';
  }
}

export interface Corroboration {
  by: string;
  sources: SourceRef[];
}

export class HeadroomState extends RuntimeState {
  readonly board: ClaimStore<FigureValue>;
  /** Figure metadata by claim record id. */
  readonly figures = new Map<string, Figure>();
  readonly corroborations = new Map<string, Corroboration[]>();
  readonly questions = new Map<string, Question>();
  readonly discrepancies = new Map<string, Discrepancy>();
  readonly rejections = new Map<RejectionReason, number>(REJECTION_REASONS.map((r) => [r, 0]));
  readonly vetoedWrites: Array<{ agentId: string; reason: string }> = [];
  readonly failedLoops: Array<{ agentId: string; loopId: string; error: string }> = [];
  readonly handlerErrors: string[] = [];
  /** Agents waiting on a debounce timer before they recompute: the run is not quiet until none is. */
  readonly debouncing = new Set<string>();
  /** What the readers have finished, for the card's completeness check. */
  readonly progress: {
    invoicesRead: boolean;
    statementsRead: boolean;
    paymentsMatched: boolean;
    kpo: { complete: boolean } | undefined;
  } = { invoicesRead: false, statementsRead: false, paymentsMatched: false, kpo: undefined };
  private pending: Omit<Figure, 'id' | 'version' | 'status' | 'createdAt'> | undefined;

  constructor(
    readonly runId: string,
    readonly inputId: string,
    readonly mode: 'live' | 'replay',
    readonly config: RunConfig,
    private readonly newId: () => string,
    private readonly now: () => number = () => Date.now(),
  ) {
    super();
    this.board = createClaimStore<FigureValue>({ newId, now, equals: figureValueEquals });
    // Bind figure metadata to the record created inside propose(); runs synchronously within it.
    this.board.onChange((e) => {
      if ((e.type === 'claimed' || e.type === 'conflict') && this.pending && !this.figures.has(e.recordId)) {
        const r = this.board.getById(e.recordId);
        if (!r) return;
        this.figures.set(r.id, {
          ...this.pending,
          id: r.id,
          version: r.version,
          status: r.status,
          createdAt: new Date(r.createdAt).toISOString(),
        });
      }
      const f = this.figures.get(e.recordId);
      if (f) f.status = e.status;
    });
  }

  /** The only way to put a figure on the board. Synchronous. */
  postFigure(input: PostFigureInput): { result: ProposeResult<FigureValue>; figure: Figure } {
    const [first, ...rest] = input.sources;
    if (!first) throw new UnsourcedFigureError(input.key);
    const sources: NonEmpty<SourceRef> = [first, ...rest];
    this.pending = {
      key: input.key,
      kind: input.kind,
      value: input.value,
      sources,
      ...(input.derivation ? { derivation: input.derivation } : {}),
      producedBy: input.producedBy,
      scope: input.scope ?? 'committed',
    };
    try {
      const result = this.board.propose({
        key: input.key,
        value: input.value,
        by: input.producedBy,
        idempotencyKey: input.idempotencyKey,
      });
      // No expectedVersion is passed, so 'stale' cannot occur; treat it as a programming error.
      if (result.kind === 'stale') throw new Error(`Unexpected stale result posting ${input.key}`);
      const record = result.kind === 'conflict' ? result.proposed : result.record;
      if (result.kind === 'corroborated') {
        const list = this.corroborations.get(record.id) ?? [];
        list.push({ by: input.producedBy, sources: input.sources });
        this.corroborations.set(record.id, list);
      }
      const figure = this.figures.get(record.id);
      if (!figure) throw new Error(`Figure metadata missing for ${record.id}`);
      return { result, figure };
    } finally {
      this.pending = undefined;
    }
  }

  setFigureStatus(
    figureId: string,
    status: ClaimStatus,
    by: string,
    checks?: VerificationCheck[],
    reason?: string,
  ): Figure {
    const f = this.figures.get(figureId);
    if (!f) throw new Error(`Unknown figure ${figureId}`);
    if (checks) f.checks = checks;
    this.board.setStatus(f.key, figureId, status, by, reason);
    return f;
  }

  /** The verified figure for a key, if any. Only verified figures count (PRD F4). */
  verified(key: string): Figure | undefined {
    const r = this.board.get(key);
    return r && r.status === 'verified' ? this.figures.get(r.id) : undefined;
  }

  record(figureId: string): ClaimRecord<FigureValue> | undefined {
    return this.board.getById(figureId);
  }

  figuresWhere(pred: (f: Figure) => boolean): Figure[] {
    return [...this.figures.values()].filter(pred);
  }

  countRejection(reason: RejectionReason): void {
    this.rejections.set(reason, (this.rejections.get(reason) ?? 0) + 1);
  }
}
