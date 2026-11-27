// Docs: setting Headroom up, preparing files, reading a result, the settings, the commands and the API.
// Model names and the Mozaik version come from the server; rules and criteria from the rules table.
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { Block, Cards, Code, PageHeader, Table, WithSideNav } from '../components/Doc.tsx';
import { useApp } from '../state/app.ts';
import { REPO_URL } from '../components/Layout.tsx';
import evidence from '../generated/evidence.json';

const TOC: Array<{ id: string; label: string }> = [
  { id: 'quick-start', label: 'Quick start' },
  { id: 'try-offline', label: 'Try it without files' },
  { id: 'own-files', label: 'Check your invoice' },
  { id: 'files', label: 'Your files' },
  { id: 'client-file', label: 'Client file' },
  { id: 'mapper', label: 'Column mapper' },
  { id: 'card', label: 'Reading the card' },
  { id: 'findings', label: 'Findings' },
  { id: 'independence', label: 'Independence test' },
  { id: 'a-run', label: 'What happens in a run' },
  { id: 'verification', label: 'How numbers are checked' },
  { id: 'outputs', label: 'Exports' },
  { id: 'models', label: 'Models and keys' },
  { id: 'settings', label: 'Settings' },
  { id: 'commands', label: 'Commands' },
  { id: 'api', label: 'HTTP API' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'limits', label: 'Limits' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
];

const A = ({ to, children }: { to: string; children: string }) => (
  <Link to={to} className="text-text underline underline-offset-4 hover:text-signal">
    {children}
  </Link>
);
const M = ({ children }: { children: string }) => (
  <code className="font-mono text-[0.9em] break-words text-text">{children}</code>
);

export function Docs() {
  const health = useApp((s) => s.health);
  const rules = useApp((s) => s.rules);
  const criteria =
    (rules?.find((r) => r.id === 'R-INDEP')?.params?.['criteria'] as
      Array<{ n: number; text_en: string; evalMode: string }> | undefined) ?? [];
  const how: Record<string, string> = {
    computed: 'Computed from your invoices',
    contract_field: 'Read from the contract fields',
    user_answer: 'Asked of you',
  };
  return (
    <div>
      <PageHeader kicker="Docs" title="Using Headroom">
        <p>
          Before you send an invoice, Headroom shows how much room is left under the 6M paušal limit and the
          8M VAT threshold, with the source of every number. It runs on your own computer. Not financial or
          tax advice.
        </p>
      </PageHeader>
      <WithSideNav items={TOC}>
        <Block id="quick-start" title="Quick start">
          <p>
            You need <strong>Node 22.12 or later</strong> and, to read your own files, a model key. The
            default model is Google Gemini, which has a free key at aistudio.google.com.
          </p>
          <Code>{`git clone ${REPO_URL}.git
cd headroom
npm run setup
cp .env.example .env      # put your key in GEMINI_API_KEY
npm start                 # then open http://localhost:4317`}</Code>
          <p>Tested on Linux and Windows. macOS is not tested yet.</p>
        </Block>

        <Block id="try-offline" title="Try it without files">
          <p>
            No key and no network: the bundled sample replays a real recorded run. It is real Mozaik execution
            with the recorded model answers, not a video. If anything was not recorded, it stops with
            REPLAY_MISS rather than invent an answer.
          </p>
          <Code>{`npm run start:offline              # then click "Try with sample data"
npm run start:offline -- --speed 4 # recorded request times, four times faster`}</Code>
          <p>In the app, with the sample:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <strong>Try with sample data.</strong> The headline says the total is over the 6M limit once a
              payment with no invoice is invoiced.
            </li>
            <li>Click any number to see the line it came from.</li>
            <li>
              Open <strong>Discrepancies</strong>, then answer the <strong>Questions</strong>.
            </li>
            <li>
              <strong>Change the invoice</strong> and watch the totals recompute.
            </li>
            <li>
              Open the <strong>KPO book</strong> and export it.
            </li>
            <li>
              Back on the home page, <strong>Catch a wrong number</strong> shows the Verifier rejecting an
              injected misread.
            </li>
          </ol>
        </Block>

        <Block id="own-files" title="Check your invoice">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Start Headroom with a key and open <strong>Check my invoice</strong>.
            </li>
            <li>
              <strong>Add your files:</strong> bank statement CSV, invoice PDFs, KPO book CSV, and a client
              file if you have one. You can add them in several goes.
            </li>
            <li>
              <strong>Map columns</strong> if a CSV is marked “Needs mapping”.
            </li>
            <li>
              <strong>About you:</strong> name, PIB, year and the date to check as of.
            </li>
            <li>
              <strong>Your clients</strong> (filled from the client file) and{' '}
              <strong>the invoice you are about to send</strong>.
            </li>
            <li>
              Click <strong>Check this invoice</strong>. On a free tier a year of about a dozen invoices takes
              about 6 minutes; the card says Incomplete until everything is verified.
            </li>
          </ol>
          <p>
            To try this with files that are not yours, add the invoices folder, <M>statement.csv</M>,{' '}
            <M>kpo.csv</M> and <M>clients.json</M> from <M>data/profiles/p01/</M>.
          </p>
        </Block>

        <Block id="files" title="Your files">
          <Table
            caption="Files Headroom reads"
            head={['File', 'Format', 'Needed for']}
            rows={[
              [
                'Bank statement',
                'CSV from any bank: semicolon, comma or tab; UTF-8 or Windows-1250; a preamble is fine',
                'payments, and money with no invoice',
              ],
              [
                'Invoices',
                'PDF with a text layer, one invoice per file; scans are listed as unreadable (no OCR)',
                'turnover, dates, currencies, clients',
              ],
              [
                'KPO book',
                'CSV with date, description, products, services and total columns',
                'comparison with your invoices, and the corrected book',
              ],
              [
                'Client file (optional)',
                'clients.json, see below',
                'filling the client form and the independence test',
              ],
              ['Draft invoice', 'typed on the page', 'the answer before you send'],
            ]}
          />
          <p>A statement and a book that Headroom recognises look like this (from the synthetic sample):</p>
          <Code>{evidence.examples.statement}</Code>
          <Code>{evidence.examples.book}</Code>
        </Block>

        <Block id="client-file" title="Client file">
          <p>
            Optionally add a <M>clients.json</M> to your files. It fills the client form, and its{' '}
            <M>contract</M> fields are the only way contract wording reaches the independence test; without
            them those criteria stay unknown. Each field is a sentence from or about your contract.
          </p>
          <Code>{`[{ "id": "acme", "name": "Acme GmbH", "country": "DE",
   "isBusiness": true, "vatId": "DE123456789",
   "contract": {
     "workingHoursSetByClient": "No: the contractor sets own hours.",
     "workplaceSetByClient": "No: work is done remotely.",
     "trainingByClient": "No: no training by the client.",
     "equipmentOrManagementByClient": "No: own equipment is used.",
     "clientLineOfBusinessWithoutRiskClause": "No: delivery risk is borne.",
     "nonCompeteClause": "No: no restriction on other clients."
   } }]`}</Code>
        </Block>

        <Block id="mapper" title="Column mapper">
          <p>
            When a CSV layout is not recognised, you say once which column is which. Choose whether the file
            is a statement or a book, the decimal mark, the date format, the header line, the separator and
            the encoding. A statement without a currency column needs the account currency. A row that cannot
            be parsed is listed with its line number and left out, never guessed.
          </p>
        </Block>

        <Block id="card" title="Reading the card">
          <Cards
            cols={2}
            items={[
              {
                title: 'Room left',
                body: 'The limit minus verified turnover and this invoice. Past the limit the card shows the excess and says over.',
              },
              {
                title: 'A payment with no invoice',
                body: 'It is not turnover yet, so the headline shows where the total would be once it is invoiced, with the figure on invoices alone below.',
              },
              {
                title: 'Incomplete',
                body: 'Shown, with reasons, until every input is verified. No verdict is given from part of your files.',
              },
              {
                title: 'Colour bands',
                body: 'Below 80% room left, from 80% getting close, from 90% very close, from 100% over the line. These bands are a Headroom convention.',
              },
              {
                title: '8M VAT threshold',
                body: 'Turnover of the last 365 days that counts for VAT: services to foreign business clients do not.',
              },
              {
                title: 'Assumption chips',
                body: 'A rule no official source settles is marked wherever it affects a number.',
              },
            ]}
          />
        </Block>

        <Block id="findings" title="Findings">
          <Table
            caption="Kinds of finding"
            head={['Type', 'What it means', 'Raised by']}
            rows={[
              ['E1', 'Payment received with no matching invoice', 'StatementReader'],
              ['E2', 'KPO book uses a different date than the invoice', 'Verifier, from a conflict'],
              ['E3', 'Issued invoice missing from the KPO book', 'LimitKeeper'],
              ['E4', 'KPO amount differs from the invoice amount in RSD', 'Verifier, from a conflict'],
              ['E5', 'KPO amount uses a rate other than the NBS middle rate', 'RateClerk'],
              ['E6', 'Duplicate KPO row for one invoice', 'KpoReader'],
              ['E7', 'Previous-year invoice counted in this year', 'Verifier, from a conflict'],
              ['E8', 'Gap in invoice numbering (worth checking, not an error)', 'LimitKeeper'],
              ['E9', 'Client country differs between invoice and client details', 'Verifier'],
              ['E-CONFLICT', 'Two sources of equal weight disagree: you decide', 'Verifier'],
              ['E-DOC-UNREADABLE', 'A document could not be read and was left out', 'The reading agents'],
            ]}
          />
        </Block>

        <Block
          id="independence"
          title="Independence test"
          lead="Evaluated per client. Five or more of the nine criteria mean that client’s income may be taxed as other income. Headroom calculates no tax."
        >
          {criteria.length > 0 ? (
            <Table
              caption="The nine criteria"
              head={['No.', 'Criterion', 'How Headroom judges it']}
              rows={criteria.map((c) => [c.n, c.text_en, how[c.evalMode] ?? c.evalMode])}
            />
          ) : (
            <p>The criteria load from the server.</p>
          )}
        </Block>

        <Block id="a-run" title="What happens in a run">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Seven agents join one Mozaik runtime, each with its own lane and a plain status line. One event
              from you starts the run. Nothing calls an agent: each reacts to the events it cares about.
            </li>
            <li>
              Readers propose figures (invoice dates and amounts, payments, KPO rows) to a shared Figure
              Board, each with the line it came from.
            </li>
            <li>
              Where two agents state the same fact differently, that is a conflict, settled by the source: the
              invoice document outranks the KPO row for invoice facts; the bank row outranks the document for
              payments.
            </li>
            <li>The LimitKeeper totals verified turnover, with and without the draft.</li>
            <li>
              Questions only you can answer come to you; answering re-opens the run and the dependent agents
              recompute.
            </li>
            <li>
              The run ends <M>completed</M>, <M>awaiting_user</M>, <M>degraded</M> (something failed or is
              missing) or <M>failed</M>.
            </li>
          </ol>
          <p>
            <A to="/agents">What each agent does</A>
          </p>
        </Block>

        <Block id="verification" title="How numbers are checked">
          <p>
            Every figure carries its sources: a document line with its excerpt and hash, a statement or KPO
            row, an NBS rate response, a contract field, a rule, your answer, or the figures it was computed
            from. Before a figure counts, the Verifier checks that the source exists and is unchanged, that
            computed values recompute exactly, and that the value matches the source. Code checks dates,
            amounts, currencies and invoice numbers; a model only judges country, kind of supply, kind of
            payment and contract wording.
          </p>
          <Table
            caption="Figure statuses"
            head={['Status', 'Meaning']}
            min={420}
            rows={[
              ['proposed', 'On the board, not checked yet'],
              ['verified', 'Passed every check; may reach the card'],
              ['contested', 'Failed a check; read again, at most twice'],
              ['needs_user', 'Still unsettled: a question for you'],
              ['superseded', 'Replaced by a newer or stronger figure; kept in the history'],
            ]}
          />
          <p>
            <A to="/proof#checks">Which check is code and which is a model</A>
          </p>
        </Block>

        <Block id="outputs" title="Exports">
          <Table
            caption="Exports"
            head={['Export', 'Content']}
            min={420}
            rows={[
              [
                'KPO book, CSV',
                'Corrected book in the official columns; decimal point, or decimal comma for Serbian spreadsheets',
              ],
              ['KPO book, PDF', 'The same book with its correction log'],
              ['Corrections, CSV', 'Each change against your book, with the reason'],
              [
                'Report, JSON',
                'Summary, card, findings, questions and every verified figure with its sources',
              ],
            ]}
          />
          <p>An export of an incomplete run says so at the top.</p>
        </Block>

        <Block id="models" title="Models and keys">
          <p>
            Set the model in <M>.env</M> with <M>HEADROOM_MODEL_READER</M> and <M>HEADROOM_MODEL_VERIFIER</M>,
            plus that provider’s key.
            {health && (
              <>
                {' '}
                This server uses <strong>{health.models.reader}</strong>.
              </>
            )}
          </p>
          <Table
            caption="Providers Headroom has been run with"
            head={['Provider', 'Example model', 'Key', 'Default pace']}
            rows={[
              [
                'Google (default)',
                <M key="g">gemini-3.5-flash-lite</M>,
                <M key="gk">GEMINI_API_KEY</M>,
                '14 requests a minute; the free tier allows 15',
              ],
              [
                'Groq',
                <M key="q">groq/openai/gpt-oss-120b</M>,
                <M key="qk">GROQ_API_KEY</M>,
                '8 requests a minute',
              ],
            ]}
          />
          <p>
            Rate limits are waited out. <strong>A free backup:</strong> if the daily quota runs out during a
            check, the rest of it goes to <M>gemini-3.1-flash-lite</M> on the same free Gemini key, and the
            run screen says which backup answered. <M>HEADROOM_MODEL_BACKUP</M> names other backups, comma
            separated (a Groq model there also sends document text to Groq), or <M>none</M>. If every model’s
            quota is used up, the run stops with a clear message. Recordings and evaluations never switch
            models.
          </p>
        </Block>

        <Block id="settings" title="Settings">
          <Table
            caption="Environment settings"
            head={['Variable', 'Default', 'What it does']}
            rows={[
              [<M key="a">PORT</M>, '4317', 'Port of the app'],
              [<M key="b">HOST</M>, '127.0.0.1', 'Address to listen on'],
              [<M key="c">UPLOAD_MAX_MB</M>, '10', 'Largest file accepted'],
              [<M key="d">HEADROOM_MAX_RPM</M>, 'by provider', 'Model requests a minute; 0 turns pacing off'],
              [<M key="e">HEADROOM_MODEL_READER</M>, 'gemini-3.5-flash-lite', 'Model of the reading agents'],
              [<M key="f">HEADROOM_MODEL_VERIFIER</M>, 'gemini-3.5-flash-lite', 'Model of the Verifier'],
              [
                <M key="k">HEADROOM_MODEL_BACKUP</M>,
                'gemini-3.1-flash-lite on Gemini',
                'Models to move to when a daily quota is used up; none turns it off',
              ],
              [
                <M key="g">HEADROOM_PUBLIC_DEMO</M>,
                'off',
                'Read-only sample server: recorded runs only, uploads refused',
              ],
              [<M key="h">HEADROOM_CORS_ORIGINS</M>, 'none', 'Other web origins allowed to call the server'],
            ]}
          />
          <p>
            A Mozaik Cloud key in <M>.env</M> is refused, because Cloud would receive document text.
          </p>
        </Block>

        <Block id="commands" title="Commands">
          <Table
            caption="Commands"
            head={['Command', 'What it does']}
            rows={[
              [<M key="1">npm start</M>, 'The app, with your key'],
              [<M key="2">npm run start:offline</M>, 'The app with recorded samples, no key'],
              [<M key="3">npm test</M>, 'Unit and end to end tests, no key'],
              [<M key="4">npm run test:e2e</M>, 'Browser tests (first: npx playwright install chromium)'],
              [<M key="5">npm run benchmark</M>, 'Concurrent against one model request at a time'],
              [<M key="6">npm run prove</M>, 'Fails unless several agents’ requests overlapped'],
              [<M key="7">npm run demo:catch</M>, 'Fails unless the Verifier rejects the injected misread'],
              [<M key="8">npm run eval -- --mode fake</M>, 'Scores all sample profiles with the test model'],
              [<M key="9">npm run record-demo</M>, 'Records a new live run of a sample'],
            ]}
          />
        </Block>

        <Block
          id="api"
          title="HTTP API"
          lead="What the web app uses. Errors are JSON with a code and a message."
        >
          <Table
            caption="Routes"
            head={['Route', 'Does']}
            rows={[
              [<M key="1">GET /api/health</M>, 'Versions, mode, models'],
              [<M key="2">GET /api/rules</M>, 'The rules table'],
              [<M key="3">GET /api/profiles</M>, 'The sample profiles'],
              [
                <M key="4">POST /api/uploads</M>,
                'Add files; then …/mapping, …/preview, …/details; DELETE removes them',
              ],
              [<M key="5">POST /api/runs</M>, 'Start a run from a sample or an upload'],
              [<M key="6">GET /api/runs/:id</M>, 'Snapshot; …/stream is the live event stream'],
              [<M key="7">GET /api/runs/:id/figures/:figureId</M>, 'A figure with its sources resolved'],
              [<M key="8">POST /api/runs/:id/questions/:qid/answer</M>, 'Answer a question'],
              [<M key="9">POST /api/runs/:id/draft</M>, 'Change the draft invoice'],
              [
                <M key="10">GET /api/runs/:id/export/…</M>,
                'kpo.csv, kpo.pdf, kpo_corrections.csv, report.json',
              ],
            ]}
          />
        </Block>

        <Block id="privacy" title="Privacy">
          <p>
            Uploaded files stay in <M>uploads/</M> on your computer; <strong>Delete my files</strong> removes
            them. In a live check, the extracted text of invoices, statement rows and KPO rows is sent to the
            model provider to be read. NBS rates come from the public Kurs API, which receives only a currency
            and a date. Runs on your own files are never recorded.
          </p>
        </Block>

        <Block id="limits" title="Limits">
          <ul className="list-disc space-y-2 pl-5">
            <li>It does not calculate tax owed or advise what to do, and it files nothing.</li>
            <li>No OCR, no SEF e-invoicing, no credit notes or advances.</li>
            <li>No special VAT place-of-supply cases.</li>
            <li>
              A payment in another currency than its invoice is matched only when the row names the invoice
              number.
            </li>
            <li>Rules marked as assumptions still need an accountant’s confirmation.</li>
          </ul>
          <p>
            <A to="/about">Every rule and its source</A>
          </p>
        </Block>

        <Block id="troubleshooting" title="Troubleshooting">
          <Table
            caption="Troubleshooting"
            head={['You see', 'What to do']}
            rows={[
              [
                'No model key',
                'Add the key for your model to .env and restart. Without one, only the recorded samples run.',
              ],
              [
                'A run is slow',
                'Free tiers allow few requests a minute, so loops wait their turn. The run continues.',
              ],
              [
                'Daily quota used up',
                'Every model in the list reached its free daily limit. Try after it resets, or add a backup.',
              ],
              [
                'A PDF listed as unreadable',
                'It has no text layer (a scan). Export the invoice as a PDF from your invoicing tool.',
              ],
              ['A CSV needs mapping', 'Open the mapper and say which column is which.'],
              [
                'The card stays Incomplete',
                'Its list says why: a failed loop, an unreadable file or an open question.',
              ],
              [
                'The first visit is slow',
                'The free sample server sleeps when idle and takes up to a minute to wake.',
              ],
            ]}
          />
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-text underline underline-offset-4 hover:text-signal"
          >
            Report a problem <ArrowUpRight size={14} aria-hidden />
          </a>
        </Block>
      </WithSideNav>
    </div>
  );
}
