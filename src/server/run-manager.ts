// Runs in this process: start (sample profile or upload), stream, snapshot, answer, draft changes,
// figure sources and exports. Runs live in memory; recordings of sample runs are written by the recorder.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadInputSet } from '../engine/load-inputs.ts';
import { startRun, type Run, type RunSummary } from '../engine/run-engine.ts';
import { defaultRunConfig } from '../config/defaults.ts';
import { createKursClient, type Fetcher, type KursClient } from '../integrations/kurs/client.ts';
import { SseHub } from './sse.ts';
import { resolveSource, withHeaders, type ResolvedSource } from './resolve-source.ts';
import { buildKpoExport, type KpoExport } from '../exporters/kpo.ts';
import { DraftSchema } from '../engine/load-inputs.ts';
import { injectMisread, MISREAD_AMOUNT, type InjectedFault } from '../engine/faults.ts';
import type { RuleBook } from '../domain/rules/engine.ts';
import type { RunInputs } from '../engine/inputs.ts';
import type { AppEnv } from '../config/env.ts';
import type { Draft, Figure } from '../domain/types.ts';
import type { HrEvent, InferenceObserver, ModelBackend } from '../runtime/types.ts';
import type { CardVM } from '../agents/limit-keeper/card.ts';

export class RunError extends Error {
  constructor(
    readonly code:
      | 'NO_MODEL_KEY'
      | 'RUN_NOT_FOUND'
      | 'PROFILE_NOT_FOUND'
      | 'NOT_SYNTHETIC'
      | 'REPLAY_NOT_AVAILABLE'
      | 'OFFLINE'
      | 'FIGURE_NOT_FOUND'
      | 'BAD_ANSWER'
      | 'BAD_DRAFT'
      | 'READ_ONLY'
      | 'BAD_FAULT'
      | 'BUSY'
      | 'INPUTS_INVALID',
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'RunError';
  }
}

export interface RunRecord {
  runId: string;
  run: Run;
  inputs: RunInputs;
  hub: SseHub;
  kurs: KursClient;
  source: { kind: 'sample'; profileId: string } | { kind: 'upload'; uploadId: string };
  mode: 'live' | 'replay';
  /** The landing page's showcase is shared by every visitor: nobody may answer or change it. */
  readOnly: boolean;
  /** A deliberate fault added to this replay, shown wherever the run is. */
  fault?: InjectedFault;
  startedAt: string;
  summary?: RunSummary;
  card?: CardVM;
  /** For replays: when the recording was made and with which models (shown in the top band). */
  recording?: { recordedAt: string; models: { reader: string; verifier: string } };
  agents: Map<string, unknown>;
  headers: Map<string, string[]>;
  /** Events whose effect lives only in the client's view (crossings, errors, vetoes...), for snapshots. */
  viewEvents: HrEvent[];
}

/** Event types the client folds into its view but the board does not keep; sent again in every snapshot. */
const VIEW_EVENT_TYPES = new Set([
  'hr.headroom.crossing',
  'hr.participant.error',
  'hr.write.vetoed',
  'hr.figure.corroborated',
  'hr.loop.failed',
]);

export interface ReplaySource {
  /** Recorded model responses and Kurs bodies for a sample profile, if a recording exists. */
  backend(
    profileId: string,
    override?: { instant?: boolean },
  ):
    | {
        backend: ModelBackend;
        kurs: Fetcher;
        recordedAt: string;
        models: { reader: string; verifier: string };
      }
    | undefined;
  /** The recorded run's own summary.json (real timing), when there is one. */
  summary?(profileId: string): unknown;
  loops?(profileId: string): unknown[];
  agentConflicts?(profileId: string): number | undefined;
}

