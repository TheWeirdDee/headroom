// npm run export:showcase: writes web/src/generated/showcase.json from the committed recording runs/demo-p07,
// by replaying it through the real pipeline. The landing page shows this snapshot when no Headroom server is
// reachable (a static frontend whose server is asleep), so the card and findings are never blank. It holds
// the replay's card, band crossings and findings, and the recorded run's own figures and loop times.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunManager } from '../src/server/run-manager.ts';
import { loadRules } from '../src/domain/rules/loader.ts';
import { replaySource } from '../src/engine/recordings.ts';
import type { AppEnv } from '../src/config/env.ts';

const ROOT = join(import.meta.dirname, '..');
const env: AppEnv = {
  port: 0,
  uploadMaxMb: 1,
  offline: true,
  hasModelKey: false,
  keyEnv: 'GEMINI_API_KEY',
  maxRpm: 0,
  models: { reader: 'gemini-3.5-flash-lite', verifier: 'gemini-3.5-flash-lite' },
  root: ROOT,
};
const source = replaySource(join(ROOT, 'runs'), { preserveTiming: false });
const runs = new RunManager({
  env,
  rules: loadRules(),
  profilesDir: join(ROOT, 'data', 'profiles'),
  liveFetcher: async (u) => {
    throw new Error(`offline: ${u}`);
  },
  replay: source,
});
const runId = await runs.showcase('p07');
if (!runId) throw new Error('No recording in runs/demo-p07.');
type Snap = {
  status: string;
  card: unknown;
  discrepancies: Array<{ status: string }>;
  viewEvents: Array<{ type: string; payload: unknown }>;
  recording: unknown;
};
let snap = runs.snapshot(runId) as Snap;
while (snap.status === 'running') {
  await new Promise((r) => setTimeout(r, 100));
  snap = runs.snapshot(runId) as Snap;
}
const s = source.summary('p07') as Record<string, unknown> & { figures: { verified: number } };
const out = {
  recording: snap.recording,
  card: snap.card,
  crossings: snap.viewEvents.filter((e) => e.type === 'hr.headroom.crossing').map((e) => e.payload),
  discrepancies: snap.discrepancies.filter((d) => d.status !== 'superseded'),
  recorded: {
    models: s['models'],
    wallTimeMs: s['wallTimeMs'],
    sumLoopTimeMs: s['sumLoopTimeMs'],
    maxConcurrentLoops: s['maxConcurrentLoops'],
    loops: s['loops'],
    failedLoops: s['failedLoops'],
    verified: s.figures.verified,
    unsourcedFigures: s['unsourcedFigures'],
    agentConflicts: source.agentConflicts('p07') ?? null,
    loopTimes: source.loops('p07'),
  },
};
const dir = join(ROOT, 'web', 'src', 'generated');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'showcase.json'), `${JSON.stringify(out)}\n`);
process.stdout.write(`Wrote web/src/generated/showcase.json (${out.discrepancies.length} findings)\n`);
process.exit(0);
