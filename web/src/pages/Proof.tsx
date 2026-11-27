// The claims, each with the measurement or run that supports it and the command that repeats it. The
// concurrency figures come from npm run benchmark, the loop timeline and findings from the committed
// recording; nothing here is typed in by hand except the explanations.
import { Link } from 'react-router';
import { ArrowUpRight, PlayCircle, ScanSearch } from 'lucide-react';
import { Block, Cards, Code, PageHeader, Stats, Table, WithSideNav } from '../components/Doc.tsx';
import { Lanes } from '../components/Lanes.tsx';
import { ShowcaseProof, ShowcaseTimeline, useShowcaseRun } from '../components/Showcase.tsx';
import { REPO_URL } from '../components/Layout.tsx';
import { useApp } from '../state/app.ts';
import { useStartSample } from '../state/useStartSample.ts';
import benchmark from '../generated/benchmark.json';
import snapshot from '../generated/showcase.json';

interface Measured {
  answeredMs: number;
  requests: number;
  loops: number;
  failedLoops: number;
  peakRequests: number;
  peakAgents: number;
  verified: number;
  intervals: Array<{ agentId: string; start: number; end: number }>;
}
const bench = benchmark as unknown as {
  measuredAt: string;
  serviceMs: number;
  serviceSample: number;
  speedup: string;
  concurrent: Measured;
  serial: Measured;
};

const caught = snapshot.fault;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

const NAV = [
  { id: 'speed', label: 'Concurrency pays' },
  { id: 'recorded', label: 'The recorded live run' },
  { id: 'catch', label: 'A wrong number caught' },
  { id: 'disagree', label: 'Findings with sources' },
  { id: 'checks', label: 'What checks what' },
  { id: 'replay', label: 'Same answer every time' },
  { id: 'repeat', label: 'Check it yourself' },
];

function Chart({ title, run }: { title: string; run: Measured }) {
  const span = bench.serial.intervals.reduce((m, i) => Math.max(m, i.end), 0);
  return (
    <figure className="rounded-md border border-line bg-panel p-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span className="text-text">{title}</span>
        <span className="num">
          verdict after <span className="text-text">{secs(run.answeredMs)}</span> · peak {run.peakRequests}{' '}
          {run.peakRequests === 1 ? 'request' : 'requests'} at once
        </span>
      </figcaption>
      <Lanes
        label={`${title}: ${run.requests} model requests, verdict after ${secs(run.answeredMs)}`}
        from={0}
        to={span}
        spans={run.intervals}
      />
    </figure>
  );
}