export interface RunManagerOptions {
  env: AppEnv;
  rules: RuleBook;
  profilesDir: string;
  liveFetcher: Fetcher;
  replay?: ReplaySource;
  /** A non-provider model backend for live-mode runs (the test suite's deterministic model). */
  modelBackend?: () => ModelBackend;
  /** Records live runs of sample profiles (never uploads). */
  recorder?: (
    runId: string,
    profileId: string,
  ) =>
    | {
        observer: InferenceObserver;
        onKurs: (r: { url: string; httpStatus: number; body: string }) => void;
        onEvent: (e: HrEvent) => void;
        finish: (s: RunSummary) => void;
      }
    | undefined;
  now?: () => number;
  quietMs?: number;
  /** Keep at most this many runs in memory, dropping the oldest finished ones (public instance). */
  maxRuns?: number;
  /** Refuse a new run while this many are still working (public instance). */
  maxActive?: number;
}

/** A run still unfinished after this long no longer counts against maxActive. */
const ACTIVE_FOR_MS = 120_000;

function csvHeader(dir: string, file: string): string[] {
  try {
    const text = readFileSync(join(dir, file), 'utf8').split(/\r?\n/);
    const line = text.find((l) => /datum|date/i.test(l)) ?? '';
    return line.split(/[;,\t]/).map((c) => c.replace(/^"|"$/g, '').trim());
  } catch {
    return [];
  }
}

export class RunManager {
  private readonly runs = new Map<string, RunRecord>();
  private showcaseRun: Promise<string> | undefined;
  private showcaseId: string | undefined;
  /** Runs that are loading their inputs and are not in the map yet. */
  private starting = 0;

  constructor(private readonly o: RunManagerOptions) {}

  profiles(): Array<{
    id: string;
    label: string;
    synthetic: true;
    hasDraft: boolean;
    hasRecording: boolean;
  }> {
    if (!existsSync(this.o.profilesDir)) return [];
    return readdirSync(this.o.profilesDir)
      .filter((id) => existsSync(join(this.o.profilesDir, id, 'profile.json')))
      .sort()
      .map((id) => {
        const p = JSON.parse(readFileSync(join(this.o.profilesDir, id, 'profile.json'), 'utf8')) as {
          name: string;
          synthetic: boolean;
        };
        if (p.synthetic !== true)
          throw new RunError(
            'NOT_SYNTHETIC',
            `Bundled profile ${id} is not marked synthetic; refusing to load it.`,
            500,
          );
        return {
          id,
          label: `${id}: ${p.name}`,
          synthetic: true as const,
          hasDraft: existsSync(join(this.o.profilesDir, id, 'draft.json')),
          hasRecording: this.o.replay?.backend(id) !== undefined,
        };
      });
  }

  recordedSummary(profileId: string): unknown {
    return this.o.replay?.summary?.(profileId);
  }

  recordedAgentConflicts(profileId: string): number | undefined {
    return this.o.replay?.agentConflicts?.(profileId);
  }

  recordedLoops(profileId: string): unknown[] {
    return this.o.replay?.loops?.(profileId) ?? [];
  }

  private activeRuns(now: number): number {
    const working = [...this.runs.values()].filter(
      (r) => !r.summary && now - Date.parse(r.startedAt) < ACTIVE_FOR_MS,
    );
    return working.length + this.starting;
  }

  private evictOldRuns(): void {
    const max = this.o.maxRuns;
    if (!max) return;
    for (const [id, r] of this.runs) {
      if (this.runs.size <= max) break;
      // The shared showcase run and runs still working are kept.
      if (!r.summary || r.runId === this.showcaseId) continue;
      void r.run.dispose();
      this.runs.delete(id);
    }
  }

  /**
   * The landing page's showcase: one replay of the committed recording of `profileId`, without delays,
   * started on first request and shared by every visitor. Undefined when there is no recording.
   */
  async showcase(profileId: string): Promise<string | undefined> {
    if (!this.o.replay?.backend(profileId)) return undefined;
    this.showcaseRun ??= this.start({ profileId, mode: 'replay', shared: true });
    try {
      this.showcaseId = await this.showcaseRun;
      return this.showcaseId;
    } catch (e) {
      this.showcaseRun = undefined;
      throw e;
    }
  }

