// Run engine (PRD 14.3): one Mozaik runtime per run. Joins listeners first, publishes hr.run.started,
// waits for quiescence (14.4) or the hard timeout, then publishes hr.run.completed with the summary.
import { createRuntime, MOZAIK_PACKAGE, type HeadroomRuntime } from '../runtime/mozaik/runtime.ts';
import { evidenceGate } from '../agents/verifier/gate.ts';
import { HeadroomState, REJECTION_REASONS } from '../runtime/state.ts';
import { waitForQuiescence } from './quiescence.ts';
import { registerObserver, type EventSink } from '../agents/observer.ts';
import { registerVerifier } from '../agents/verifier/agent.ts';
import { registerLimitKeeper } from '../agents/limit-keeper/agent.ts';
import { registerRateClerk } from '../agents/rate-clerk/agent.ts';
import { registerIndependenceChecker } from '../agents/independence-checker/agent.ts';
import { registerKpoReader } from '../agents/kpo-reader/agent.ts';
import { registerStatementReader } from '../agents/statement-reader/agent.ts';
import { registerInvoiceReader } from '../agents/invoice-reader/agent.ts';
import { registerHuman, type HumanApi } from '../agents/human.ts';
import { AGENTS, loadPrompt, type AgentDeps } from '../agents/common.ts';
import { buildCard, type CardVM } from '../agents/limit-keeper/card.ts';
import { todayInBelgrade } from '../domain/dates.ts';
import { sequentialIds } from '../util/hash.ts';
import type { RuleBook } from '../domain/rules/engine.ts';
import type { RunConfig } from '../domain/types.ts';
import type { RunInputs } from './inputs.ts';
import type { HrEvent, InferenceObserver, LoopMetric, ModelBackend } from '../runtime/types.ts';
import type { KursClient } from '../integrations/kurs/client.ts';
import { pacerRpm } from '../runtime/pacer.ts';

export interface RunSummary {
  runId: string;
  profileId: string;
  mode: 'live' | 'replay';
  mozaik: { package: string; version: string };
  models: { reader: string; verifier: string };
  promptHashes: Record<string, string>;
  wallTimeMs: number;
  sumLoopTimeMs: number;
  maxConcurrentLoops: number;
  loops: number;
  failedLoops: number;
  figures: Record<'proposed' | 'verified' | 'contested' | 'superseded' | 'needs_user', number>;
  unsourcedFigures: number;
  conflicts: { raised: number; resolved: number; escalated: number };
  discrepancies: Record<string, number>;
  rejections: Record<string, number>;
  vetoedWrites: number;
  tokens: { in: number; out: number; byAgent: Record<string, { in: number; out: number }> };
  headroom: CardVM | null;
  openQuestions: number;
  participantErrors: number;
  /**
   * failed: it timed out or no loop succeeded. degraded: something failed or an input is missing, so the
   * card is incomplete. awaiting_user: open questions. completed: none of these.
   */
  status: 'completed' | 'awaiting_user' | 'degraded' | 'failed';
}

export function runStatus(args: {
  timedOut: boolean;
  loops: number;
  failedLoops: number;
  participantErrors: number;
  openQuestions: number;
  card: CardVM | null;
}): RunSummary['status'] {
  if (args.timedOut || (args.loops > 0 && args.failedLoops === args.loops)) return 'failed';
  const gaps = args.card?.completeness.gaps ?? [];
  const broken = gaps.some((g) => g.kind === 'failed' || g.kind === 'missing');
  if (args.failedLoops > 0 || args.participantErrors > 0 || broken) return 'degraded';
  if (args.openQuestions > 0) return 'awaiting_user';
  return args.card?.completeness.complete ? 'completed' : 'degraded';
}

export interface RunOptions {
  runId: string;
  inputs: RunInputs;
  rules: RuleBook;
  config: RunConfig;
  mode: 'live' | 'replay';
  kurs: KursClient;
  backend?: ModelBackend;
  inferenceObserver?: InferenceObserver;
  sinks?: EventSink[];
  now?: () => number;
  runTimeoutMs?: number;
  quietMs?: number;
  /** Called with every completion summary (the first, and each one after the run re-opens). */
  onCompleted?: (s: RunSummary) => void;
}