export function Proof() {
  const showcase = useShowcaseRun();
  const health = useApp((s) => s.health);
  const { start, busy, error } = useStartSample();
  const r = showcase.recorded;
  const { concurrent, serial } = bench;
  const button =
    'inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:border-muted hover:bg-panel disabled:opacity-60';
  return (
    <div>
      <PageHeader
        kicker="Proof"
        title={
          <>
            The same agents, <em className="text-signal">{bench.speedup} times sooner</em> when they run
            together.
          </>
        }
        aside={
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
            {[
              [secs(concurrent.answeredMs), 'to a complete verdict, agents running concurrently'],
              [secs(serial.answeredMs), 'the same work, one model request at a time'],
              [String(concurrent.peakRequests), 'model requests in flight at the peak'],
              [String(r.unsourcedFigures), 'numbers shown without a source'],
            ].map(([v, l]) => (
              <div key={l} className="bg-ink p-5">
                <dd className="num text-3xl font-medium">{v}</dd>
                <dt className="mt-2 text-sm text-muted">{l}</dt>
              </div>
            ))}
          </dl>
        }
      >
        <p>
          Every claim on this site, with the run behind it and the command that repeats it. All data is
          synthetic. Not financial or tax advice.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" disabled={busy || !health} onClick={() => start('p07')} className={button}>
            <PlayCircle size={16} aria-hidden /> Run the sample
          </button>
          <button
            type="button"
            disabled={busy || !health}
            onClick={() => start('p07', 'replay', 'misread-amount')}
            className={button}
          >
            <ScanSearch size={16} aria-hidden /> Catch a wrong number
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </PageHeader>

      <WithSideNav items={NAV}>
        <Block
          id="speed"
          title="Concurrency pays"
          lead={`The sample is run twice on the current code. Only one thing differs: in the second run a single model request may be in flight at a time. Same Mozaik runtime, same agents, same checks, same recorded model answers. Each request takes ${(bench.serviceMs / 1000).toFixed(1)} s, the median of the ${bench.serviceSample} recorded requests that did not wait for a rate limit. Both charts use the same time scale.`}
        >
          <Chart title="Agents running concurrently" run={concurrent} />
          <Chart title="One model request at a time" run={serial} />
          <Table
            caption="Concurrent against one request at a time"
            head={['Measure', 'Concurrent', 'One at a time']}
            min={320}
            rows={[
              ['Time to a complete verdict', secs(concurrent.answeredMs), secs(serial.answeredMs)],
              ['Model requests', concurrent.requests, serial.requests],
              [
                'Agent loops (failed)',
                `${concurrent.loops} (${concurrent.failedLoops})`,
                `${serial.loops} (${serial.failedLoops})`,
              ],
              ['Peak requests at once', concurrent.peakRequests, serial.peakRequests],
              ['Peak agents waiting at once', concurrent.peakAgents, serial.peakAgents],
              ['Figures verified', concurrent.verified, serial.verified],
              ['6M and 8M totals', 'identical', 'identical'],
            ]}
          />
          <p className="text-sm">
            Measured {bench.measuredAt} by <code className="font-mono text-text">npm run benchmark</code>. A
            free tier that allows 15 requests a minute hides this gain: there the rate limit sets the pace,
            and a year of about a dozen invoices takes about 6 minutes either way.
          </p>
        </Block>

        <Block
          id="recorded"
          title="The recorded live run"
          lead={`The sample on this site replays a run made with ${r.models.reader}. A bar below is one agent loop, from its start to its answer, including the wait for the free tier’s rate limit.`}
        >
          <Stats
            items={[
              { value: r.loops, label: `agent loops, ${r.failedLoops} failed` },
              { value: r.maxConcurrentLoops, label: 'loops open at once' },
              { value: r.verified, label: 'figures verified in that run' },
              { value: r.agentConflicts ?? 'n/a', label: 'disagreements between agents, settled' },
            ]}
          />
          <ShowcaseTimeline recorded={r} />
        </Block>

        <Block
          id="catch"
          title="A wrong number, caught"
          lead={`${caught.note} Every screen and report of such a run says so. What follows is the pipeline’s own work.`}
        >
          <Code>
            {caught.versions
              .map(
                (v) =>
                  `invoice-reader proposed ${v.amount} -> ${v.status.toUpperCase()}${v.reason ? `: ${v.reason}` : ''}`,
              )
              .join('\n')}
          </Code>
          <p>
            The InvoiceReader is sent back to the document with the Verifier’s note, and the 6M total equals
            that of the run without the fault. This catch is a code check: the cited line does not hold the
            number. <code className="font-mono text-text">npm run demo:catch</code> repeats it and exits with
            an error if it does not happen.
          </p>
        </Block>

        <Block
          id="disagree"
          title="Findings, each with its sources"
          lead="What the agents found in the synthetic sample, which has six mistakes planted in it. Open Evidence on any line to see the invoice line, bank row or book row."
        >
          <ShowcaseProof runId={showcase.runId} />
        </Block>

        <Block id="checks" title="What checks what">
          <Table
            caption="Checks on a figure before it counts"
            head={['Check', 'Done by', 'A figure fails it when']}
            rows={[
              ['Source presence', 'code', 'it cites nothing, or a line that does not exist'],
              ['Integrity', 'code', 'the cited text or its hash has changed'],
              ['Derivation', 'code', 'a conversion or total does not recompute to the cent'],
              [
                'Dates, amounts, currencies, invoice numbers',
                'code',
                'the line does not show the value, or shows another field: a due date, a unit price, a subtotal',
              ],
              [
                'Country, goods or service, payment kind, contract criteria',
                'model',
                'a second reading, which sees only the claim and the excerpt, does not support it',
              ],
              [
                'Plausibility',
                'code',
                'a date is outside the tax year range, an amount is not positive, a currency is unknown',
              ],
              [
                'Agreement between agents',
                'Verifier',
                'two agents claim different values: both are checked, and the stronger source wins',
              ],
            ]}
          />
        </Block>

        <Block id="replay" title="Same answer every time">
          <Cards
            cols={2}
            items={[
              {
                title: 'Replay is deterministic',
                body: 'A test replays the committed recording ten times through real Mozaik loops and requires the same figures, values, statuses, sources, findings and card each time.',
              },
              {
                title: 'Nothing is invented on replay',
                body: 'A request the recording does not hold stops the loop with REPLAY_MISS. Requests are matched by a hash of their own input.',
              },
              {
                title: 'Failure is visible',
                body: 'A failed model loop keeps the card Incomplete and ends the run degraded or failed. Tests inject such failures.',
              },
              {
                title: 'Shared state cannot be overwritten silently',
                body: (
                  <>
                    Every board write goes through a small versioned claims package: agreement corroborates,
                    disagreement is a conflict. It has its own property tests.
                  </>
                ),
              },
            ]}
          />
        </Block>

        <Block id="repeat" title="Check it yourself">
          <Code>{`git clone ${REPO_URL}.git && cd headroom
npm run setup
npm run benchmark      # concurrent against one request at a time
npm run prove          # model requests that were really in flight together
npm run demo:catch     # the injected misread is rejected
npm test               # unit and end to end tests, no key
npm run start:offline  # the app, http://localhost:4317`}</Code>
          <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link to="/evidence" className="text-text underline underline-offset-4 hover:text-signal">
              Measured results
            </Link>
            <Link to="/agents" className="text-text underline underline-offset-4 hover:text-signal">
              The agents
            </Link>
            <a
              href={`${REPO_URL}/actions`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-text underline underline-offset-4 hover:text-signal"
            >
              CI runs <ArrowUpRight size={14} aria-hidden />
            </a>
          </p>
        </Block>
      </WithSideNav>
    </div>
  );
}