  async start(req: {
    profileId?: string;
    uploadDir?: string;
    uploadId?: string;
    draft?: Draft;
    mode: 'live' | 'replay';
    /** The landing page's shared showcase: answered at once, and read-only. */
    shared?: boolean;
    /** Add one deliberate misreading to the recorded sample, to show the Verifier catching it. */
    fault?: InjectedFault['id'];
  }): Promise<string> {
    if (req.fault && (req.profileId !== MISREAD_AMOUNT.profileId || req.mode !== 'replay'))
      throw new RunError('BAD_FAULT', 'The injected fault belongs to the recorded sample p07 only.');
    const { env } = this.o;
    const isSample = req.profileId !== undefined;
    if (req.mode === 'live' && env.offline)
      throw new RunError('OFFLINE', 'Headroom is running offline: only recorded sample runs are available.');
    if (req.mode === 'live' && !env.hasModelKey) {
      throw new RunError(
        'NO_MODEL_KEY',
        isSample
          ? 'No model key found. Run the recorded offline version instead.'
          : 'A model key is required to read your files. Add one to .env and restart.',
      );
    }
    let dir: string;
    if (isSample) {
      if (
        !/^[a-z0-9]+$/.test(req.profileId ?? '') ||
        !existsSync(join(this.o.profilesDir, req.profileId ?? '', 'profile.json'))
      )
        throw new RunError('PROFILE_NOT_FOUND', 'No such sample profile', 404);
      dir = join(this.o.profilesDir, req.profileId ?? '');
    } else {
      if (req.mode === 'replay')
        throw new RunError(
          'REPLAY_NOT_AVAILABLE',
          'Offline mode runs only recorded sample profiles; your files need a live model.',
        );
      dir = req.uploadDir ?? '';
    }
    const max = this.o.maxActive;
    if (max && !req.shared && this.activeRuns((this.o.now ?? Date.now)()) >= max)
      throw new RunError(
        'BUSY',
        'The sample server is busy with other visitors. Try again in a few seconds.',
        503,
      );
    let loaded: Awaited<ReturnType<typeof loadInputSet>>;
    this.starting += 1;
    try {
      loaded = await loadInputSet(dir);
    } catch (e) {
      throw new RunError('INPUTS_INVALID', e instanceof Error ? e.message : String(e));
    } finally {
      this.starting -= 1;
    }
    const { inputs, year, asOf } = loaded;
    if (isSample && !inputs.synthetic)
      throw new RunError('NOT_SYNTHETIC', 'Bundled profiles must be synthetic', 500);
    if (req.draft) inputs.draft = req.draft;

    const runId = `run-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const replay =
      req.mode === 'replay' && req.profileId
        ? this.o.replay?.backend(req.profileId, req.shared ? { instant: true } : undefined)
        : undefined;
    if (req.mode === 'replay' && !replay)
      throw new RunError('REPLAY_NOT_AVAILABLE', 'This sample profile has no recording.');
    const recorder =
      req.mode === 'live' && isSample && req.profileId ? this.o.recorder?.(runId, req.profileId) : undefined;
    const now = this.o.now ?? ((): number => Date.now());
    const kurs = createKursClient({
      fetcher: replay ? replay.kurs : this.o.liveFetcher,
      now,
      ...(recorder ? { onResponse: recorder.onKurs } : {}),
    });
    const hub = new SseHub();
    const headers = new Map<string, string[]>();
    for (const s of inputs.statements) headers.set(s.file, csvHeader(dir, s.file));
    if (inputs.kpo) headers.set(inputs.kpo.file, csvHeader(dir, inputs.kpo.file));
    const record: RunRecord = {
      runId,
      inputs,
      hub,
      kurs,
      source: isSample
        ? { kind: 'sample', profileId: req.profileId ?? '' }
        : { kind: 'upload', uploadId: req.uploadId ?? '' },
      mode: req.mode,
      readOnly: req.shared === true,
      ...(req.fault ? { fault: MISREAD_AMOUNT } : {}),
      startedAt: new Date(now()).toISOString(),
      ...(replay ? { recording: { recordedAt: replay.recordedAt, models: replay.models } } : {}),
      agents: new Map(),
      headers,
      viewEvents: [],
      run: undefined as unknown as Run,
    };
    const faulty = req.fault ? MISREAD_AMOUNT : undefined;
    const faultyDoc = faulty && inputs.documents.find((d) => d.fileName === `${faulty.invoice}.pdf`);
    if (faulty && !faultyDoc) throw new RunError('BAD_FAULT', 'The faulted invoice is missing.');
    // A replay asks the models it was recorded with, so its request hashes match the recording.
    // A recording is of one model, so a recorded run never moves to a backup; nor does a replay.
    const backups = req.mode === 'live' && !recorder && !this.o.modelBackend ? (env.backupModels ?? []) : [];
    const config = defaultRunConfig(year, asOf, {
      models: replay?.models ?? env.models,
      ...(backups.length > 0 ? { backupModels: backups } : {}),
    });
    const run = startRun({
      runId,
      inputs,
      rules: this.o.rules,
      config,
      mode: req.mode,
      kurs,
      ...(replay
        ? {
            backend:
              faulty && faultyDoc ? injectMisread(replay.backend, faultyDoc.sha256, faulty) : replay.backend,
          }
        : this.o.modelBackend
          ? { backend: this.o.modelBackend() }
          : {}),
      ...(recorder ? { inferenceObserver: recorder.observer } : {}),
      sinks: [
        (e) => hub.push(e),
        (e) => {
          if (e.type === 'hr.headroom.updated') record.card = e.payload as CardVM;
          if (VIEW_EVENT_TYPES.has(e.type)) record.viewEvents.push(e);
          if (e.type === 'hr.agent.status')
            record.agents.set((e.payload as { agentId: string }).agentId, e.payload);
          if (e.type === 'hr.run.completed') record.summary = e.payload as RunSummary;
          if (e.type === 'hr.run.reopened') delete record.summary;
        },
        ...(recorder ? [recorder.onEvent] : []),
      ],
      now,
      ...(this.o.quietMs !== undefined ? { quietMs: this.o.quietMs } : {}),
    });
    record.run = run;
    this.runs.set(runId, record);
    this.evictOldRuns();
    void run.done.then(
      (s) => recorder?.finish(s),
      () => undefined,
    );
    return runId;
  }

  get(runId: string): RunRecord {
    const r = this.runs.get(runId);
    if (!r) throw new RunError('RUN_NOT_FOUND', 'No such run', 404);
    return r;
  }

  snapshot(runId: string): unknown {
    const r = this.get(runId);
    const s = r.run.rt.state;
    return {
      runId,
      mode: r.mode,
      readOnly: r.readOnly,
      fault: r.fault ?? null,
      source: r.source,
      synthetic: r.inputs.synthetic,
      startedAt: r.startedAt,
      recording: r.recording ?? null,
      status: r.summary ? r.summary.status : 'running',
      lastEventId: r.hub.lastId,
      config: s.config,
      profile: { name: r.inputs.profile.name, pib: r.inputs.profile.pib },
      clients: r.inputs.clients.map((c) => ({ id: c.id, name: c.name, country: c.country })),
      draft: r.inputs.draft,
      figures: [...s.figures.values()],
      questions: [...s.questions.values()],
      discrepancies: [...s.discrepancies.values()],
      rejections: Object.fromEntries(s.rejections),
      loops: r.run.rt.loopMetrics(),
      agents: Object.fromEntries(r.agents),
      card: r.card ?? null,
      summary: r.summary ?? null,
      viewEvents: r.viewEvents,
      parseErrors: [...r.inputs.statements.flatMap((x) => x.errors), ...(r.inputs.kpo?.errors ?? [])],
      unreadable: r.inputs.documents
        .filter((d) => d.kind === 'unreadable')
        .map((d) => ({ fileName: d.fileName, reason: d.kind === 'unreadable' ? d.reason : '' })),
    };
  }

  figure(runId: string, figureId: string): { figure: Figure; sources: ResolvedSource[]; versions: Figure[] } {
    const r = this.get(runId);
    const f = r.run.rt.state.figures.get(figureId);
    if (!f) throw new RunError('FIGURE_NOT_FOUND', 'No such figure', 404);
    const ctx = { state: r.run.rt.state, inputs: r.inputs, rules: this.o.rules, kurs: r.kurs };
    const versions = r.run.rt.state.board
      .versions(f.key)
      .map((v) => r.run.rt.state.figures.get(v.id))
      .filter((x): x is Figure => x !== undefined);
    return {
      figure: f,
      sources: f.sources.map((s) => withHeaders(resolveSource(s, ctx), r.headers)),
      versions,
    };
  }

  /** A run the caller may change; the shared showcase is not one. */
  private writable(runId: string): RunRecord {
    const r = this.get(runId);
    if (r.readOnly)
      throw new RunError(
        'READ_ONLY',
        'This run is shared by every visitor and cannot be changed. Start your own sample run to try it.',
        403,
      );
    return r;
  }

  answer(runId: string, questionId: string, answer: unknown): void {
    const r = this.writable(runId);
    if (typeof answer !== 'string' || answer.trim() === '' || answer.length > 100)
      throw new RunError('BAD_ANSWER', 'Answer must be a short text');
    const res = r.run.human.answer(questionId, answer.trim());
    if (!res.ok) throw new RunError('BAD_ANSWER', res.error);
  }

  changeDraft(runId: string, raw: unknown): void {
    const r = this.writable(runId);
    const parsed = DraftSchema.safeParse(raw);
    if (!parsed.success)
      throw new RunError(
        'BAD_DRAFT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    if (!r.inputs.clients.some((c) => c.id === parsed.data.clientId))
      throw new RunError('BAD_DRAFT', 'Unknown client');
    r.run.human.changeDraft(parsed.data);
  }

  kpo(runId: string): KpoExport {
    const r = this.get(runId);
    const card = r.card;
    const incomplete = card
      ? card.completeness.gaps.map((g) => g.text)
      : ['The run has not verified its totals yet.'];
    return buildKpoExport(r.run.rt.state, r.inputs, this.o.rules, incomplete);
  }

  report(runId: string): unknown {
    const r = this.get(runId);
    const s = r.run.rt.state;
    return {
      runId,
      generatedAt: new Date().toISOString(),
      synthetic: r.inputs.synthetic,
      ...(r.fault ? { injectedFault: r.fault } : {}),
      summary: r.summary ?? null,
      card: r.card ?? null,
      discrepancies: [...s.discrepancies.values()].map((d) => ({
        type: d.type,
        title: d.title,
        detail: d.detail,
        status: d.status,
        figureIds: d.figureIds,
        sources: d.sources,
        ...(d.deltaRSD !== undefined ? { effectOn6mRSD: d.deltaRSD, measuredFrom: d.baseline } : {}),
      })),
      questions: [...s.questions.values()],
      figures: [...s.figures.values()].filter((f) => f.status === 'verified'),
    };
  }

  /** Forget runs built from an upload (Delete my files). */
  forgetUpload(uploadId: string): number {
    let n = 0;
    for (const [id, r] of this.runs) {
      if (r.source.kind === 'upload' && r.source.uploadId === uploadId) {
        r.hub.close();
        void r.run.dispose();
        this.runs.delete(id);
        n += 1;
      }
    }
    return n;
  }
}
