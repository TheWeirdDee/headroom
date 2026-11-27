// Evidence: every measured result set in the repository, with its conditions, per-mistake counts and
// misses, the sample files they ran on, and what has not been measured. The numbers come from the committed
// result files (npm run export:evidence).
import { Link } from 'react-router';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Block, Code, PageHeader, Stats, Table, WithSideNav } from '../components/Doc.tsx';
import { REPO_URL } from '../components/Layout.tsx';
import { useApp } from '../state/app.ts';
import data from '../generated/evidence.json';

interface Metric {
  name: string;
  value: string;
  target?: string;
  passed?: boolean;
  note?: string;
}
interface ResultSet {
  id: string;
  folder: string;
  title: string;
  note: string;
  conditions: {
    date: string;
    models: { reader: string; verifier: string };
    mozaikVersion: string;
    runsPerProfile: Record<string, number>;
    stopped?: string;
  };
  metrics: Metric[];
  perType: Array<{ type: string; planted: number; found: number; missed: number; extra: number }>;
  misses: Array<{ profileId: string; type: string; detail: string }>;
}
const evidence = data as unknown as {
  seed: string;
  asOf: string;
  sets: ResultSet[];
  samples: Array<{
    id: string;
    errors: string[];
    invoices: number;
    statementRows: number;
    bookRows: number;
    traits: string[];
  }>;
};

const TYPES: Array<[string, string]> = [
  ['E1', 'Payment received with no matching invoice'],
  ['E2', 'KPO book uses a different date than the invoice'],
  ['E3', 'Issued invoice missing from the KPO book'],
  ['E4', 'KPO amount differs from the invoice amount in RSD'],
  ['E5', 'KPO amount uses a rate other than the NBS middle rate'],
  ['E6', 'Duplicate KPO row for one invoice'],
  ['E7', 'Previous-year invoice counted in this year'],
  ['E8', 'Gap in invoice numbering (worth checking)'],
  ['E9', 'Client country differs between invoice and client details'],
];

const runs = (s: ResultSet): number => Object.values(s.conditions.runsPerProfile).reduce((a, b) => a + b, 0);
const metric = (s: ResultSet, start: string): string =>
  s.metrics.find((m) => m.name.startsWith(start))?.value ?? 'n/a';

