// npm run benchmark: the same agents on the same sample, once with model requests running concurrently and
// once with only one request allowed at a time. Everything else is identical: the Mozaik runtime, the
// agents, the checks and the recorded model answers. Each request is given the same service time (default:
// the median of the recorded requests that did not wait for a rate limit). Exits 1 if the two runs reach
// different totals, a loop fails, or concurrency is not at least twice as fast.
//   npm run benchmark                     writes web/src/generated/benchmark.json for the Proof page
//   npm run benchmark -- --latency 300    a quicker run with another service time (not written)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadInputSet } from '../src/engine/load-inputs.ts';
import { startRun } from '../src/engine/run-engine.ts';
import { loadRules } from '../src/domain/rules/loader.ts';
import { defaultRunConfig } from '../src/config/defaults.ts';
import { createKursClient } from '../src/integrations/kurs/client.ts';
import { replaySource } from '../src/engine/recordings.ts';
import { measureOverlap, type RequestInterval } from '../src/engine/overlap.ts';
import type { CardVM } from '../src/agents/limit-keeper/card.ts';
import type { ModelBackend } from '../src/runtime/types.ts';

const ROOT = join(import.meta.dirname, '..');
/** Recorded requests slower than this waited in the free tier's rate-limit queue. */
const QUEUED_MS = 10_000;

function recordedServiceTime(): { medianMs: number; sample: number } {
  const times = readFileSync(join(ROOT, 'runs', 'demo-p07', 'responses.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('"kind":"model"'))
    .map((l) => (JSON.parse(l) as { latencyMs: number }).latencyMs)
    .filter((ms) => ms < QUEUED_MS)
    .sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  const medianMs =
    times.length % 2 ? (times[mid] ?? 0) : Math.round(((times[mid - 1] ?? 0) + (times[mid] ?? 0)) / 2);
  return { medianMs, sample: times.length };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function measure(oneAtATime: boolean, serviceMs: number) {
  const recording = replaySource(join(ROOT, 'runs'), {
    instant: true,
    ratesFile: join(ROOT, 'data', 'rates', 'kurs.json'),
  }).backend('p07');
  if (!recording) throw new Error('runs/demo-p07 is missing');
  const { inputs, year, asOf } = await loadInputSet(join(ROOT, 'data', 'profiles', 'p07'));
  const intervals: RequestInterval[] = [];
  let started = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const backend: ModelBackend = {
    recorded: true,
    infer(request) {
      const serve = async () => {
        const from = performance.now() - started;
        await sleep(serviceMs);
        const response = await recording.backend.infer(request);
        intervals.push({
          agentId: request.agentId,
          loopInputKey: request.loopInputKey,
          start: Math.round(from),
          end: Math.round(performance.now() - started),
        });
        return response;
      };
      if (!oneAtATime) return serve();
      const turn = queue.then(serve);
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
  let answeredMs = 0;
  started = performance.now();
  const run = startRun({
    runId: oneAtATime ? 'run-serial' : 'run-concurrent',
    inputs,
    rules: loadRules(),
    config: defaultRunConfig(year, asOf, { models: recording.models }),
    mode: 'replay',
    kurs: createKursClient({ fetcher: recording.kurs, now: Date.now }),
    backend,
    sinks: [
      (e) => {
        if (e.type !== 'hr.headroom.updated' || answeredMs) return;
        if ((e.payload as CardVM).completeness.complete) answeredMs = Math.round(performance.now() - started);
      },
    ],
  });
  const summary = await run.done;
  await run.dispose();
  const o = measureOverlap(intervals);
  return {
    answeredMs,
    requests: o.requests,
    loops: summary.loops,
    failedLoops: summary.failedLoops,
    peakRequests: o.peakRequests,
    peakAgents: o.peakAgents,
    verified: summary.figures.verified,
    totals: [
      summary.headroom?.limit6m.withDraft.amount,
      summary.headroom?.limit6m.unbilled?.total.amount,
      summary.headroom?.vat8m.withDraft.amount,
    ],
    intervals: intervals.map((i) => ({ agentId: i.agentId, start: i.start, end: i.end })),
  };
}

async function main(): Promise<void> {
  const recorded = recordedServiceTime();
  const flag = process.argv.indexOf('--latency');
  const custom = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (custom !== undefined && !/^\d+$/.test(custom))
    throw new Error('--latency takes whole milliseconds, for example --latency 300');
  const serviceMs = custom === undefined ? recorded.medianMs : Number.parseInt(custom, 10);
  const out = (s = ''): void => void process.stdout.write(`${s}\n`);
  out(`Same sample, same agents, same recorded answers. Each model request takes ${serviceMs} ms.`);
  out();
  const concurrent = await measure(false, serviceMs);
  const serial = await measure(true, serviceMs);
  const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
  const speedup = serial.answeredMs / Math.max(1, concurrent.answeredMs);
  const row = (name: string, a: string | number, b: string | number): void =>
    out(`${name.padEnd(36)}${String(a).padStart(14)}${String(b).padStart(18)}`);
  row('', 'concurrent', 'one at a time');
  row('Time to a complete verdict', secs(concurrent.answeredMs), secs(serial.answeredMs));
  row('Model requests', concurrent.requests, serial.requests);
  row(
    'Agent loops (failed)',
    `${concurrent.loops} (${concurrent.failedLoops})`,
    `${serial.loops} (${serial.failedLoops})`,
  );
  row('Peak requests at once', concurrent.peakRequests, serial.peakRequests);
  row('Peak agents waiting at once', concurrent.peakAgents, serial.peakAgents);
  row('Figures verified', concurrent.verified, serial.verified);
  out();
  const same = JSON.stringify(concurrent.totals) === JSON.stringify(serial.totals);
  out(`Same totals in both runs: ${same ? 'yes' : 'NO'} (${concurrent.totals.join(' | ')})`);
  out(`Concurrent reached the verdict ${speedup.toFixed(1)} times sooner.`);
  out('A free tier that allows 15 requests a minute hides this: then the rate limit sets the pace.');
  const failures = [
    ...(same ? [] : ['the totals differ']),
    ...(concurrent.failedLoops + serial.failedLoops === 0 ? [] : ['a loop failed']),
    ...(concurrent.answeredMs > 0 && serial.answeredMs > 0 ? [] : ['a run gave no complete verdict']),
    ...(speedup >= 2 ? [] : ['concurrency was not at least twice as fast']),
  ];
  if (failures.length > 0) {
    out(`FAIL: ${failures.join('; ')}.`);
    process.exitCode = 1;
    return;
  }
  if (custom === undefined) {
    const file = join(ROOT, 'web', 'src', 'generated', 'benchmark.json');
    writeFileSync(
      file,
      `${JSON.stringify({ measuredAt: new Date().toISOString().slice(0, 10), serviceMs, serviceSample: recorded.sample, speedup: speedup.toFixed(1), concurrent, serial })}\n`,
    );
    out(`PASS. Wrote web/src/generated/benchmark.json`);
  } else out('PASS.');
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
