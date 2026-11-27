// Evaluation harness (PRD 19): runs every bundled profile N times, compares with its _truth, and writes the
// results with their denominators, the misses next to the hits, and the conditions.
//
//   npm run eval -- --mode live --runs 3 --confirm-spend   real model: writes eval/results.json + RESULTS.md
//   npm run eval -- --mode fake                            deterministic test model: writes eval/fake/ only
//
// Live runs cost money, so they need --confirm-spend (a gate the user decides). Fake-mode numbers measure
// the pipeline (rules, verifier, conflicts) with a model that cannot misread; they are never published as
// model accuracy, which is why they go to a separate folder the Evidence page does not read.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadInputSet } from '../src/engine/load-inputs.ts';
import { startRun, type RunSummary } from '../src/engine/run-engine.ts';
import { loadRules } from '../src/domain/rules/loader.ts';
import { defaultRunConfig } from '../src/config/defaults.ts';
import { createKursClient, liveFetcher } from '../src/integrations/kurs/client.ts';
import { cmp } from '../src/domain/money.ts';
import { loadEnv } from '../src/config/env.ts';
import { MOZAIK_PACKAGE } from '../src/runtime/mozaik/adapter.ts';
import { detectCsv } from '../src/inputs/detect.ts';
import { parseStatement, parseKpoBook } from '../src/inputs/tables.ts';
import { fakeModel } from '../test/helpers/fake-model.ts';
import type { HrEvent } from '../src/runtime/types.ts';
import { configurePacer } from '../src/runtime/pacer.ts';

const ROOT = join(import.meta.dirname, '..');
const COMMIT = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: join(import.meta.dirname, '..') })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
})();
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const mode = (arg('mode') ?? 'live') as 'live' | 'fake';
const runsPer = Number.parseInt(arg('runs') ?? (mode === 'fake' ? '1' : '3'), 10);
const env = loadEnv(ROOT, ['node', 'eval']);
configurePacer(mode === 'live' ? env.maxRpm : 0);
const profilesDir = join(ROOT, 'data', 'profiles');
const profiles = (arg('profiles')?.split(',') ?? readdirSync(profilesDir))
  .filter((p) => /^[cp]\d\d$/.test(p))
  .sort();

if (mode === 'live') {
  if (!env.hasModelKey) {
    process.stderr.write(`Live evaluation needs ${env.keyEnv} in .env.\n`);
    process.exit(1);
  }
  if (!process.argv.includes('--confirm-spend')) {
    process.stderr.write(
      `This makes ${profiles.length * runsPer} live runs (${profiles.length} profiles x ${runsPer}) with ${env.models.reader}. ` +
        'Each run reads every document with the model, so it costs money. Re-run with --confirm-spend to go ahead.\n',
    );
    process.exit(1);
  }
}

interface Truth {
  seed: string;
  plantedErrors: Array<{ type: string; subjectKey: string; note: string }>;
  invoices: Array<{
    number: string;
    issueDate: string;
    amountRSD: string;
    clientCountry: string;
    kind: string;
  }>;
  totals: { limit6m: { withDraft: string }; vat8m: { withDraft: string } };
}

interface RunResult {
  profileId: string;
  run: number;
  summary: RunSummary;
  found: string[];
  planted: string[];
  checked: number;
  correct: number;
  wrongVerified: Array<{ figureId: string; key: string; got: string; truth: string }>;
  contested: number;
  contestedWrong: number;
  headroomCorrect: boolean;
  headroom: string;
  emergent: string[];
  models: { reader: string; verifier: string };
  failedLoops: string[];
  /** The git commit the run was made on (runs saved before this field existed have none). */
  commit?: string;
}

const errKey = (type: string, subject: string): string => `${type}:${type === 'E8' ? '' : subject}`;
const rates = JSON.parse(readFileSync(join(ROOT, 'data', 'rates', 'kurs.json'), 'utf8')) as Record<
  string,
  { status: number; body: string }
>;

