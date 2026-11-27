// Recording and replay: the offline path for bundled samples. A live run of a sample profile
// writes runs/<runId>/ with every event, every model response keyed by requestHash and every Kurs response.
// Replay is real Mozaik execution with a custom inference runner that returns the recorded response for
// each requestHash; a miss fails loudly with REPLAY_MISS and nothing is invented.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestHash } from '../runtime/request-hash.ts';
import { serializeEvent, serializeValue } from './serialize.ts';
import { replayFetcher, type Fetcher } from '../integrations/kurs/client.ts';
import { MOZAIK_PACKAGE } from '../runtime/mozaik/runtime.ts';
import type {
  HrInferenceRequest,
  HrInferenceResponse,
  InferenceObserver,
  ModelBackend,
  HrEvent,
} from '../runtime/types.ts';
import type { RunSummary } from './run-engine.ts';

export class ReplayMissError extends Error {
  readonly code = 'REPLAY_MISS';
  constructor(
    readonly requestHash: string,
    readonly agentId: string,
  ) {
    super(
      `REPLAY_MISS: this replay asked for something that was not recorded (agent ${agentId}, request ${requestHash}). Nothing was invented. Re-record the demo.`,
    );
    this.name = 'ReplayMissError';
  }
}

interface ResponseRecord {
  kind: 'model';
  requestHash: string;
  agentId: string;
  loopInputKey: string;
  step: number;
  latencyMs: number;
  response: HrInferenceResponse;
}

interface KursRecord {
  kind: 'kurs';
  url: string;
  httpStatus: number;
  body: string;
}

export interface Recorder {
  observer: InferenceObserver;
  onKurs: (r: { url: string; httpStatus: number; body: string }) => void;
  onEvent: (e: HrEvent) => void;
  finish: (s: RunSummary) => void;
}

/** Records live runs of bundled sample profiles. Uploads are never recorded (the caller never asks). */
export function sampleRecorder(runsDir: string): (runId: string, profileId: string) => Recorder {
  return (runId, profileId) => {
    const dir = join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    const responses = join(dir, 'responses.jsonl');
    const events = join(dir, 'events.jsonl');
    writeFileSync(responses, '');
    writeFileSync(events, '');
    return {
      observer: {
        onResponse(req: HrInferenceRequest, res: HrInferenceResponse, latencyMs: number) {
          const rec: ResponseRecord = {
            kind: 'model',
            requestHash: requestHash(req),
            agentId: req.agentId,
            loopInputKey: req.loopInputKey,
            step: req.step,
            latencyMs,
            response: res,
          };
          appendFileSync(responses, `${serializeValue(rec, 'response')}\n`);
        },
      },
      onKurs(r) {
        const rec: KursRecord = { kind: 'kurs', url: r.url, httpStatus: r.httpStatus, body: r.body };
        appendFileSync(responses, `${serializeValue(rec, 'kurs')}\n`);
      },
      onEvent(e) {
        appendFileSync(events, `${serializeEvent(e)}\n`);
      },
      finish(s) {
        writeFileSync(join(dir, 'summary.json'), `${serializeValue(s, 'summary')}\n`);
        writeFileSync(
          join(dir, 'meta.json'),
          `${JSON.stringify({ profileId, runId, recordedAt: new Date().toISOString(), models: s.models, mozaik: MOZAIK_PACKAGE }, null, 2)}\n`,
        );
      },
    };
  };
}

/**
 * Pause before each recorded answer, so the run screen shows the agents working. The recorded latency is
 * not replayed: it holds the time requests waited for the free-tier quota (up to two minutes each).
 */
export const REPLAY_PAUSE_MS = 250;

export interface ReplayTiming {
  /** Recorded NBS responses shipped with the samples, used for a date the recording did not ask for. */
  ratesFile?: string;
  /** Play the recorded latencies this many times faster, instead of the short fixed pause. */
  speed?: number;
  /** Answer at once (tests and the landing page's showcase). */
  instant?: boolean;
}

export interface LoadedRecording {
  backend: ModelBackend;
  kurs: Fetcher;
  recordedAt: string;
  models: { reader: string; verifier: string };
  responses: number;
}

