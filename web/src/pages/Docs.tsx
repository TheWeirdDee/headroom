// Docs: how to run Headroom, what it needs, how a run works and what it cannot do. Everything here is also in
// the README; model names and the Mozaik version come from the server.
import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from '../state/app.ts';
import { REPO_URL } from '../components/Layout.tsx';

const TOC: Array<{ id: string; label: string }> = [
  { id: 'quick-start', label: 'Quick start' },
  { id: 'try-offline', label: 'Try it offline' },
  { id: 'files', label: 'Your files' },
  { id: 'models', label: 'Models and keys' },
  { id: 'a-run', label: 'What happens in a run' },
  { id: 'verification', label: 'How numbers are checked' },
  { id: 'outputs', label: 'Exports' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'limits', label: 'Limits' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-line bg-ink p-4 font-mono text-sm leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-line pt-10">
      <h2 id={`${id}-h`} className="font-serif text-3xl tracking-tight">
        {title}
      </h2>
      <div className="mt-4 space-y-4 leading-relaxed text-muted [&_strong]:text-text">{children}</div>
    </section>
  );
}

export function Docs() {
  const health = useApp((s) => s.health);
  return (
    <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-12 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="text-xs font-medium tracking-[0.14em] text-accent uppercase">Docs</p>
        <nav aria-label="On this page" className="mt-4">
          <ul className="space-y-1 text-sm">
            {TOC.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/docs#${t.id}`}
                  className="block rounded px-2 py-1 text-muted hover:bg-panel hover:text-text"
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-1 px-2 text-sm text-accent hover:underline"
        >
          Source on GitHub <ExternalLink size={12} aria-hidden />
        </a>
      </aside>

      <article className="max-w-3xl space-y-10">
        <header>
          <h1 className="text-5xl tracking-tight">Using Headroom</h1>
          <p className="mt-4 text-lg text-muted">
            Headroom runs on your own computer. It reads your bank statement, invoices and KPO book, checks
            every figure against its source, and shows the room left under the 6M paušal limit before you send
            an invoice. Not financial or tax advice.
          </p>
        </header>

        <Section id="quick-start" title="Quick start">
          <p>
            You need <strong>Node 22</strong> and a model key. The default model is Google Gemini, which has a
            free key at aistudio.google.com.
          </p>
          <Code>{`git clone ${REPO_URL}.git
cd headroom
npm run setup
cp .env.example .env      # put your key in GEMINI_API_KEY
npm start                 # then open http://localhost:4317`}</Code>
          <p>
            Click <strong>Check my invoice</strong>, add your files, map the columns if asked, fill in the
            invoice you are about to send, and start the check. Tested on Linux and Windows; macOS is not
            tested yet.
          </p>
        </Section>

        <Section id="try-offline" title="Try it offline">
          <p>
            No key and no network: the bundled sample replays a real recorded run. It is real Mozaik execution
            with the recorded model answers, not a video. If anything was not recorded, it stops with
            REPLAY_MISS rather than invent an answer.
          </p>
          <Code>{`npm run start:offline              # finishes in seconds
npm run start:offline -- --speed 4 # recorded model latencies, four times faster`}</Code>
        </Section>

        <Section id="files" title="Your files">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Bank statement (CSV).</strong> Any bank. Semicolon, comma or tab separated, Windows-1250
              or UTF-8, with or without a preamble. If Headroom does not recognise the columns, a mapper asks
              you once which column is the date, the amount (or credit and debit), the currency and the
              description.
            </li>
            <li>
              <strong>Invoice PDFs.</strong> PDFs with a text layer. Scanned images are listed as unreadable
              (there is no OCR).
            </li>
            <li>
              <strong>KPO book (CSV).</strong> Your existing book. Headroom compares it with the invoices and
              gives you a corrected copy.
            </li>
            <li>
              <strong>Clients and the draft invoice.</strong> Entered on the intake page (name, country,
              business or not) or added as a client details file, plus the invoice you are about to send.
            </li>
          </ul>
        </Section>

        <Section id="models" title="Models and keys">
          <p>
            Set the model in <code className="font-mono text-text">.env</code> with{' '}
            <code className="font-mono text-text">HEADROOM_MODEL_READER</code> and{' '}
            <code className="font-mono text-text">HEADROOM_MODEL_VERIFIER</code>, plus that provider&apos;s
            key.
            {health && (
              <>
                {' '}
                This server uses <strong>{health.models.reader}</strong>.
              </>
            )}
          </p>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-panel text-text">
                <tr>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Example model</th>
                  <th className="px-4 py-2 font-medium">Key</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[
                  ['Google (default)', 'gemini-3.5-flash-lite', 'GEMINI_API_KEY'],
                  ['Groq', 'groq/openai/gpt-oss-120b', 'GROQ_API_KEY'],
                  ['Anthropic', 'claude-sonnet-5-5', 'ANTHROPIC_API_KEY'],
                  ['OpenAI', 'gpt-5.4-mini', 'OPENAI_API_KEY'],
                  ['DeepSeek', 'deepseek-v4-flash', 'DEEPSEEK_API_KEY'],
                ].map(([p, m, k]) => (
                  <tr key={p}>
                    <td className="px-4 py-2">{p}</td>
                    <td className="px-4 py-2 font-mono">{m}</td>
                    <td className="px-4 py-2 font-mono">{k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Requests are paced so a free tier slows a run down instead of failing it (10 a minute for Gemini,
            8 for Groq; change it with <code className="font-mono text-text">HEADROOM_MAX_RPM</code>). Rate
            limits are waited out; a used-up daily quota stops the run with a clear message.
          </p>
        </Section>

        <Section id="a-run" title="What happens in a run">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Seven agents start at once on one Mozaik runtime, each in its own lane with a plain status line.
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
            <li>
              The LimitKeeper totals verified turnover for the 6M limit and the 8M VAT window, with and
              without the draft.
            </li>
            <li>
              Questions only you can answer (for example some independence criteria) come to you; answering
              re-opens the run and the dependent agents recompute.
            </li>
          </ol>
        </Section>

        <Section id="verification" title="How numbers are checked">
          <p>
            Every figure carries its sources: a document line with its excerpt and hash, a statement or KPO
            row, an NBS rate response, a rule, or the figures it was computed from. Before a figure counts,
            the Verifier checks that the source exists and is unchanged, that computed values recompute
            exactly, and that the value matches the source. Code checks dates, amounts, currencies and invoice
            numbers; a model only judges country, kind of supply and contract wording.
          </p>
          <p>
            A figure that fails is contested and read again, at most twice; then the question comes to you.
            Only verified figures reach the headroom card. Click any number to open its sources.
          </p>
        </Section>

        <Section id="outputs" title="Exports">
          <p>
            The KPO tab shows your corrected KPO book in the official layout with a correction log. Export it
            as CSV (English or Serbian headings) or PDF, plus a JSON run report with every figure and its
            sources.
          </p>
        </Section>

        <Section id="privacy" title="Privacy">
          <p>
            Uploaded files stay in <code className="font-mono text-text">uploads/</code> on your computer;{' '}
            <strong>Delete my files</strong> removes them. In a live check, the extracted text of invoices,
            statement rows and KPO rows is sent to the model provider to be read. NBS rates come from the
            public Kurs API, which receives only a currency and a date. Runs on your own files are never
            recorded.
          </p>
        </Section>

        <Section id="limits" title="Limits">
          <p>
            Headroom runs on a rules table sourced from public Serbian guidance; rules marked as assumptions
            still need an accountant&apos;s confirmation, and it does not calculate tax owed. No OCR, no SEF
            e-invoicing, no credit notes or advances, and no special VAT place-of-supply cases.{' '}
            <Link to="/about" className="text-accent hover:underline">
              Every rule and its source
            </Link>
            .
          </p>
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>&quot;No model key&quot;:</strong> add the key for your model to{' '}
              <code className="font-mono text-text">.env</code> and restart. Without one, only the recorded
              samples run.
            </li>
            <li>
              <strong>A run is slow:</strong> free tiers allow few requests a minute, so loops wait their
              turn. That is expected; the run continues.
            </li>
            <li>
              <strong>&quot;Daily quota used up&quot;:</strong> the provider&apos;s free daily limit is
              reached. Try again after it resets, or set another model.
            </li>
            <li>
              <strong>A PDF is listed as unreadable:</strong> it has no text layer (a scan). Export the
              invoice as a PDF from your invoicing tool instead.
            </li>
          </ul>
        </Section>
      </article>
    </div>
  );
}
