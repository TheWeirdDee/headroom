// npm run export:evidence: writes web/src/generated/evidence.json for the Evidence page from the committed
// result files (eval/), the recorded sample's summary and the sample plan. Nothing is typed in by hand.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;

const SETS = [
  {
    id: 'gemini',
    folder: 'eval',
    title: 'Real model: Gemini, free tier',
    note: 'Made on 27 November before later changes to the pipeline (the completeness gate, one-to-one payment matching, field checks and the Mozaik participant rework).',
  },
  {
    id: 'groq-current',
    folder: 'eval/current-groq',
    title: 'Real model: Groq, later code',
    note: 'Made on the afternoon of 27 November, on the code of that time.',
  },
  {
    id: 'groq',
    folder: 'eval/groq-gpt-oss-120b',
    title: 'Real model: Groq, earlier code',
    note: 'Both false findings came from Headroom, not the model, and were fixed afterwards (see the evaluation notes).',
  },
  {
    id: 'fake',
    folder: 'eval/fake',
    title: 'Deterministic test model: all 14 samples',
    note: 'The test model cannot misread, so this measures the pipeline (rules, Verifier, conflicts, totals), not how well a model reads documents.',
  },
];

interface Result {
  generatedAt: string;
  conditions: unknown;
  metrics: unknown[];
  perType: unknown[];
  misses: unknown[];
}

const sets = SETS.filter((s) => existsSync(join(ROOT, s.folder, 'results.json'))).map((s) => {
  const r = read<Result>(`${s.folder}/results.json`);
  return { ...s, conditions: r.conditions, metrics: r.metrics, perType: r.perType, misses: r.misses };
});

const plan = read<{
  seed: string;
  asOf: string;
  profiles: Array<{ id: string; errors: string[] } & Record<string, unknown>>;
}>('scripts/profile-seeds.json');
const samples = plan.profiles.map((p) => {
  const dir = join('data', 'profiles', p.id);
  const lines = (f: string): number =>
    readFileSync(join(ROOT, dir, f), 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#')).length - 1;
  const traits = [
    p['showcase'] ? 'the sample shown on this site' : '',
    p['weekendForeignInvoice'] ? 'foreign invoice dated on a weekend' : '',
    p['exempt'] ? 'exempt from the independence test' : '',
    p['injection'] ? 'an invoice carries a prompt-injection line' : '',
    p['criterion6'] ? 'one client above 70% of income' : '',
  ].filter(Boolean);
  return {
    id: p.id,
    errors: p.errors,
    invoices: readdirSync(join(ROOT, dir, 'invoices')).length,
    statementRows: lines('statement.csv'),
    bookRows: lines('kpo.csv'),
    traits,
  };
});

const summary = read<Record<string, unknown>>('runs/demo-p07/summary.json');
const recorded = Object.fromEntries(
  [
    'models',
    'loops',
    'failedLoops',
    'wallTimeMs',
    'maxConcurrentLoops',
    'figures',
    'rejections',
    'tokens',
  ].map((k) => [k, summary[k]]),
);

// The header and first row of the showcase sample's own CSV files, as the example formats in the docs.
const firstRows = (file: string): string =>
  readFileSync(join(ROOT, 'data', 'profiles', 'p07', file), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .slice(0, 2)
    .join('\n');
const examples = { statement: firstRows('statement.csv'), book: firstRows('kpo.csv') };

writeFileSync(
  join(ROOT, 'web', 'src', 'generated', 'evidence.json'),
  `${JSON.stringify({ seed: plan.seed, asOf: plan.asOf, sets, samples, recorded, examples })}\n`,
);
process.stdout.write(
  `Wrote web/src/generated/evidence.json (${sets.length} result sets, ${samples.length} samples)\n`,
);
