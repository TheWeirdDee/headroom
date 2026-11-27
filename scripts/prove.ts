// npm run prove: run the p07 sample on Mozaik and measure how many model requests of how many agents
// were outstanding at the same time. Exits 1 if they did not overlap.
//   npm run prove             recorded model answers, no key, no network
//   npm run prove -- --live   the provider in .env (uses about 85 requests of your quota)
import { join } from 'node:path';
import { loadInputSet } from '../src/engine/load-inputs.ts';
import { startRun } from '../src/engine/run-engine.ts';
import { loadRules } from '../src/domain/rules/loader.ts';
import { defaultRunConfig } from '../src/config/defaults.ts';
import { loadEnv } from '../src/config/env.ts';
import { configurePacer } from '../src/runtime/pacer.ts';
import { createKursClient, liveFetcher } from '../src/integrations/kurs/client.ts';
import { replaySource } from '../src/engine/recordings.ts';
import { measureOverlap, proofFailures, type RequestInterval } from '../src/engine/overlap.ts';
import type { InferenceObserver } from '../src/runtime/types.ts';

const ROOT = join(import.meta.dirname, '..');
const live = process.argv.includes('--live');

async function main(): Promise<void> {
  const env = loadEnv(ROOT, live ? [] : ['--offline']);
  if (live && !env.hasModelKey) throw new Error(`--live needs ${env.keyEnv} in .env`);
  configurePacer(live ? env.maxRpm : 0);
  const recording = live
    ? undefined
    : replaySource(join(ROOT, 'runs'), {
        ratesFile: join(ROOT, 'data', 'rates', 'kurs.json'),
      }).backend('p07');
  if (!live && !recording) throw new Error('runs/demo-p07 is missing');
  const { inputs, year, asOf } = await loadInputSet(join(ROOT, 'data', 'profiles', 'p07'));

  const intervals: RequestInterval[] = [];
  const observer: InferenceObserver = {
    onRequest(request) {
      const start = performance.now();
      return () =>
        intervals.push({
          agentId: request.agentId,
          loopInputKey: request.loopInputKey,
          start,
          end: performance.now(),
        });
    },
  };
  const run = startRun({
    runId: 'run-prove',
    inputs,
    rules: loadRules(),
    config: defaultRunConfig(year, asOf, { models: recording?.models ?? env.models }),
    mode: live ? 'live' : 'replay',
    kurs: createKursClient({ fetcher: recording?.kurs ?? liveFetcher, now: Date.now }),
    ...(recording ? { backend: recording.backend } : {}),
    inferenceObserver: observer,
  });
  const summary = await run.done;
  await run.dispose();

  const o = measureOverlap(intervals);
  const t0 = Math.min(...intervals.map((i) => i.start));
  const t1 = Math.max(...intervals.map((i) => i.end));
  const span = Math.max(1, t1 - t0);
  const WIDTH = 60;
  const out = (s = ''): void => void process.stdout.write(`${s}\n`);
  const secs = (ms: number): string => `${(ms / 1000).toFixed(2)} s`;
  out(
    live
      ? `LIVE: provider requests to ${summary.models.reader}`
      : `REPLAY: real Mozaik loops; each model request is answered from the recording after a short pause`,
  );
  out(`Mozaik ${summary.mozaik.version} · ${summary.loops} agent loops · ${o.requests} model requests`);
  out();
  out(`When each agent had a model request outstanding (${secs(span)} from left to right):`);
  for (const a of o.byAgent) {
    const bar = Array.from({ length: WIDTH }, (_, k) => {
      const from = t0 + (k * span) / WIDTH;
      const to = from + span / WIDTH;
      const n = intervals.filter((i) => i.agentId === a.agentId && i.start < to && i.end > from).length;
      return n === 0 ? '.' : n > 9 ? '+' : String(n);
    }).join('');
    out(`  ${a.agentId.padEnd(20)} ${bar}  ${a.requests} requests`);
  }
  out();
  out(`Peak requests outstanding at once   ${o.peakRequests}`);
  out(`Peak agents waiting on a model      ${o.peakAgents} (${o.agentsAtPeak.join(', ')})`);
  out(`Time with 2+ agents waiting at once ${secs(o.multiAgentMs)} of ${secs(o.busyMs)} with any request`);
  out(`Sum of request times                ${secs(o.summedMs)} (one after another would take this long)`);
  out(`Run status                          ${summary.status}, ${summary.failedLoops} failed loops`);
  const failures = proofFailures(o, summary.failedLoops);
  out();
  if (failures.length === 0) out('PASS: the agents asked their models at the same time.');
  else {
    out(`FAIL: ${failures.join('; ')}.`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
