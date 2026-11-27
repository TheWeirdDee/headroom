// The agents, one by one: when each wakes, what it reads and writes, what a model does and what code does,
// and who checks it. Counts and examples come from a replay of the committed recording
// (npm run export:showcase); the descriptions follow src/agents.
import { Link } from 'react-router';
import {
  ArrowUpRight,
  BookOpenCheck,
  Calculator,
  Landmark,
  Layers,
  ReceiptText,
  Scale,
  ScanSearch,
} from 'lucide-react';
import { Block, Cards, PageHeader, Stats, Table, WithSideNav } from '../components/Doc.tsx';
import { REPO_URL } from '../components/Layout.tsx';
import { valueText } from '../format/money.ts';
import type { FigureValue } from '../api/types.ts';
import snapshot from '../generated/showcase.json';

interface Produced {
  proposed: number;
  verified: number;
  contested: number;
  examples: Array<{ key: string; value: FigureValue; source: string }>;
}
const data = snapshot as unknown as {
  agents: Record<string, Produced>;
  recorded: { loops: number; loopTimes: Array<{ agentId: string }>; maxConcurrentLoops: number };
};

interface AgentInfo {
  id: string;
  name: string;
  Icon: typeof ReceiptText;
  job: string;
  story: string;
  model: string;
  wakes: string[];
  reads: string;
  writes: string[];
  checks: string[];
  checkedBy: string;
}

const AGENTS: AgentInfo[] = [
  {
    id: 'invoice-reader',
    name: 'InvoiceReader',
    Icon: ReceiptText,
    job: 'Reads every invoice PDF.',
    story:
      'One loop per document, up to four at a time. The model reads the numbered text of the PDF and submits each field with the exact excerpt it came from.',
    model: 'One model loop per invoice',
    wakes: [
      'The run starts',
      'One of its own figures is contested: it reads that document again, with the Verifier’s note',
    ],
    reads: 'The text layer of each invoice PDF, and your client list to match the buyer.',
    writes: [
      'invoice number, issue date, supply date',
      'amount and currency',
      'client, client country',
      'goods or service',
    ],
    checks: [
      'Code refuses an excerpt that is not verbatim in the document',
      'Dates must be ISO and amounts dot decimals before they are posted',
      'A document with no text layer is reported as unreadable, never guessed',
    ],
    checkedBy:
      'The Verifier compares each field with its line. The KpoReader states the same date and amount from your book, so a mismatch becomes a conflict.',
  },
  {
    id: 'statement-reader',
    name: 'StatementReader',
    Icon: Landmark,
    job: 'Sorts the money that arrived.',
    story:
      'Code parses your bank CSV. The model classifies incoming rows (client payment, own transfer, refund, fee) and proposes which invoice a row pays, citing the words in the row.',
    model: 'One model loop per 25 bank rows',
    wakes: [
      'The run starts',
      'A payment, link or invoice figure is settled',
      'One of its figures is contested',
      'The InvoiceReader finishes: it then looks for client payments with no invoice',
    ],
    reads: 'Your bank statement rows, and the verified invoice amounts and dates.',
    writes: [
      'payment amount, date, counterparty',
      'payment class',
      'link from a payment to an invoice',
      'E1: payment with no invoice',
    ],
    checks: [
      'A link must be written in the row itself',
      'Every row must be answered exactly once',
      'One invoice accounts for one payment; a second payment of the same amount is flagged',
    ],
    checkedBy:
      'The Verifier re-reads a classification the row does not support, and can send it back with a note.',
  },
  {
    id: 'kpo-reader',
    name: 'KpoReader',
    Icon: BookOpenCheck,
    job: 'States what your own book says.',
    story:
      'Code parses the KPO book. The model only matches each row’s description to an invoice number. Code then claims the book’s date, amount and products-or-services column on the same keys the InvoiceReader uses.',
    model: 'One model loop per 25 book rows',
    wakes: ['The run starts'],
    reads: 'Your existing KPO book.',
    writes: [
      'the book’s date for an invoice',
      'the book’s RSD amount',
      'goods or service column',
      'E6: duplicate row',
    ],
    checks: ['A match must be named by the row’s description', 'Column 5 must equal column 3 plus column 4'],
    checkedBy:
      'Its claims collide with the invoices’. Where they differ the Verifier settles it, and the book loses to the invoice document.',
  },
  {
    id: 'rate-clerk',
    name: 'RateClerk',
    Icon: Scale,
    job: 'Converts foreign amounts at the official rate.',
    story:
      'No model. It fetches the National Bank of Serbia middle rate through the Kurs API, converts with exact decimals and keeps the response as the source. If a rate cannot be fetched, it asks you.',
    model: 'None: rules in code',
    wakes: [
      'An invoice amount, currency or date is verified',
      'Another agent claims an amount in RSD',
      'The draft invoice changes, or a rate is needed',
    ],
    reads: 'Verified invoice fields and the NBS rate responses.',
    writes: [
      'rate per currency and date',
      'invoice amount in RSD',
      'the draft in RSD',
      'E5: the book used a rate other than the NBS middle rate',
    ],
    checks: [
      'Never uses a rate it did not fetch or you did not type',
      'Compares your book’s amount with the invoice date rate, and names the payment-date rate when that was used',
    ],
    checkedBy: 'The Verifier recomputes every conversion to the cent from its cited inputs.',
  },
  {
    id: 'limit-keeper',
    name: 'LimitKeeper',
    Icon: Calculator,
    job: 'Keeps the totals and writes the headline.',
    story:
      'No model. It totals verified turnover against the 6M year limit and the 8M twelve-month VAT window, with and without the draft, and says which finding would move the band.',
    model: 'None: rules in code',
    wakes: ['A figure is verified or replaced', 'A reader finishes', 'The draft invoice changes'],
    reads: 'Verified figures only.',
    writes: [
      '6M and 8M totals, headroom and ratio',
      'the headline with unbilled payments',
      'E3: invoice missing from the book',
      'E8: numbering gap',
    ],
    checks: [
      'The card stays Incomplete, with reasons, until every input is verified',
      'A failed reader loop keeps it incomplete',
    ],
    checkedBy: 'The Verifier recomputes each total from the list of figures it names.',
  },
  {
    id: 'independence-checker',
    name: 'IndependenceChecker',
    Icon: Layers,
    job: 'Tests each client against nine criteria.',
    story:
      'Per client: the model judges only the criteria that contract wording can answer, citing the field; code computes the 70% income share over every qualifying twelve months; the rest become questions to you.',
    model: 'One model loop per client contract',
    wakes: [
      'The run starts',
      'Invoice figures change',
      'One of its figures is contested',
      'You answer its question',
    ],
    reads: 'Your client contract fields, verified invoice income and your answers.',
    writes: [
      'each criterion: met, not met or unknown',
      'income share per client',
      'the status per client',
      'questions only you can answer',
    ],
    checks: [
      'A judgement must cite a real contract field with its exact text',
      'An empty field is unknown, never not met',
    ],
    checkedBy: 'The Verifier’s model re-reads each judged criterion against the cited sentence.',
  },
  {
    id: 'verifier',
    name: 'Verifier',
    Icon: ScanSearch,
    job: 'Decides what counts.',
    story:
      'It checks every proposed figure before it may reach the card: the source exists, it is unchanged, derived values recompute, the value matches the line, and it is plausible. Its model sees only the claimed value and the cited excerpt, never the producer’s reasoning.',
    model: 'One model loop per judgement it re-reads (up to six at a time)',
    wakes: [
      'Someone proposes a figure',
      'Two figures conflict',
      'An input settles',
      'You answer its question',
    ],
    reads: 'The claimed value and its sources.',
    writes: [
      'verified or contested, with a reason code',
      'conflict verdicts: E2, E4 and E7 against the book',
      'E9: client country differs',
      'questions after repeated failure',
    ],
    checks: [
      'Reason codes: unsourced, source mismatch, derivation mismatch, not supported by source, implausible',
      'Inside the readers’ loops it refuses a submitted value that has no excerpt',
      'A figure contested three times goes to you instead of looping',
    ],
    checkedBy:
      'Its code checks are deterministic and tested; every verdict is listed on the figure you open.',
  },
];

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