async function runOnce(profileId: string, n: number): Promise<RunResult> {
  const dir = join(profilesDir, profileId);
  const truth = JSON.parse(readFileSync(join(dir, '_truth', 'truth.json'), 'utf8')) as Truth;
  const { inputs, year, asOf } = await loadInputSet(dir);
  // Fake mode pins the clock to the profiles' as-of day so recorded rates answer; live uses real time.
  const t0 = Date.now();
  const now = mode === 'fake' ? (): number => Date.parse(`${asOf}T09:00:00Z`) + Date.now() - t0 : Date.now;
  const kurs = createKursClient({
    now,
    fetcher: mode === 'fake' ? async (u) => rates[u] ?? { status: 503, body: '' } : liveFetcher,
  });
  const events: HrEvent[] = [];
  const run = startRun({
    runId: `eval-${profileId}-${n}`,
    inputs,
    rules: loadRules(),
    config: defaultRunConfig(year, asOf, { models: env.models }),
    mode: 'live',
    kurs,
    ...(mode === 'fake' ? { backend: fakeModel() } : {}),
    sinks: [(e) => events.push(e)],
    now,
    runTimeoutMs: 3_600_000,
  });
  const summary = await run.done;
  const state = run.rt.state;
  const failedLoops = run.rt
    .loopMetrics()
    .filter((l) => l.status === 'failed')
    .map((l) => `${l.agentId}: ${l.error ?? 'failed'}`);
  run.dispose();

  const found = [...state.discrepancies.values()]
    .filter((d) => d.status === 'verified')
    .map((d) => errKey(d.type, d.subjectKey ?? ''));
  const planted = truth.plantedErrors.map((e) => errKey(e.type, e.subjectKey));

  // Figure accuracy and Verifier catches, on the invoice facts the truth states.
  const expected = new Map<string, string>();
  for (const inv of truth.invoices) {
    expected.set(`invoice:${inv.number}:issueDate`, inv.issueDate);
    expected.set(`invoice:${inv.number}:amountRSD`, inv.amountRSD);
    expected.set(`invoice:${inv.number}:kind`, inv.kind);
  }
  const text = (v: { t: string; [k: string]: unknown }): string =>
    v.t === 'money'
      ? String(v['amount'])
      : v.t === 'date'
        ? String(v['iso'])
        : v.t === 'text'
          ? String(v['text'])
          : '';
  const same = (a: string, b: string): boolean =>
    /^-?\d+(\.\d+)?$/.test(a) && /^-?\d+(\.\d+)?$/.test(b) ? cmp(a, b) === 0 : a === b;
  let checked = 0;
  let correct = 0;
  let contested = 0;
  let contestedWrong = 0;
  const wrongVerified: RunResult['wrongVerified'] = [];
  for (const f of state.figures.values()) {
    const want = expected.get(f.key);
    if (want === undefined) continue;
    const got = text(f.value as { t: string });
    if (f.status === 'verified') {
      checked += 1;
      if (same(got, want)) correct += 1;
      else wrongVerified.push({ figureId: f.id, key: f.key, got, truth: want });
    } else if (f.status === 'contested' || f.status === 'needs_user') {
      contested += 1;
      if (!same(got, want)) contestedWrong += 1;
    }
  }

  const withDraft = state.verified('total:limit6m:withDraft');
  const vat = state.verified('total:vat8m:withDraft');
  const headroom = `${withDraft?.value.t === 'money' ? withDraft.value.amount : '-'}|${vat?.value.t === 'money' ? vat.value.amount : '-'}`;
  const headroomCorrect =
    withDraft?.value.t === 'money' &&
    vat?.value.t === 'money' &&
    cmp(withDraft.value.amount, truth.totals.limit6m.withDraft) === 0 &&
    cmp(vat.value.amount, truth.totals.vat8m.withDraft) === 0;

  // Emergent conflicts: a planted E2/E4/E5/E7 that showed up as a real collision on the board between the
  // KpoReader and the InvoiceReader or RateClerk (no test code injects these).
  const producerOf = new Map([...state.figures.values()].map((f) => [f.id, f.producedBy]));
  const collisions = events
    .filter((e) => e.type === 'hr.figure.conflict')
    .map((e) => e.payload as { key: string; existingId: string; proposedId: string })
    .filter((p) => {
      const pair = new Set([producerOf.get(p.existingId), producerOf.get(p.proposedId)]);
      return pair.has('kpo-reader') && (pair.has('invoice-reader') || pair.has('rate-clerk'));
    })
    .map((p) => p.key);
  const emergent = truth.plantedErrors
    .filter((e) => ['E2', 'E4', 'E5', 'E7'].includes(e.type))
    .filter((e) => collisions.some((k) => k.startsWith(`${e.subjectKey}:`)))
    .map((e) => errKey(e.type, e.subjectKey));

  return {
    profileId,
    run: n,
    summary,
    found,
    planted,
    checked,
    correct,
    wrongVerified,
    contested,
    contestedWrong,
    headroomCorrect,
    headroom,
    emergent,
    models: mode === 'fake' ? { reader: 'fake-model (test)', verifier: 'fake-model (test)' } : env.models,
    failedLoops,
    ...(COMMIT ? { commit: COMMIT } : {}),
  };
}

