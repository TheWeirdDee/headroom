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
  startedAt: string;
  summary?: RunSummary;
  card?: CardVM;
  /** For replays: when the recording was made and with which models (shown in the top band). */
  recording?: { recordedAt: string; models: { reader: string; verifier: string } };
  agents: Map<string, unknown>;
  headers: Map<string, string[]>;
}

export interface ReplaySource {
  /** Recorded model responses and Kurs bodies for a sample profile, if a recording exists. */
  backend(
    profileId: string,
    override?: { preserveTiming?: boolean },
  ):
    | {
        backend: ModelBackend;
        kurs: Fetcher;
        recordedAt: string;
        models: { reader: string; verifier: string };
      }
    | undefined;
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
}

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

  /**
   * The landing page's showcase: one replay of the committed recording of `profileId`, without delays,
   * started on first request and shared by every visitor. Undefined when there is no recording.
   */
  async showcase(profileId: string): Promise<string | undefined> {
    if (!this.o.replay?.backend(profileId)) return undefined;
    this.showcaseRun ??= this.start({ profileId, mode: 'replay', fast: true });
    try {
      return await this.showcaseRun;
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
    /** Replay without the recorded delays (the landing page's showcase). */
    fast?: boolean;
  }): Promise<string> {
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
    let loaded: Awaited<ReturnType<typeof loadInputSet>>;
    try {
      loaded = await loadInputSet(dir);
    } catch (e) {
      throw new RunError('INPUTS_INVALID', e instanceof Error ? e.message : String(e));
    }
    const { inputs, year, asOf } = loaded;
    if (isSample && !inputs.synthetic)
      throw new RunError('NOT_SYNTHETIC', 'Bundled profiles must be synthetic', 500);
    if (req.draft) inputs.draft = req.draft;

    const runId = `run-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const replay =
      req.mode === 'replay' && req.profileId
        ? this.o.replay?.backend(req.profileId, req.fast ? { preserveTiming: false } : undefined)
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
      startedAt: new Date(now()).toISOString(),
      ...(replay ? { recording: { recordedAt: replay.recordedAt, models: replay.models } } : {}),
      agents: new Map(),
      headers,
      run: undefined as unknown as Run,
    };
    // A replay asks the models it was recorded with, so its request hashes match the recording.
    const config = defaultRunConfig(year, asOf, { models: replay?.models ?? env.models });
    const run = startRun({
      runId,
      inputs,
      rules: this.o.rules,
      config,
      mode: req.mode,
      kurs,
      ...(replay
        ? { backend: replay.backend }
        : this.o.modelBackend
          ? { backend: this.o.modelBackend() }
          : {}),
      ...(recorder ? { inferenceObserver: recorder.observer } : {}),
      sinks: [
        (e) => hub.push(e),
        (e) => {
          if (e.type === 'hr.headroom.updated') record.card = e.payload as CardVM;
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

  answer(runId: string, questionId: string, answer: unknown): void {
    const r = this.get(runId);
    if (typeof answer !== 'string' || answer.trim() === '' || answer.length > 100)
      throw new RunError('BAD_ANSWER', 'Answer must be a short text');
    const res = r.run.human.answer(questionId, answer.trim());
    if (!res.ok) throw new RunError('BAD_ANSWER', res.error);
  }

  changeDraft(runId: string, raw: unknown): void {
    const r = this.get(runId);
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
    return buildKpoExport(r.run.rt.state, r.inputs, this.o.rules);
  }

  report(runId: string): unknown {
    const r = this.get(runId);
    const s = r.run.rt.state;
    return {
      runId,
      generatedAt: new Date().toISOString(),
      synthetic: r.inputs.synthetic,
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
