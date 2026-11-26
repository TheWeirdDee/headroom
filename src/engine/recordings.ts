// Recording and replay (PRD 14.6): the offline path for bundled samples. A live run of a sample profile
// writes runs/<runId>/ with every event, every model response keyed by requestHash and every Kurs response.
// Replay is real Mozaik execution with a custom inference runner that returns the recorded response for
// each requestHash; a miss fails loudly with REPLAY_MISS and nothing is invented.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requestHash } from '../runtime/request-hash.ts';
import { serializeEvent, serializeValue } from './serialize.ts';
import { replayFetcher, type Fetcher } from '../integrations/kurs/client.ts';
import { MOZAIK_PACKAGE } from '../runtime/mozaik/adapter.ts';
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

export interface LoadedRecording {
  backend: ModelBackend;
  kurs: Fetcher;
  recordedAt: string;
  models: { reader: string; verifier: string };
  responses: number;
}

/** Load a recording folder into a replay backend and a Kurs fetcher. */
export function loadRecording(
  dir: string,
  opts: { speed?: number; preserveTiming?: boolean } = {},
): LoadedRecording {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
    recordedAt: string;
    models: { reader: string; verifier: string };
  };
  const models = new Map<string, ResponseRecord>();
  const kurs = new Map<string, { status: number; body: string }>();
  for (const line of readFileSync(join(dir, 'responses.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as ResponseRecord | KursRecord;
    if (rec.kind === 'model') models.set(rec.requestHash, rec);
    else kurs.set(rec.url, { status: rec.httpStatus, body: rec.body });
  }
  const speed = opts.speed ?? 1;
  const preserve = opts.preserveTiming ?? true;
  return {
    recordedAt: meta.recordedAt,
    models: meta.models,
    responses: models.size,
    kurs: replayFetcher(kurs),
    backend: {
      async infer(req) {
        const hash = requestHash(req);
        const rec = models.get(hash);
        if (!rec) throw new ReplayMissError(hash, req.agentId);
        if (preserve && rec.latencyMs > 0) await new Promise((r) => setTimeout(r, rec.latencyMs / speed));
        return rec.response;
      },
    },
  };
}

/** Recordings committed for bundled samples live in runs/demo-<profileId>/. */
export function replaySource(
  runsDir: string,
  opts: { speed?: number; preserveTiming?: boolean } = {},
): {
  backend(profileId: string, override?: { preserveTiming?: boolean }): LoadedRecording | undefined;
} {
  return {
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
