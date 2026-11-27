// npm run export:showcase: writes web/src/generated/showcase.json from the committed recording runs/demo-p07,
// by replaying it through the real pipeline. The landing page shows this snapshot when no Headroom server is
// reachable (a static frontend whose server is asleep), so the card and findings are never blank. It holds
// the replay's card, band crossings and findings, and the recorded run's own figures and loop times.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunManager } from '../src/server/run-manager.ts';
import { loadRules } from '../src/domain/rules/loader.ts';
import { replaySource } from '../src/engine/recordings.ts';
import { MISREAD_AMOUNT } from '../src/engine/faults.ts';
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
const source = replaySource(join(ROOT, 'runs'), { instant: true });
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
// What each agent put on the board in this replay: counts, and a few figures with the line they cite.
type Fig = {
  key: string;
  producedBy: string;
  status: string;
  value: Record<string, unknown> & { t: string };
  sources: Array<Record<string, unknown> & { type: string }>;
  checks?: Array<{ name: string; passed: boolean; detail?: string }>;
};
const figures = (snap as unknown as { figures: Fig[] }).figures;
const cite = (s: Fig['sources'][number]): string =>
  s.type === 'document'
    ? `${String(s['docId'])}.pdf, line ${String(s['lineStart'])}: "${String(s['excerpt'])}"`
    : s.type === 'statement_row' || s.type === 'kpo_row'
      ? `${String(s['file'])}, row ${String(s['rowIndex'])}: ${String(s['rawLine'])}`
      : s.type === 'url'
        ? String(s['url'])
        : s.type === 'derived'
          ? `computed from ${(s['figureIds'] as string[]).length} figures`
          : s.type === 'contract_field'
            ? `contract, ${String(s['field'])}: "${String(s['value'])}"`
            : s.type === 'rule'
              ? `rule ${String(s['ruleId'])}`
              : 'your answer';
const agents = Object.fromEntries(
  [...new Set(figures.map((f) => f.producedBy))].map((id) => {
    const mine = figures.filter((f) => f.producedBy === id);
    const shape = (key: string): string => key.replace(/:[^:]*d[^:]*(?=:|$)/g, ':*');
    const examples = [
      ...new Map(mine.filter((f) => f.status === 'verified').map((f) => [shape(f.key), f])).values(),
    ]
      .slice(0, 4)
      .map((f) => ({ key: f.key, value: f.value, source: cite(f.sources[0] ?? { type: 'user_answer' }) }));
    return [
      id,
      {
        proposed: mine.length,
        verified: mine.filter((f) => f.status === 'verified').length,
        contested: mine.filter((f) => f.status === 'contested').length,
        examples,
      },
    ];
  }),
);
// The injected misread, replayed: what was proposed, why it was rejected and what was verified instead.
const faultId = await runs.start({ profileId: 'p07', mode: 'replay', fault: MISREAD_AMOUNT.id });
const faultRun = runs.get(faultId);
await faultRun.run.done;
const versions = faultRun.run.rt.state.board
  .versions(`invoice:${MISREAD_AMOUNT.invoice}:amount`)
  .map((v) => faultRun.run.rt.state.figures.get(v.id))
  .map((f) => ({
    amount: f?.value.t === 'money' ? `${f.value.amount} ${f.value.currency}` : '',
    status: f?.status ?? '',
    reason: f?.checks?.find((c) => !c.passed)?.detail ?? '',
  }));
const fault = { note: MISREAD_AMOUNT.note, versions };
const out = {
  fault,
  agents,
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
