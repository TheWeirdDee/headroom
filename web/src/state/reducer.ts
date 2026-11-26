// The run view is a pure projection of the snapshot and the event stream. No domain logic lives here:
// every number shown comes from a figure or the card the server built from verified figures.
import type {
  AgentStatus,
  CardVM,
  Crossing,
  Discrepancy,
  Figure,
  HrEvent,
  LoopMetric,
  Question,
  RunSummary,
  Snapshot,
} from '../api/types.ts';

export const AGENT_ORDER = [
  'invoice-reader',
  'statement-reader',
  'kpo-reader',
  'rate-clerk',
  'limit-keeper',
  'independence-checker',
  'verifier',
] as const;

export const AGENT_NAMES: Record<string, string> = {
  'invoice-reader': 'InvoiceReader',
  'statement-reader': 'StatementReader',
  'kpo-reader': 'KpoReader',
  'rate-clerk': 'RateClerk',
  'limit-keeper': 'LimitKeeper',
  'independence-checker': 'IndependenceChecker',
  verifier: 'Verifier',
  human: 'You',
  engine: 'Run engine',
};

export interface ParticipantError {
  participantId: string;
  eventType: string;
  message: string;
  eventId: string;
}

export interface RunView {
  runId: string;
  loaded: boolean;
  snapshot?: Omit<
    Snapshot,
    'figures' | 'questions' | 'discrepancies' | 'loops' | 'agents' | 'card' | 'summary'
  >;
  status: Snapshot['status'];
  figures: Record<string, Figure>;
  order: string[]; // figure ids in arrival order
  flash: Record<string, number>; // figure id -> last status change sequence (UI highlights recent ones)
  corroboratedBy: Record<string, string[]>; // figure id -> agents that independently proposed the same value
  questions: Record<string, Question>;
  discrepancies: Record<string, Discrepancy>;
  agents: Record<string, AgentStatus>;
  loops: Record<string, LoopMetric>;
  card: CardVM | null;
  crossings: Crossing[];
  summary: RunSummary | null;
  rejections: Record<string, number>;
  vetoed: number;
  errors: ParticipantError[];
  replayMiss?: { requestHash: string; message: string };
  lastEventId: number;
  seq: number;
}

export function emptyView(runId: string): RunView {
  return {
    runId,
    loaded: false,
    status: 'running',
    figures: {},
    order: [],
    flash: {},
    corroboratedBy: {},
    questions: {},
    discrepancies: {},
    agents: {},
    loops: {},
    card: null,
    crossings: [],
    summary: null,
    rejections: {},
    vetoed: 0,
    errors: [],
    lastEventId: 0,
    seq: 0,
  };
}

export type Action = { type: 'snapshot'; snapshot: Snapshot } | { type: 'event'; id: number; event: HrEvent };

const byId = <T extends { id: string }>(xs: T[]): Record<string, T> =>
  Object.fromEntries(xs.map((x) => [x.id, x]));

function setFigure(v: RunView, f: Figure): RunView {
  const isNew = v.figures[f.id] === undefined;
  return {
    ...v,
    figures: { ...v.figures, [f.id]: f },
    order: isNew ? [...v.order, f.id] : v.order,
    flash: { ...v.flash, [f.id]: v.seq },
  };
}

function patchFigure(v: RunView, id: string, patch: Partial<Figure>): RunView {
  const f = v.figures[id];
  return f ? setFigure(v, { ...f, ...patch }) : v;
}

export function reduce(v: RunView, a: Action): RunView {
  if (a.type === 'snapshot') {
    const s = a.snapshot;
    const { figures, questions, discrepancies, loops, agents, card, summary, viewEvents, ...rest } = s;
    const base: RunView = {
      ...emptyView(v.runId),
      loaded: true,
      snapshot: rest,
      status: s.status,
      figures: byId(figures),
      order: figures.map((f) => f.id),
      flash: {},
      questions: byId(questions),
      discrepancies: byId(discrepancies),
      agents,
      loops: Object.fromEntries(loops.map((l) => [l.loopId, l])),
      card,
      summary,
      rejections: s.rejections,
      lastEventId: s.lastEventId,
      seq: v.seq,
    };
    // Crossings, errors, vetoes and corroborations are not on the board: the snapshot carries their events.
    return (viewEvents ?? []).reduce((acc, e) => applyEvent(acc, e), base);
  }
  if (a.id <= v.lastEventId) return v; // already applied (snapshot or earlier delivery)
  return applyEvent({ ...v, lastEventId: a.id }, a.event);
}