function mapperScore(): { ok: number; total: number; misses: string[]; asked: string[] } {
  const dir = join(ROOT, 'test', 'fixtures', 'csv');
  const misses: string[] = [];
  const asked: string[] = [];
  let ok = 0;
  const files = readdirSync(dir).filter((f) => f.endsWith('.csv'));
  for (const f of files) {
    const bytes = readFileSync(join(dir, f));
    const d = detectCsv(bytes);
    // A statement without a currency column is mapped once the user gives the account currency (the
    // mapper asks); the fixtures are RSD accounts. That answer is the user's, so the case is named below.
    const m = d.mapping ?? (d.guess ? { ...d.guess, accountCurrency: 'RSD' as const } : undefined);
    if (!d.mapping && d.guess) asked.push(f);
    const parsed =
      m === undefined
        ? undefined
        : m.kind === 'kpo'
          ? parseKpoBook(f, bytes, m)
          : parseStatement(f, bytes, m);
    if (parsed && parsed.errors.length === 0 && parsed.rows.length > 0) ok += 1;
    else misses.push(`${f}: ${m ? `${parsed?.errors.length ?? 0} row errors` : 'layout not recognised'}`);
  }
  return { ok, total: files.length, misses, asked };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? 0 : s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const pct = (a: number, b: number): string => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(1)}%`);

// Live runs are saved one by one in eval/raw/, so batches run on different days (free-tier quota) add up
// and a quota cut-off loses nothing. --append reports over every saved run with the same models.
// --out keeps each model's live results in its own folder, so one table never mixes models.
const outDir = mode === 'live' ? join(ROOT, arg('out') ?? 'eval') : join(ROOT, 'eval', 'fake');
const rawDir = join(outDir, 'raw');
const append = mode === 'live' && process.argv.includes('--append');
const results: RunResult[] = [];
if (append && existsSync(rawDir)) {
  for (const f of readdirSync(rawDir)
    .filter((x) => /^[cp]\d\d-r\d+\.json$/.test(x))
    .sort()) {
    const r = JSON.parse(readFileSync(join(rawDir, f), 'utf8')) as RunResult;
    if (r.models.reader !== env.models.reader || r.models.verifier !== env.models.verifier) {
      process.stderr.write(`${f} was made with other models (${r.models.reader}); not mixing them.\n`);
      process.exit(1);
    }
    results.push(r);
  }
  process.stdout.write(`Loaded ${results.length} saved runs from eval/raw.\n`);
}
let stopped: string | undefined;
outer: for (const p of profiles) {
  const before = results.filter((r) => r.profileId === p).length;
  for (let i = 1; i <= runsPer; i++) {
    const n = before + i;
    process.stdout.write(`${p} run ${n}... `);
    const r = await runOnce(p, n);
    const quota = r.failedLoops.find((e) => /daily request quota/i.test(e));
    if (quota) {
      // A run cut short by the provider's daily quota measures the quota, not Headroom: it is not counted.
      stopped = `${p} run ${n} hit the daily quota and was not counted`;
      process.stdout.write('stopped: daily quota used up\n');
      break outer;
    }
    results.push(r);
    if (mode === 'live') {
      mkdirSync(rawDir, { recursive: true });
      writeFileSync(join(rawDir, `${p}-r${n}.json`), `${JSON.stringify(r)}\n`);
    }
    process.stdout.write(
      `${r.found.length} findings, ${r.failedLoops.length} failed loops, ${(r.summary.wallTimeMs / 1000).toFixed(1)} s\n`,
    );
  }
}
if (results.length === 0) {
  process.stderr.write(`No runs to report${stopped ? `: ${stopped}` : ''}.\n`);
  process.exit(1);
}
const measured = [...new Set(results.map((r) => r.profileId))].sort();
const runsOf = (p: string): number => results.filter((r) => r.profileId === p).length;
const repeated = measured.filter((p) => runsOf(p) > 1);

// 1. Detection per type.
const types = [...new Set(results.flatMap((r) => r.planted.map((k) => k.split(':')[0] ?? '')))].sort();
const perType = types.map((t) => {
  let planted = 0;
  let found = 0;
  for (const r of results) {
    const pl = r.planted.filter((k) => k.startsWith(`${t}:`));
    planted += pl.length;
    found += pl.filter((k) => r.found.includes(k)).length;
  }
  const extra = results.reduce(
    (s, r) => s + r.found.filter((k) => k.startsWith(`${t}:`) && !r.planted.includes(k)).length,
    0,
  );
  return { type: t, planted, found, missed: planted - found, extra };
});
const misses = results.flatMap((r) =>
  r.planted
    .filter((k) => !r.found.includes(k))
    .map((k) => ({
      profileId: r.profileId,
      type: k.split(':')[0] ?? '',
      detail: `run ${r.run}: not found (${k})`,
    })),
);
for (const r of results)
  for (const w of r.wrongVerified)
    misses.push({
      profileId: r.profileId,
      type: 'wrong figure verified',
      detail: `run ${r.run}: ${w.figureId} ${w.key} = ${w.got}, truth ${w.truth}`,
    });

const plantedTotal = perType.reduce((s, t) => s + t.planted, 0);
const foundTotal = perType.reduce((s, t) => s + t.found, 0);
const clean = results.filter((r) => r.planted.length === 0);
const falsePos = results.reduce((s, r) => s + r.found.filter((k) => !r.planted.includes(k)).length, 0);
const falseClean = clean.reduce((s, r) => s + r.found.length, 0);
const checked = results.reduce((s, r) => s + r.checked, 0);
const correct = results.reduce((s, r) => s + r.correct, 0);
const wrongVerified = results.reduce((s, r) => s + r.wrongVerified.length, 0);
const contested = results.reduce((s, r) => s + r.contested, 0);
const contestedWrong = results.reduce((s, r) => s + r.contestedWrong, 0);
const unsourced = results.reduce((s, r) => s + r.summary.unsourcedFigures, 0);
const headOk = results.filter((r) => r.headroomCorrect).length;
const consistent = repeated.filter(
  (p) => new Set(results.filter((r) => r.profileId === p).map((r) => r.headroom)).size === 1,
).length;
const emergentPlanted = results.reduce(
  (s, r) => s + r.planted.filter((k) => /^(E2|E4|E5|E7):/.test(k)).length,
  0,
);
const emergent = results.reduce((s, r) => s + r.emergent.length, 0);
const rejections: Record<string, number> = {};
for (const r of results)
  for (const [k, v] of Object.entries(r.summary.rejections)) rejections[k] = (rejections[k] ?? 0) + v;
const mapper = mapperScore();
const scope = `on ${measured.length} synthetic profiles we designed`;

const metrics = [
  {
    name: 'Planted errors detected',
    value: `${foundTotal} / ${plantedTotal} (${pct(foundTotal, plantedTotal)})`,
    note: scope,
  },
  {
    name: 'False discrepancies on clean profiles',
    value: `${falseClean} in ${clean.length} runs`,
    target: '0',
    passed: falseClean === 0,
  },
  { name: 'Findings that were not planted (all profiles)', value: String(falsePos) },
  {
    name: 'Verified invoice facts equal to the truth',
    value: `${correct} / ${checked} (${pct(correct, checked)})`,
    note: 'issue date, amount in RSD and kind of every invoice',
  },
  {
    name: 'Wrong figures that got verified',
    value: String(wrongVerified),
    target: '0',
    passed: wrongVerified === 0,
    note: 'the most important miss: listed below with figure ids',
  },
  { name: 'Contested figures that were in fact wrong', value: `${contestedWrong} / ${contested}` },
  { name: 'Figures shown without a source', value: String(unsourced), target: '0', passed: unsourced === 0 },
  {
    name: 'Runs with 6M and 8M totals (with the draft) equal to the truth',
    value: `${headOk} / ${results.length}`,
  },
  {
    name: 'Profiles with identical headroom across runs',
    value: repeated.length ? `${consistent} / ${repeated.length}` : 'n/a',
    note: repeated.length
      ? `measured only on profiles with more than one run: ${repeated.map((p) => `${p} (${runsOf(p)} runs)`).join(', ')}`
      : 'every profile ran once',
  },
  {
    name: 'Runs with a failed loop',
    value: `${results.filter((r) => r.failedLoops.length > 0).length} / ${results.length}`,
  },
  {
    name: 'Median loops running at once (peak)',
    value: String(median(results.map((r) => r.summary.maxConcurrentLoops))),
  },
  {
    name: 'Median loop time / wall time',
    value: median(results.map((r) => r.summary.sumLoopTimeMs / Math.max(1, r.summary.wallTimeMs))).toFixed(2),
    note:
      mode === 'fake'
        ? 'the test model answers instantly, so wall time is mostly the quiet period that ends a run'
        : 'above 1 means loops overlapped',
  },
  {
    name: 'Median wall time per run',
    value: `${(median(results.map((r) => r.summary.wallTimeMs)) / 1000).toFixed(1)} s`,
  },
  {
    name: 'Median tokens per run (in / out)',
    value: `${median(results.map((r) => r.summary.tokens.in))} / ${median(results.map((r) => r.summary.tokens.out))}`,
  },
  {
    name: 'Verifier contests by reason (all runs)',
    value: Object.entries(rejections)
      .map(([k, v]) => `${k} ${v}`)
      .join(', '),
  },
  {
    name: 'Planted book errors that surfaced as real agent conflicts',
    value: `${emergent} / ${emergentPlanted}`,
    note: 'E2, E4, E5, E7: KpoReader against InvoiceReader or RateClerk',
  },
  {
    name: 'Messy CSV layouts parsed without errors',
    value: `${mapper.ok} / ${mapper.total}`,
    note:
      [...mapper.misses, ...mapper.asked.map((f) => `${f}: account currency asked from the user`)].join(
        '; ',
      ) || undefined,
  },
].map((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)));

const seed = (
  JSON.parse(readFileSync(join(profilesDir, measured[0] ?? 'p07', '_truth', 'truth.json'), 'utf8')) as Truth
).seed;
const evidence = {
  generatedAt: new Date().toISOString(),
  conditions: {
    date: new Date().toISOString().slice(0, 10),
    mode,
    models: mode === 'fake' ? { reader: 'fake-model (test)', verifier: 'fake-model (test)' } : env.models,
    mozaikVersion: MOZAIK_PACKAGE.version,
    runsPerProfile: Object.fromEntries(measured.map((p) => [p, runsOf(p)])),
    profiles: measured,
    ...(stopped ? { stopped } : {}),
    seed,
  },
  metrics,
  perType,
  misses,
};

mkdirSync(join(outDir, 'raw'), { recursive: true });
writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(evidence, null, 2)}\n`);
writeFileSync(join(outDir, 'raw', 'runs.json'), `${JSON.stringify(results, null, 2)}\n`);
const md = [
  '# Headroom evaluation results',
  '',
  `Measured ${evidence.conditions.date} ${scope}, runs per profile: ${measured.map((p) => `${p} ${runsOf(p)}`).join(', ')}; mode ${mode}, models ${evidence.conditions.models.reader} / ${evidence.conditions.models.verifier}, Mozaik ${MOZAIK_PACKAGE.version}, profile seed ${seed}.`,
  mode === 'fake'
    ? '\nFake mode uses the deterministic test model: it measures the pipeline, not model reading accuracy.\n'
    : '',
  stopped ? `\nIncomplete: ${stopped}.\n` : '',
  '| Metric | Value | Target | Note |',
  '|---|---|---|---|',
  ...metrics.map((m) => `| ${m['name']} | ${m['value']} | ${m['target'] ?? ''} | ${m['note'] ?? ''} |`),
  '',
  '## By planted error type',
  '',
  '| Type | Planted | Found | Missed | Extra |',
  '|---|---|---|---|---|',
  ...perType.map((t) => `| ${t.type} | ${t.planted} | ${t.found} | ${t.missed} | ${t.extra} |`),
  '',
  '## Misses',
  '',
  ...(misses.length ? misses.map((m) => `- ${m.profileId} ${m.type}: ${m.detail}`) : ['None in these runs.']),
  '',
  'Not financial or tax advice. Synthetic data only.',
  '',
].join('\n');
writeFileSync(join(outDir, 'RESULTS.md'), md);
process.stdout.write(`\nWrote ${join(outDir, 'results.json')} and RESULTS.md\n`);
// CI assertions: a figure shown without a source is a blocker, and in fake mode (where the model cannot
// misread) a wrong verified figure is a pipeline bug.
if (unsourced > 0 || (mode === 'fake' && wrongVerified > 0)) {
  process.stderr.write(
    `FAILED: ${unsourced} unsourced figure(s), ${wrongVerified} wrong verified figure(s)\n`,
  );
  process.exit(1);
}
process.exit(0);
