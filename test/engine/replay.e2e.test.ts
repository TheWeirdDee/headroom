// Replay determinism: a recorded run of p07, replayed 10 times through real Mozaik loops,
// reaches the same board every time (keys, values, statuses, sources), and a missing response fails loudly
// with REPLAY_MISS instead of inventing anything. The recording is made here with the deterministic test
// model; the shipped demo recording is made the same way with a real model (npm run record-demo).
import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/server/run-manager.ts';
import { loadRules } from '../../src/domain/rules/loader.ts';
import { replaySource, sampleRecorder } from '../../src/engine/recordings.ts';
import { fakeModel } from '../helpers/fake-model.ts';
import type { AppEnv } from '../../src/config/env.ts';

const rates = JSON.parse(readFileSync('data/rates/kurs.json', 'utf8')) as Record<
  string,
  { status: number; body: string }
>;
const rules = loadRules();
const env: AppEnv = {
  port: 0,
  uploadMaxMb: 1,
  offline: false,
  hasModelKey: true,
  models: { reader: 'fake-model (test)', verifier: 'fake-model (test)' },
  root: '.',
  keyEnv: 'GEMINI_API_KEY',
  maxRpm: 0,
};
const NOW = Date.parse('2026-11-26T09:00:00Z');

interface Snap {
  status: string;
  recording: { recordedAt: string; models: { reader: string } } | null;
  figures: Array<{
    id: string;
    key: string;
    value: unknown;
    status: string;
    producedBy: string;
    sources: unknown[];
  }>;
  discrepancies: Array<{ type: string; subjectKey?: string; status: string; deltaRSD?: string }>;
  questions: Array<{ subjectKey: string; options: string[] }>;
  loops: Array<{ status: string; error?: string }>;
  card: unknown;
}

function manager(runsDir: string, mode: 'record' | 'replay', runEnv: AppEnv = env): RunManager {
  const t0 = Date.now();
  return new RunManager({
    env: runEnv,
    rules,
    profilesDir: 'data/profiles',
    liveFetcher: async (u) => rates[u] ?? { status: 503, body: '' },
    modelBackend: () => fakeModel(),
    ...(mode === 'record'
      ? { recorder: sampleRecorder(runsDir) }
      : { replay: replaySource(runsDir, { instant: true }) }),
    now: () => NOW + Date.now() - t0,
    quietMs: 300,
  });
}

async function run(m: RunManager, mode: 'live' | 'replay'): Promise<Snap> {
  const runId = await m.start({ profileId: 'p07', mode });
  for (let i = 0; i < 300; i++) {
    const s = m.snapshot(runId) as unknown as Snap;
    if (s.status !== 'running') return s;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run did not finish');
}

/** The board without ids and times: what a person sees. Sorted, so loop scheduling order does not matter. */
function board(s: Snap): string {
  const figures = s.figures
    .filter((f) => f.status !== 'superseded')
    .map((f) => JSON.stringify([f.key, f.value, f.status, f.producedBy, f.sources]))
    .sort();
  const disc = s.discrepancies
    .map((d) => JSON.stringify([d.type, d.subjectKey, d.status, d.deltaRSD]))
    .sort();
  const qs = s.questions.map((q) => JSON.stringify([q.subjectKey, q.options])).sort();
  // Figure ids depend on which loop wrote first; references to them are compared by key (and version).
  const ids = new Map(s.figures.map((f) => [(f as unknown as { id: string }).id, f.key]));
  // Wall-clock stamps (fetchedAt, answeredAt) say when this run happened; they are the only fields allowed
  // to differ. Response hashes, values, statuses and sources must match exactly.
  return JSON.stringify({ figures, disc, qs, card: s.card })
    .replace(/\\?"(fetchedAt|answeredAt|createdAt)\\?":\\?"[^"\\]*\\?"/g, '"$1":"<time>"')
    .replace(/f\d{6}/g, (id) => `<${ids.get(id) ?? id}>`);
}

describe('replay', () => {
  let runsDir: string;
  let recorded: Snap;
  beforeAll(async () => {
    runsDir = mkdtempSync(join(tmpdir(), 'headroom-runs-'));
    const m = manager(runsDir, 'record');
    recorded = await run(m, 'live');
    const [dir] = (await import('node:fs')).readdirSync(runsDir);
    renameSync(join(runsDir, dir ?? ''), join(runsDir, 'demo-p07'));
  }, 60_000);

  it('reaches the recorded board 10 times out of 10', async () => {
    const expected = board(recorded);
    expect(recorded.figures.length).toBeGreaterThan(100);
    for (let i = 0; i < 10; i++) {
      const s = await run(manager(runsDir, 'replay'), 'replay');
      expect(s.loops.filter((l) => l.status === 'failed')).toEqual([]);
      expect(s.recording?.models.reader).toBe('fake-model (test)');
      expect(board(s)).toBe(expected);
    }
  }, 120_000);

  it('replays with the recorded models even when the configured models differ', async () => {
    const other: AppEnv = { ...env, models: { reader: 'gemini-3.5-flash', verifier: 'gemini-3.5-flash' } };
    const s = await run(manager(runsDir, 'replay', other), 'replay');
    expect(s.loops.filter((l) => l.status === 'failed')).toEqual([]);
    expect(board(s)).toBe(board(recorded));
  }, 60_000);

  it('serves one shared showcase replay of the recording for the landing page', async () => {
    const m = manager(runsDir, 'replay');
    const [a, b] = await Promise.all([m.showcase('p07'), m.showcase('p07')]);
    expect(a).toBeDefined();
    expect(b).toBe(a);
    expect(await m.showcase('p01')).toBeUndefined();
    let s = m.snapshot(a ?? '') as unknown as Snap;
    for (let i = 0; i < 300 && s.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      s = m.snapshot(a ?? '') as unknown as Snap;
    }
    expect(board(s)).toBe(board(recorded));
    // Every visitor sees this run, so nobody may change it.
    expect(() => m.changeDraft(a ?? '', {})).toThrow(/shared by every visitor/);
    const q = (m.snapshot(a ?? '') as unknown as { questions: Array<{ id: string }> }).questions[0];
    expect(() => m.answer(a ?? '', q?.id ?? '', 'Yes')).toThrow(/shared by every visitor/);
    expect((m.snapshot(a ?? '') as { readOnly: boolean }).readOnly).toBe(true);
  }, 60_000);

  it('fails loudly with REPLAY_MISS when a recorded response is missing', async () => {
    const file = join(runsDir, 'demo-p07', 'responses.jsonl');
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const firstModel = lines.findIndex((l) => l.includes('"kind":"model"'));
    writeFileSync(file, `${lines.filter((_, i) => i !== firstModel).join('\n')}\n`);
    const s = await run(manager(runsDir, 'replay'), 'replay');
    const failed = s.loops.filter((l) => l.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]?.error).toMatch(/REPLAY_MISS/);
  }, 60_000);
});