function Agent({ a }: { a: AgentInfo }) {
  const made = data.agents[a.id];
  const loops = data.recorded.loopTimes.filter((l) => l.agentId === a.id).length;
  return (
    <Block
      id={a.id}
      title={
        <span className="flex items-center gap-3">
          <a.Icon size={24} className={a.id === 'verifier' ? 'text-signal' : 'text-muted'} aria-hidden />
          {a.name}
        </span>
      }
      lead={
        <>
          <span className="text-text">{a.job}</span> {a.story}
        </>
      }
    >
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line text-sm">
        {[
          ['Model', a.model],
          ['In the recorded sample', loops ? `${loops} loops` : 'no model loops'],
          ['Figures it put on the board', made ? `${made.verified} verified of ${made.proposed}` : 'none'],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink p-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-1 text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line text-sm md:grid-cols-2">
        <div className="bg-ink p-4">
          <p className="mb-2 text-text">Wakes when</p>
          <List items={a.wakes} />
        </div>
        <div className="bg-ink p-4">
          <p className="mb-2 text-text">Writes</p>
          <List items={a.writes} />
        </div>
        <div className="bg-ink p-4">
          <p className="mb-2 text-text">Rules it holds itself to</p>
          <List items={a.checks} />
        </div>
        <div className="space-y-3 bg-ink p-4">
          <div>
            <p className="mb-2 text-text">Reads</p>
            <p>{a.reads}</p>
          </div>
          <div>
            <p className="mb-2 text-text">Checked by</p>
            <p>{a.checkedBy}</p>
          </div>
        </div>
      </div>
      {made && made.examples.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-text">From the recorded sample</p>
          <ul className="divide-y divide-line rounded-md border border-line text-sm">
            {made.examples.map((e) => (
              <li
                key={e.key}
                className="grid gap-1 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-4"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs break-all">{e.key}</p>
                  <p className="num mt-0.5 break-words text-text">{valueText(e.value)}</p>
                </div>
                <p className="min-w-0 font-mono text-xs break-all">{e.source}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <a
        href={`${REPO_URL}/blob/main/src/agents/${a.id}/agent.ts`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm text-text underline underline-offset-4 hover:text-signal"
      >
        src/agents/{a.id}/agent.ts <ArrowUpRight size={14} aria-hidden />
      </a>
    </Block>
  );
}

const FLOW = [
  ['1', 'You', 'Files and the draft invoice. One event starts the run.'],
  ['2', 'Readers', 'Invoice, statement, book and contract readers claim figures at the same time.'],
  ['3', 'Verifier', 'Checks each claim against its source and settles disagreements.'],
  ['4', 'RateClerk and LimitKeeper', 'Convert and total verified figures, as soon as they arrive.'],
  ['5', 'You', 'A headline, findings, questions only you can answer, and a corrected book.'],
];

export function Agents() {
  const nav = [
    { id: 'team', label: 'How the team works' },
    ...AGENTS.map((a) => ({ id: a.id, label: a.name })),
    { id: 'others', label: 'The other participants' },
    { id: 'mozaik', label: 'What Mozaik does here' },
  ];
  return (
    <div>
      <PageHeader kicker="Seven agents, one board" title="Who does what, and who checks whom.">
        <p>
          Each agent is its own participant on one Mozaik runtime. Nothing calls an agent: it acts when an
          event matches one of its own situations, writes to a shared Figure Board, and the others react.
        </p>
      </PageHeader>
      <WithSideNav items={nav}>
        <Block id="team" title="How the team works">
          <Stats
            items={[
              { value: '7', label: 'agents: five ask a model, two apply rules in code' },
              { value: data.recorded.loops, label: 'agent loops in the recorded sample' },
              { value: data.recorded.maxConcurrentLoops, label: 'loops open at once at the peak' },
              { value: '1', label: 'event from you starts everything' },
            ]}
          />
          <ol className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 xl:grid-cols-5">
            {FLOW.map(([n, who, what]) => (
              <li key={n} className="bg-ink p-4 text-sm sm:last:col-span-2 xl:last:col-span-1">
                <span className="num text-signal">{n}</span>
                <p className="mt-2 text-text">{who}</p>
                <p className="mt-1">{what}</p>
              </li>
            ))}
          </ol>
          <p>
            The arrows are not a pipeline. Verification, conversion and totals start while the readers are
            still reading. See it measured on the{' '}
            <Link to="/proof" className="text-text underline underline-offset-4 hover:text-signal">
              Proof page
            </Link>
            .
          </p>
        </Block>

        {AGENTS.map((a) => (
          <Agent key={a.id} a={a} />
        ))}

        <Block id="others" title="The other participants">
          <Cards
            cols={2}
            items={[
              {
                title: 'Human (you)',
                body: 'Posts the invoice you are about to send, answers questions and changes the draft. An answer re-opens the run and only the dependent agents recompute.',
              },
              {
                title: 'Transcript',
                body: 'The only participant that hears every event. It records the run for the screen, the report and replays. It writes no figures.',
              },
            ]}
          />
        </Block>

        <Block id="mozaik" title="What Mozaik does here">
          <Table
            caption="Mozaik features and where they are used"
            head={['Mozaik', 'What it does in Headroom', 'Code']}
            rows={[
              [
                'createAgent, createHuman, join',
                'Every participant above; each model agent holds its prompt as its Mozaik instruction',
                'src/agents/*/agent.ts',
              ],
              [
                'SituationSpecification',
                'All routing, for example “a figure of mine was contested”',
                'src/agents/situations.ts',
              ],
              [
                'RuntimeState',
                'The Figure Board is the runtime state every participant reads and writes',
                'src/runtime/state.ts',
              ],
              [
                'SemanticEvent',
                'Agents talk only through events: proposed, contested, verified, questions',
                'src/runtime/mozaik/runtime.ts',
              ],
              ['runLoop', 'Every model request, with a fresh context', 'src/runtime/mozaik/runtime.ts'],
              [
                'InterceptionHandler',
                'The Verifier’s gate inside the readers’ loops',
                'src/agents/verifier/gate.ts',
              ],
              [
                'InferenceRunner',
                'Timeouts, retries, rate-limit pacing, recording and replay',
                'src/engine/recordings.ts',
              ],
            ]}
          />
        </Block>
      </WithSideNav>
    </div>
  );
}