function Results({ s }: { s: ResultSet }) {
  const models =
    s.conditions.models.reader === s.conditions.models.verifier
      ? s.conditions.models.reader
      : `${s.conditions.models.reader} and ${s.conditions.models.verifier}`;
  return (
    <Block id={s.id} title={s.title} lead={s.note}>
      <p className="text-sm">
        {s.conditions.date} · <span className="font-mono text-text">{models}</span> · Mozaik{' '}
        {s.conditions.mozaikVersion} · {runs(s)} runs:{' '}
        {Object.entries(s.conditions.runsPerProfile)
          .map(([p, n]) => `${p} ×${n}`)
          .join(', ')}
        {s.conditions.stopped ? `. Incomplete: ${s.conditions.stopped}.` : ''}
      </p>
      <Table
        caption={`${s.title}: metrics`}
        head={['Metric', 'Value', 'Target']}
        min={480}
        rows={s.metrics.map((m) => [
          <span key="n">
            {m.name}
            {m.note && <span className="block text-xs text-muted">{m.note}</span>}
          </span>,
          <span key="v" className="num">
            {m.value}
          </span>,
          m.target === undefined ? (
            ''
          ) : (
            <span key="t" className="inline-flex items-center gap-1 whitespace-nowrap">
              {m.passed ? (
                <CircleCheck size={14} className="text-text" aria-hidden />
              ) : (
                <CircleAlert size={14} className="text-danger" aria-hidden />
              )}
              {m.target} {m.passed ? 'met' : 'not met'}
            </span>
          ),
        ])}
      />
      <details className="rounded-md border border-line">
        <summary className="cursor-pointer px-4 py-3 text-sm text-text">
          By mistake type, and every miss ({s.misses.length})
        </summary>
        <div className="space-y-3 border-t border-line p-3">
          <Table
            caption={`${s.title}: by mistake type`}
            head={['Type', 'Planted', 'Found', 'Missed', 'Extra']}
            min={360}
            rows={s.perType.map((t) => [t.type, t.planted, t.found, t.missed, t.extra])}
          />
          {s.misses.length === 0 ? (
            <p className="text-sm">No misses in these runs.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.misses.map((m, i) => (
                <li key={i} className="break-words">
                  <span className="font-mono text-xs text-text">
                    {m.profileId} {m.type}
                  </span>{' '}
                  {m.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
      <a
        className="text-sm text-text underline underline-offset-4 hover:text-signal"
        href={`${REPO_URL}/tree/main/${s.folder}`}
        target="_blank"
        rel="noreferrer"
      >
        Result files in {s.folder}/
      </a>
    </Block>
  );
}

export function Evidence() {
  const rules = useApp((s) => s.rules);
  const count = (status: string): number => rules?.filter((r) => r.status === status).length ?? 0;
  const nav = [
    { id: 'summary', label: 'Summary' },
    ...evidence.sets.map((s) => ({ id: s.id, label: s.title.replace(/^Real model: /, '') })),
    { id: 'samples', label: 'The sample files' },
    { id: 'rules', label: 'Rules used' },
    { id: 'not-measured', label: 'Not measured' },
    { id: 'repeat', label: 'Repeat it' },
  ];
  return (
    <div>
      <PageHeader kicker="Evidence" title="What has been measured, and what has not.">
        <p>
          How well Headroom finds the mistakes planted in synthetic sample files, measured by a script anyone
          can run. Each table names its model, date and runs.
        </p>
      </PageHeader>
      <WithSideNav items={nav}>
        <Block id="summary" title="Summary">
          <Stats
            items={[
              { value: evidence.samples.length, label: 'synthetic sample profiles' },
              { value: TYPES.length, label: 'kinds of planted mistake' },
              { value: evidence.sets.reduce((n, s) => n + runs(s), 0), label: 'scored runs below' },
              {
                value: evidence.sets.filter((s) => s.id !== 'fake').reduce((n, s) => n + runs(s), 0),
                label: 'of them with a real model',
              },
            ]}
          />
          <Table
            caption="Result sets"
            head={[
              'Result set',
              'Runs',
              'Planted errors found',
              'Wrong figures verified',
              'Totals equal to truth',
            ]}
            min={720}
            rows={evidence.sets.map((s) => [
              <Link
                key="t"
                to={`/evidence#${s.id}`}
                className="underline underline-offset-4 hover:text-signal"
              >
                {s.title}
              </Link>,
              runs(s),
              metric(s, 'Planted errors detected'),
              metric(s, 'Wrong figures that got verified'),
              metric(s, 'Runs with 6M and 8M totals'),
            ])}
          />
          <p className="text-sm">
            Real-model runs are few: the free tiers allow a limited number a day. Most of them were made
            before later changes to the code, as each section says. The newest measurement of speed is on the{' '}
            <Link to="/proof#speed" className="text-text underline underline-offset-4 hover:text-signal">
              Proof page
            </Link>
            .
          </p>
        </Block>

        {evidence.sets.map((s) => (
          <Results key={s.id} s={s} />
        ))}

        <Block
          id="samples"
          title="The sample files"
          lead={`Invented people and companies, generated from the seed ${evidence.seed} and checked as of ${evidence.asOf}. The same seed gives the same bytes, and a test proves it. Each profile has invoices as PDFs, a bank statement, a KPO book and client details.`}
        >
          <Table
            caption="Sample profiles"
            head={['Profile', 'Invoices', 'Bank rows', 'Book rows', 'Planted mistakes', 'Notes']}
            min={720}
            rows={evidence.samples.map((p) => [
              <span key="i" className="font-mono">
                {p.id}
              </span>,
              p.invoices,
              p.statementRows,
              p.bookRows,
              <span key="e" className="font-mono text-xs">
                {p.errors.join(' ') || 'none (clean)'}
              </span>,
              p.traits.join('; '),
            ])}
          />
          <Table
            caption="Kinds of planted mistake"
            head={['Type', 'What it is']}
            min={420}
            rows={TYPES.map(([t, d]) => [
              <span key="t" className="font-mono">
                {t}
              </span>,
              d,
            ])}
          />
        </Block>

        <Block
          id="rules"
          title="Rules used"
          lead="A number is only as good as the rule behind it, so each rule carries a status and its sources."
        >
          {rules ? (
            <Stats
              items={[
                { value: rules.length, label: 'rules in the table' },
                { value: count('verified'), label: 'confirmed from a cited source' },
                { value: count('product'), label: 'Headroom display conventions' },
                { value: count('assumption'), label: 'assumptions an accountant should confirm' },
              ]}
            />
          ) : (
            <p className="text-sm">Rule counts load from the server.</p>
          )}
          <Link to="/about" className="text-sm text-text underline underline-offset-4 hover:text-signal">
            Every rule with its sources
          </Link>
        </Block>

        <Block id="not-measured" title="What has not been measured">
          <ul className="list-disc space-y-2 pl-5">
            <li>The 14 sample profiles have not all been run with a real model on the current code.</li>
            <li>No profile was run three times with a real model.</li>
            <li>Only Gemini and Groq models have been run, all small free-tier ones.</li>
            <li>No real taxpayer’s files have been used; the bank and book layouts are synthetic.</li>
            <li>The tax rules marked as assumptions have not been confirmed by an accountant.</li>
          </ul>
        </Block>

        <Block id="repeat" title="Repeat it">
          <Code>{`npm run eval -- --mode fake --runs 2          # all 14 samples, no key
npm run eval -- --mode live --confirm-spend   # with the model in .env (uses your quota)
npm run benchmark                             # concurrent against one request at a time
npm run export:evidence                       # rebuild this page's data`}</Code>
          <a
            className="text-sm text-text underline underline-offset-4 hover:text-signal"
            href={`${REPO_URL}/blob/main/docs/evaluation.md`}
            target="_blank"
            rel="noreferrer"
          >
            Evaluation notes: the recordings, what failed on the way and why
          </a>
        </Block>
      </WithSideNav>
    </div>
  );
}