/** Load a recording folder into a replay backend and a Kurs fetcher. */
export function loadRecording(dir: string, opts: ReplayTiming = {}): LoadedRecording {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
    recordedAt: string;
    models: { reader: string; verifier: string };
  };
  const models = new Map<string, ResponseRecord>();
  const kurs = new Map<string, { status: number; body: string }>(
    opts.ratesFile
      ? Object.entries(
          JSON.parse(readFileSync(opts.ratesFile, 'utf8')) as Record<
            string,
            { status: number; body: string }
          >,
        )
      : [],
  );
  for (const line of readFileSync(join(dir, 'responses.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as ResponseRecord | KursRecord;
    if (rec.kind === 'model') models.set(rec.requestHash, rec);
    else kurs.set(rec.url, { status: rec.httpStatus, body: rec.body });
  }
  const waitFor = (latencyMs: number): number => {
    if (opts.instant) return 0;
    return opts.speed === undefined ? REPLAY_PAUSE_MS : latencyMs / opts.speed;
  };
  return {
    recordedAt: meta.recordedAt,
    models: meta.models,
    responses: models.size,
    kurs: replayFetcher(kurs),
    backend: {
      recorded: true,
      async infer(req) {
        const hash = requestHash(req);
        const rec = models.get(hash);
        if (!rec) throw new ReplayMissError(hash, req.agentId);
        const wait = waitFor(rec.latencyMs);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        return rec.response;
      },
    },
  };
}

/** Recordings committed for bundled samples live in runs/demo-<profileId>/. */
export function replaySource(
  runsDir: string,
  opts: ReplayTiming = {},
): {
  backend(profileId: string, override?: ReplayTiming): LoadedRecording | undefined;
  summary(profileId: string): unknown;
  loops(profileId: string): unknown[];
  agentConflicts(profileId: string): number | undefined;
} {
  return {
    /**
     * Conflicts in the recorded run between two different agents. Recordings made before the claims helper
     * treated an agent's own revision as a revision also logged those as conflicts; they are not counted.
     */
    agentConflicts(profileId) {
      const file = join(runsDir, `demo-${profileId}`, 'events.jsonl');
      if (!existsSync(file)) return undefined;
      const producer = new Map<string, string>();
      let n = 0;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const e = JSON.parse(line) as {
          type: string;
          payload: {
            figure?: { id?: string; producedBy?: string };
            existingId?: string;
            proposedId?: string;
          };
        };
        const f = e.payload.figure;
        if (f?.id && f.producedBy) producer.set(f.id, f.producedBy);
        if (e.type === 'hr.figure.conflict') {
          const a = producer.get(e.payload.existingId ?? '');
          const b = producer.get(e.payload.proposedId ?? '');
          if (a && b && a !== b) n += 1;
        }
      }
      return n;
    },
    /** The recorded run's loops with their real start and end times (from hr.loop.finished/failed). */
    loops(profileId) {
      const file = join(runsDir, `demo-${profileId}`, 'events.jsonl');
      if (!existsSync(file)) return [];
      const out: unknown[] = [];
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('"hr.loop.finished"') && !line.includes('"hr.loop.failed"')) continue;
        const e = JSON.parse(line) as { type: string; payload: unknown };
        if (e.type === 'hr.loop.finished' || e.type === 'hr.loop.failed') out.push(e.payload);
      }
      return out;
    },
    /** The recorded run's own summary (its real timing and counts), if the recording has one. */
    summary(profileId) {
      const file = join(runsDir, `demo-${profileId}`, 'summary.json');
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : undefined;
    },
    backend(profileId, override) {
      const dir = join(runsDir, `demo-${profileId}`);
      if (!existsSync(join(dir, 'meta.json')) || !existsSync(join(dir, 'responses.jsonl'))) return undefined;
      return loadRecording(dir, { ...opts, ...override });
    },
  };
}

export function recordedProfiles(runsDir: string): string[] {
  return existsSync(runsDir)
    ? readdirSync(runsDir)
        .filter((d) => d.startsWith('demo-'))
        .map((d) => d.slice('demo-'.length))
    : [];
}