function applyEvent(v: RunView, e: HrEvent): RunView {
  const p = e.payload as Record<string, unknown>;
  let n: RunView = { ...v, seq: v.seq + 1 };
  switch (e.type) {
    case 'hr.figure.proposed':
      n = setFigure(n, p['figure'] as Figure);
      break;
    case 'hr.figure.verified': {
      const f = p['figure'] as Figure | undefined;
      n = f
        ? setFigure(n, { ...f, status: 'verified' })
        : patchFigure(n, p['figureId'] as string, { status: 'verified' });
      break;
    }
    case 'hr.figure.contested': {
      n = patchFigure(n, p['figureId'] as string, { status: 'contested' });
      const code = p['reasonCode'] as string;
      n = { ...n, rejections: { ...n.rejections, [code]: (n.rejections[code] ?? 0) + 1 } };
      break;
    }
    case 'hr.figure.needs_user':
      n = patchFigure(n, p['figureId'] as string, { status: 'needs_user' });
      break;
    case 'hr.figure.superseded':
      n = patchFigure(n, p['oldId'] as string, { status: 'superseded' });
      break;
    case 'hr.figure.corroborated': {
      const fid = p['figureId'] as string;
      const by = p['by'] as string;
      const prev = n.corroboratedBy[fid] ?? [];
      n = {
        ...n,
        flash: { ...n.flash, [fid]: n.seq },
        corroboratedBy: prev.includes(by) ? n.corroboratedBy : { ...n.corroboratedBy, [fid]: [...prev, by] },
      };
      break;
    }
    case 'hr.agent.status':
      n = { ...n, agents: { ...n.agents, [p['agentId'] as string]: p as unknown as AgentStatus } };
      break;
    case 'hr.loop.started': {
      const l = {
        ...(p as unknown as LoopMetric),
        status: 'running' as const,
        tokensIn: 0,
        tokensOut: 0,
        toolCalls: 0,
      };
      n = { ...n, loops: { ...n.loops, [l.loopId]: l } };
      break;
    }
    case 'hr.loop.finished':
    case 'hr.loop.failed': {
      const l = p as unknown as LoopMetric;
      n = { ...n, loops: { ...n.loops, [l.loopId]: l } };
      if (e.type === 'hr.loop.failed' && typeof l.error === 'string' && l.error.includes('REPLAY_MISS')) {
        const hash = /request ([0-9a-f]{64})/.exec(l.error)?.[1] ?? '';
        n = { ...n, replayMiss: { requestHash: hash, message: l.error } };
      }
      break;
    }
    case 'hr.question.asked': {
      const q = p['question'] as Question;
      n = { ...n, questions: { ...n.questions, [q.id]: q } };
      break;
    }
    case 'hr.question.answered': {
      const id = p['questionId'] as string;
      const q = n.questions[id];
      if (q)
        n = {
          ...n,
          questions: {
            ...n.questions,
            [id]: { ...q, answer: p['answer'] as string, answeredAt: p['answeredAt'] as string },
          },
        };
      break;
    }
    case 'hr.discrepancy.raised': {
      const d = p['discrepancy'] as Discrepancy;
      n = { ...n, discrepancies: { ...n.discrepancies, [d.id]: d } };
      break;
    }
    case 'hr.headroom.updated':
      n = { ...n, card: p as unknown as CardVM };
      break;
    case 'hr.headroom.crossing':
      n = { ...n, crossings: [...n.crossings, p as unknown as Crossing] };
      break;
    case 'hr.participant.error':
      n = {
        ...n,
        errors: [
          ...n.errors,
          {
            participantId: p['participantId'] as string,
            eventType: p['eventType'] as string,
            message: p['message'] as string,
            eventId: p['eventId'] as string,
          },
        ],
      };
      break;
    case 'hr.write.vetoed':
      n = { ...n, vetoed: n.vetoed + 1 };
      break;
    case 'hr.run.completed': {
      const s = p as unknown as RunSummary;
      n = { ...n, summary: s, status: s.status, rejections: s.rejections };
      break;
    }
    case 'hr.run.reopened':
      n = { ...n, status: 'running' };
      break;
    default:
      return v;
  }
  return n;
}

/** Counts per agent for the lanes: proposed / verified / contested figures it produced. */
export function laneCounts(
  v: RunView,
  agentId: string,
): { proposed: number; verified: number; contested: number } {
  let proposed = 0;
  let verified = 0;
  let contested = 0;
  for (const id of v.order) {
    const f = v.figures[id];
    if (!f || f.producedBy !== agentId) continue;
    proposed += 1;
    if (f.status === 'verified') verified += 1;
    if (f.status === 'contested' || f.status === 'needs_user') contested += 1;
  }
  return { proposed, verified, contested };
}

export function totalRejections(v: RunView): number {
  return Object.values(v.rejections).reduce((a, b) => a + b, 0);
}

export function latestVerified(v: RunView, key: string): Figure | undefined {
  let found: Figure | undefined;
  for (const id of v.order) {
    const f = v.figures[id];
    if (f && f.key === key && f.status === 'verified') found = f;
  }
  return found;
}