export interface Run {
  runId: string;
  rt: HeadroomRuntime;
  human: HumanApi;
  events: HrEvent[];
  /** Resolves with the summary when the run first goes quiet (or times out). */
  done: Promise<RunSummary>;
  /** The latest summary; answers and draft changes re-open the run and produce a new one. */
  latest(): RunSummary | undefined;
  /** Stop the runtime (deleting the run, or shutting the server down). */
  dispose(): Promise<void>;
}

/** Peak number of loops running at the same time, from loop start and end times. */
export function maxConcurrency(loops: LoopMetric[]): number {
  const edges = loops.flatMap((l) => [
    { t: l.startedAt, d: 1 },
    { t: l.endedAt ?? Number.MAX_SAFE_INTEGER, d: -1 },
  ]);
  edges.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0;
  let peak = 0;
  for (const e of edges) {
    cur += e.d;
    peak = Math.max(peak, cur);
  }
  return peak;
}

export function startRun(o: RunOptions): Run {
  const now = o.now ?? ((): number => Date.now());
  const state = new HeadroomState(o.runId, o.inputs.inputId, o.mode, o.config, sequentialIds('f'), now);
  const rt = createRuntime({
    state,
    ...(o.backend ? { backend: o.backend } : {}),
    ...(o.inferenceObserver ? { observer: o.inferenceObserver } : {}),
    newEventId: sequentialIds(`${o.runId}-e`),
    now,
    defaultLoopTimeoutMs: o.config.loopTimeoutMs,
    maxRetries: o.config.maxRetries,
  });
  const events: HrEvent[] = [];
  const deps: AgentDeps = {
    rt,
    gate: evidenceGate(rt, AGENTS.verifier),
    rules: o.rules,
    inputs: o.inputs,
    kurs: o.kurs,
    now,
    today: () => todayInBelgrade(new Date(now())),
  };

  // Seven agents, the user and the transcript join one Mozaik runtime; listeners first, so none misses an
  // event. Nobody calls an agent: each acts when an event satisfies one of its situation specifications.
  registerObserver(rt, [(e) => events.push(e), ...(o.sinks ?? [])]);
  registerVerifier(deps);
  registerLimitKeeper(deps);
  registerRateClerk(deps);
  registerIndependenceChecker(deps);
  registerKpoReader(deps);
  registerStatementReader(deps);
  registerInvoiceReader(deps);
  const human = registerHuman(deps);

  const promptHashes = Object.fromEntries(
    ['invoice-reader', 'statement-reader', 'kpo-reader', 'independence-checker', 'verifier'].map((a) => [
      a,
      loadPrompt(a).hash,
    ]),
  );
  const started = now();
  // The user starts the run; the readers' specifications match this one event and they all begin at once.
  rt.publish('hr.run.started', AGENTS.human, {
    profileId: o.inputs.inputId,
    synthetic: o.inputs.synthetic,
    mode: o.mode,
    config: o.config,
    manifest: o.inputs.manifest,
    parseErrors: [...o.inputs.statements.flatMap((s) => s.errors), ...(o.inputs.kpo?.errors ?? [])],
  });

  let latest: RunSummary | undefined;
  let settling: Promise<RunSummary> | undefined;
  const settle = async (): Promise<RunSummary> => {
    const result = await waitForQuiescence(
      {
        probe: () => ({
          ...rt.activity(),
          // A recomputation still waiting on its debounce timer is queued work.
          queuedEvents: rt.activity().queuedEvents + state.debouncing.size,
          proposedFigures: state.figuresWhere((f) => f.status === 'proposed').length,
          pendingHttp: o.kurs.pending(),
        }),
        quietMs: o.quietMs ?? 1500,
        now,
      },
      // A paced provider (free tier) and a replay of recorded latencies are slow by design: allow an hour.
      o.runTimeoutMs ?? (o.backend?.recorded || (!o.backend && pacerRpm() > 0) ? 3_600_000 : 300_000),
    );
    const summary = summarize(result);
    latest = summary;
    settling = undefined;
    // The card as it stands now that nothing is running.
    if (summary.headroom) rt.publish('hr.headroom.updated', 'engine', summary.headroom);
    rt.publish('hr.run.completed', 'engine', summary);
    o.onCompleted?.(summary);
    return summary;
  };
  settling = settle();
  const done = settling;

  /** Answering a question or changing the draft re-opens a quiet run (PRD 14.4). */
  function reopen(reason: string): void {
    if (settling) return;
    rt.publish('hr.run.reopened', 'engine', { reason });
    settling = settle();
  }
  const humanApi: HumanApi = {
    answer(questionId, answer) {
      const r = human.answer(questionId, answer);
      if (r.ok) reopen('answer');
      return r;
    },
    changeDraft(draft) {
      human.changeDraft(draft);
      reopen('draft');
    },
  };

  function summarize(result: 'quiet' | 'timeout'): RunSummary {
    const loops = rt.loopMetrics();
    const end = now();
    const figs = [...state.figures.values()];
    const count = (s: string): number => figs.filter((f) => f.status === s).length;
    const byAgent: Record<string, { in: number; out: number }> = {};
    for (const l of loops) {
      const a = (byAgent[l.agentId] ??= { in: 0, out: 0 });
      a.in += l.tokensIn;
      a.out += l.tokensOut;
    }
    const discrepancies: Record<string, number> = {};
    for (const d of state.discrepancies.values())
      if (d.status === 'verified') discrepancies[d.type] = (discrepancies[d.type] ?? 0) + 1;
    const conflictEvents = events.filter((e) => e.type === 'hr.figure.conflict').length;
    const escalated = figs.filter((f) => f.status === 'needs_user').length;
    const openQuestions = [...state.questions.values()].filter((q) => q.answer === undefined).length;
    const participantErrors = events.filter((e) => e.type === 'hr.participant.error').length;
    const card = buildCard(state, o.rules, o.inputs, deps.today()) ?? null;
    return {
      runId: o.runId,
      profileId: o.inputs.inputId,
      mode: o.mode,
      mozaik: { package: MOZAIK_PACKAGE.name, version: MOZAIK_PACKAGE.version },
      models: o.config.models,
      promptHashes,
      wallTimeMs: end - started,
      sumLoopTimeMs: loops.reduce((s, l) => s + ((l.endedAt ?? end) - l.startedAt), 0),
      maxConcurrentLoops: maxConcurrency(loops),
      loops: loops.length,
      failedLoops: loops.filter((l) => l.status === 'failed').length,
      figures: {
        proposed: count('proposed'),
        verified: count('verified'),
        contested: count('contested'),
        superseded: count('superseded'),
        needs_user: escalated,
      },
      unsourcedFigures: figs.filter((f) => f.status === 'verified' && f.sources.length === 0).length,
      conflicts: { raised: conflictEvents, resolved: Math.max(0, conflictEvents - escalated), escalated },
      discrepancies,
      rejections: Object.fromEntries(REJECTION_REASONS.map((r) => [r, state.rejections.get(r) ?? 0])),
      vetoedWrites: state.vetoedWrites.length,
      tokens: {
        in: loops.reduce((s, l) => s + l.tokensIn, 0),
        out: loops.reduce((s, l) => s + l.tokensOut, 0),
        byAgent,
      },
      headroom: card,
      openQuestions,
      participantErrors,
      status: runStatus({
        timedOut: result === 'timeout',
        loops: loops.length,
        failedLoops: loops.filter((l) => l.status === 'failed').length,
        participantErrors,
        openQuestions,
        card,
      }),
    };
  }

  return {
    runId: o.runId,
    rt,
    human: humanApi,
    events,
    done,
    latest: () => latest,
    async dispose() {
      rt.publish('hr.run.stopping', 'engine', { reason: 'disposed' });
      await rt.shutdown();
    },
  };
}
