// The front door. The card, findings and timeline are the run screen's own components showing the committed
// real-model recording (live from the server, or a bundled snapshot of it when no server answers); the
// headline figures are that recording's own summary; every rule quoted comes from the rules table.
import { Link } from 'react-router';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Calculator,
  Check,
  FileCheck2,
  Landmark,
  Layers,
  Minus,
  PlayCircle,
  Plus,
  ReceiptText,
  Scale,
  ScanSearch,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useApp } from '../state/app.ts';
import { useStartSample } from '../state/useStartSample.ts';
import type { Rule } from '../api/types.ts';
import { formatSr, ruleRsd } from '../format/money.ts';
import {
  ShowcaseCard,
  ShowcaseProof,
  ShowcaseTimeline,
  useShowcaseRun,
  type RecordedRun,
} from '../components/Showcase.tsx';
import { Reveal } from '../components/Reveal.tsx';
import { REPO_URL } from '../components/Layout.tsx';

const SHOWCASE = 'p07';

const btnPrimary =
  'inline-flex items-center gap-2 rounded-full bg-text px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-accent-strong';
const btnSecondary =
  'inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-medium transition-colors hover:border-muted hover:bg-panel disabled:opacity-60';

function Cited({ rule, quote, gloss }: { rule: Rule | undefined; quote?: boolean; gloss?: string }) {
  if (!rule) return null;
  const src = quote ? (rule.sources.find((s) => s.quote) ?? rule.sources[0]) : rule.sources[0];
  return (
    <figure>
      <blockquote className="font-serif text-2xl leading-snug md:text-[1.75rem]">
        {quote && src?.quote ? <span lang="sr">&ldquo;{src.quote}&rdquo;</span> : rule.statement_en}
      </blockquote>
      {quote && src?.quote && gloss && <p className="mt-3 text-sm text-muted">{gloss}</p>}
      {src && (
        <figcaption className="mt-4 text-xs text-muted">
          <a
            href={src.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline decoration-line underline-offset-4 hover:text-text"
          >
            {src.title}
            {src.locator ? `, ${src.locator}` : ''}
            <ArrowUpRight size={12} aria-hidden />
          </a>
        </figcaption>
      )}
    </figure>
  );
}

function Kicker({ n, children }: { n: string; children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 font-mono text-xs tracking-wide text-muted uppercase">
      <span className="text-signal">{n}</span>
      <span className="h-px w-8 bg-line" aria-hidden />
      {children}
    </p>
  );
}

function SectionHead({
  id,
  n,
  kicker,
  title,
  children,
}: {
  id: string;
  n: string;
  kicker: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-3xl">
      <Kicker n={n}>{kicker}</Kicker>
      <h2 id={id} className="mt-5 font-serif text-4xl leading-[1.05] tracking-tight md:text-5xl">
        {title}
      </h2>
      {children && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{children}</p>}
    </div>
  );
}

function Stats({ r }: { r: RecordedRun }) {
  const items = [
    { value: formatSr(String(r.verified), 0), label: 'figures checked against their source' },
    { value: formatSr(String(r.unsourcedFigures), 0), label: 'numbers shown without a source' },
    { value: formatSr(String(r.maxConcurrentLoops), 0), label: 'agent loops running at once' },
    ...(r.agentConflicts !== null
      ? [{ value: formatSr(String(r.agentConflicts), 0), label: 'disagreements between agents, settled' }]
      : []),
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 border-y border-line md:grid-cols-4">
        {items.map((i, k) => (
          <div key={i.label} className={`px-1 py-6 md:px-6 ${k > 0 ? 'md:border-l md:border-line' : ''}`}>
            <dd className="num text-4xl font-medium tracking-tight">{i.value}</dd>
            <dt className="mt-2 text-sm text-muted">{i.label}</dt>
          </div>
        ))}
      </dl>
      <p className="mt-3 font-mono text-[11px] text-muted">
        Recorded run of synthetic sample p07, {r.models.reader}: {r.loops} loops,{' '}
        {r.failedLoops === 0 ? 'none failed' : `${r.failedLoops} failed`}.
      </p>
    </div>
  );
}

const STEPS = [
  {
    title: 'Bring your files',
    text: 'Bank statement CSV from any bank, your invoice PDFs, your KPO book, and the invoice you are about to send. Columns it does not recognise, you map once.',
  },
  {
    title: 'Seven agents read at once',
    text: 'Invoices, bank rows and your own book are read in parallel by separate agents. Where two of them state the same fact differently, the source document settles it.',
  },
  {
    title: 'Only checked numbers count',
    text: 'A Verifier re-derives every figure from the line it cites before it reaches your card. Click any number to see the invoice line, bank row or NBS rate behind it.',
  },
];

const AGENTS = [
  {
    Icon: ReceiptText,
    name: 'InvoiceReader',
    job: 'Reads each invoice PDF',
    writes: 'number, dates, amount, currency, client, kind',
  },
  {
    Icon: Landmark,
    name: 'StatementReader',
    job: 'Classifies incoming bank rows',
    writes: 'payments, invoice links, money with no invoice',
  },
  {
    Icon: BookOpenCheck,
    name: 'KpoReader',
    job: 'Reads your existing KPO book',
    writes: 'each row, claimed against the invoices',
  },
  {
    Icon: Scale,
    name: 'RateClerk',
    job: 'Fetches official NBS middle rates',
    writes: 'rate per invoice date, amount in RSD',
  },
  {
    Icon: Calculator,
    name: 'LimitKeeper',
    job: 'Keeps the running totals',
    writes: '6M and 8M totals, which finding moves the band',
  },
  {
    Icon: Layers,
    name: 'IndependenceChecker',
    job: 'Tests each client against nine criteria',
    writes: 'criteria, income share (criterion 6)',
  },
  {
    Icon: ScanSearch,
    name: 'Verifier',
    job: 'Checks every figure before it counts',
    writes: 'verified, contested, or a question for you',
  },
];

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'Is this tax advice?',
    a: 'No. Headroom shows calculations from the documents you give it, with their sources. It does not tell you what tax you owe or what to do. Rules marked as assumptions still need an accountant to confirm them.',
  },
  {
    q: 'What files do I need?',
    a: 'A bank statement export (CSV), your invoice PDFs (with a text layer, not scans), your KPO book (CSV) and the details of the invoice you are about to send. Clients are entered on the intake page or added as a file.',
  },
  {
    q: 'Where does my data go?',
    a: 'Your files stay on your computer. In a live check, the extracted text of invoices, statement rows and KPO rows is sent to the model provider to be read. Rates come from the public Kurs API, which only sees a currency and a date. Arithmetic, rules and totals run locally.',
  },
  {
    q: 'Which AI model does it use?',
    a: 'Google Gemini (gemini-3.5-flash-lite) by default, because it has a free tier. Claude, GPT, DeepSeek and Groq models work too, with that provider’s key. Models only read text; code does every calculation.',
  },
  {
    q: 'What if a model misreads something?',
    a: 'The Verifier compares each figure with the line it cites, and code checks dates, amounts, currencies and invoice numbers exactly. A figure that does not match is contested and read again; after that, the question comes to you. Nothing unchecked reaches the card.',
  },
  {
    q: 'Why seven agents and not one?',
    a: 'Because the same fact is stated in more than one place. The invoice, the bank and your book each say something about an invoice; separate readers claim those facts independently, so a mismatch shows up as a disagreement the source document settles, instead of being smoothed over.',
  },
  {
    q: 'Can I try it without my own files?',
    a: '“Try with sample data” replays a real recorded run of a synthetic entrepreneur with planted mistakes. No key and no network are needed for that.',
  },
];

export function Landing() {
  const rules = useApp((s) => s.rules);
  const health = useApp((s) => s.health);
  const { start, busy, error, needsKey } = useStartSample();
  const rule = (id: string): Rule | undefined => rules?.find((r) => r.id === id);
  const offline = health?.mode === 'offline';
  const limit = ruleRsd(rules, 'R-LIMIT-6M', 'limitRSD') ?? '6M';
  const vat = ruleRsd(rules, 'R-VAT-8M', 'thresholdRSD') ?? '8M';
  const showcase = useShowcaseRun();

  const sampleButton = (label: string) => (
    <button type="button" disabled={busy || !health} onClick={() => start(SHOWCASE)} className={btnSecondary}>
      <PlayCircle size={16} aria-hidden /> {busy ? 'Starting...' : label}
    </button>
  );

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-line" aria-labelledby="hero">
        <div
          className="grid-lines pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-[1200px] gap-14 px-4 pt-16 pb-12 md:pt-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/60 px-3 py-1 font-mono text-[11px] tracking-wide text-muted uppercase">
              <span className="pulse-dot size-1.5 rounded-full bg-signal" aria-hidden />
              For Serbian flat-rate entrepreneurs
            </p>
            <h1 id="hero" className="mt-7 font-serif text-[2.6rem] leading-[1.04] md:text-[3.9rem]">
              Before you send an invoice, see how much room is left under the 6M limit.{' '}
              <em className="text-signal">Every number proven.</em>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
              Headroom reads your bank statement, invoices and KPO book, finds what does not match, and shows
              the room left under the <span className="num text-text">{limit}</span> paušal limit, the{' '}
              <span className="num text-text">{vat}</span> VAT threshold and the independence test.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/check" className={btnPrimary}>
                <FileCheck2 size={16} aria-hidden /> Check my invoice
              </Link>
              {sampleButton('Try with sample data')}
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
              {['Runs on your computer', 'Source behind every number', 'Not financial or tax advice'].map(
                (t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check size={12} className="text-signal" aria-hidden /> {t}
                  </li>
                ),
              )}
            </ul>
            {(offline || needsKey) && (
              <p className="mt-4 max-w-xl text-xs text-muted">
                The sample plays a recorded run: real agents on Mozaik, with the model&apos;s answers played
                back.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
          </Reveal>
          <Reveal delay={150}>
            <aside aria-label="Headroom card from the recorded sample run" className="relative">
              <div
                className="absolute -inset-px rounded-2xl bg-gradient-to-b from-line to-transparent"
                aria-hidden
              />
              <div className="relative rounded-2xl bg-ink p-2 shadow-2xl shadow-black/60">
                <ShowcaseCard runId={showcase.runId} />
              </div>
            </aside>
          </Reveal>
        </div>
        <div className="relative mx-auto max-w-[1200px] px-4 pb-16">
          <Reveal>
            <Stats r={showcase.recorded} />
          </Reveal>
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] px-4">
        {/* Problem */}
        <section className="py-16" aria-labelledby="problem">
          <Reveal>
            <SectionHead
              id="problem"
              n="01"
              kicker="The problem"
              title={
                <>
                  A limit frozen since 2013, and money your invoice app <em>cannot see</em>.
                </>
              }
            >
              Invoice apps only know the invoices you issued inside them. A payment that landed without an
              invoice, or a euro invoice converted at the wrong rate, stays invisible until the year is over.
            </SectionHead>
          </Reveal>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
            <Reveal className="bg-ink p-8">
              <p className="mb-5 font-mono text-[11px] tracking-wide text-muted uppercase">
                The limit has not moved
              </p>
              <Cited
                rule={rule('R-LIMIT-6M')}
                quote
                gloss="The key limit for staying in the flat-rate system, annual turnover of six million dinars, has not changed since 2013."
              />
            </Reveal>
            <Reveal className="bg-ink p-8" delay={100}>
              <p className="mb-5 font-mono text-[11px] tracking-wide text-muted uppercase">
                What crossing it means
              </p>
              <Cited rule={rule('R-LIMIT-6M-CONSEQUENCE')} />
            </Reveal>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-line py-16" aria-labelledby="how-title">
          <Reveal>
            <SectionHead
              id="how-title"
              n="02"
              kicker="How it works"
              title="From your files to a checked answer."
            />
          </Reveal>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="bg-ink">
                <Reveal delay={i * 100} className="h-full p-8">
                  <span className="num text-sm text-signal">0{i + 1}</span>
                  <p className="mt-10 font-serif text-2xl">{s.title}</p>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{s.text}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        {/* Agents */}
        <section id="agents" className="border-t border-line py-16" aria-labelledby="agents-title">
          <Reveal>
            <SectionHead
              id="agents-title"
              n="03"
              kicker="Seven agents, one board"
              title={
                <>
                  They run together, and they <em>check each other</em>.
                </>
              }
            >
              Each agent is a participant on one Mozaik runtime with its own loops. They write to a shared
              Figure Board; the Verifier decides what counts.
            </SectionHead>
          </Reveal>
          <Reveal className="mt-10">
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line font-mono text-[11px] tracking-wide text-muted uppercase">
                    <th className="px-5 py-3 font-normal">Agent</th>
                    <th className="px-5 py-3 font-normal">Job</th>
                    <th className="px-5 py-3 font-normal">Writes to the board</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {AGENTS.map((a) => (
                    <tr
                      key={a.name}
                      className={a.name === 'Verifier' ? 'bg-panel' : 'transition-colors hover:bg-panel/60'}
                    >
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-3 font-mono text-[13px]">
                          <a.Icon
                            size={16}
                            className={a.name === 'Verifier' ? 'text-signal' : 'text-muted'}
                            aria-hidden
                          />
                          {a.name}
                        </span>
                      </td>
                      <td className="px-5 py-4">{a.job}</td>
                      <td className="px-5 py-4 text-muted">{a.writes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-6 max-w-3xl font-serif text-xl leading-snug text-muted">
              &ldquo;
              {health?.authorityBoundary ??
                'Models read documents, code does the arithmetic and applies the rules, a second agent checks every figure, and you decide whether to send the invoice.'}
              &rdquo;
            </p>
          </Reveal>
        </section>

        {/* Proof */}
        <section id="proof" className="border-t border-line py-16" aria-labelledby="proof-title">
          <Reveal>
            <SectionHead
              id="proof-title"
              n="04"
              kicker="See the proof"
              title="What the agents found in the sample."
            >
              An invented entrepreneur with planted mistakes. The headline: a payment that arrived with no
              invoice, which takes the year over the line.
            </SectionHead>
          </Reveal>
          <Reveal className="mt-10">
            <ShowcaseProof runId={showcase.runId} />
          </Reveal>
          <Reveal className="mt-12">
            <p className="mb-3 font-mono text-[11px] tracking-wide text-muted uppercase">
              Every agent loop of that run. Overlapping bars ran at the same time.
            </p>
            <ShowcaseTimeline recorded={showcase.recorded} />
          </Reveal>
        </section>

        {/* Data */}
        <section id="data" className="border-t border-line py-16" aria-labelledby="data-title">
          <Reveal>
            <SectionHead
              id="data-title"
              n="05"
              kicker="Your data"
              title="Your files stay on your computer."
            />
          </Reveal>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
            {[
              {
                t: 'Stays local',
                d: 'Your files, every total, every rule check and the corrected KPO book. Delete my files removes the upload and its run.',
              },
              {
                t: 'Sent to be read',
                d: `In a live check, the extracted text of invoices, statement rows and KPO rows goes to the model provider (${health?.models.reader ?? 'the configured model'}). The Kurs API sees only a currency and a date.`,
              },
              {
                t: 'Samples are synthetic',
                d: 'The bundled profiles are invented people with planted mistakes. Runs on your own files are never recorded.',
              },
            ].map((x, i) => (
              <Reveal key={x.t} delay={i * 100} className="bg-ink p-8">
                <p className="font-serif text-2xl">{x.t}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted">{x.d}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Limits */}
        <section id="limits" className="border-t border-line py-16" aria-labelledby="limits-title">
          <div className="grid gap-12 md:grid-cols-[1fr_1.1fr]">
            <Reveal>
              <SectionHead id="limits-title" n="06" kicker="Honest limits" title="What Headroom does not do.">
                A rules table sourced from public Serbian guidance; rules marked as assumptions still need an
                accountant&apos;s confirmation.
              </SectionHead>
            </Reveal>
            <Reveal>
              <ul className="divide-y divide-line border-y border-line">
                {[
                  'Calculate tax owed, or advise what to do',
                  'Read scanned PDFs (no OCR)',
                  'Connect to SEF e-invoicing',
                  'Handle credit notes, advances or special VAT place-of-supply cases',
                ].map((t) => (
                  <li key={t} className="flex items-center gap-4 py-4 text-sm">
                    <Minus size={16} className="shrink-0 text-muted" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-line py-16" aria-labelledby="faq-title">
          <div className="grid gap-12 md:grid-cols-[1fr_1.6fr]">
            <Reveal className="md:sticky md:top-24 md:self-start">
              <SectionHead id="faq-title" n="07" kicker="FAQ" title="Questions people ask first.">
                Anything else is in the docs: setup, file formats, models and keys, and how every number is
                checked.
              </SectionHead>
              <Link
                to="/docs"
                className="mt-6 inline-flex items-center gap-1.5 text-sm underline underline-offset-4 hover:text-signal"
              >
                Read the docs <ArrowRight size={14} aria-hidden />
              </Link>
            </Reveal>
            <Reveal>
              <div className="divide-y divide-line border-y border-line">
                {FAQ.map((f) => (
                  <details key={f.q} className="group">
                    <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 text-base">
                      {f.q}
                      <Plus
                        size={16}
                        className="faq-chevron shrink-0 text-muted transition-transform group-open:rotate-45"
                        aria-hidden
                      />
                    </summary>
                    <p className="pb-6 text-sm leading-relaxed text-muted">{f.a}</p>
                  </details>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="pb-16" aria-labelledby="cta-title">
          <Reveal className="relative overflow-hidden rounded-2xl border border-line px-6 py-16 text-center md:px-12">
            <div className="grid-lines pointer-events-none absolute inset-0 opacity-60" aria-hidden />
            <div className="relative">
              <h2 id="cta-title" className="font-serif text-4xl tracking-tight md:text-5xl">
                Know your headroom <em className="text-signal">before</em> you press send.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted">
                Run it on your own files on your computer, or watch the recorded sample first.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <Link to="/check" className={btnPrimary}>
                  <FileCheck2 size={16} aria-hidden /> Check my invoice
                </Link>
                {sampleButton('Watch the sample run')}
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm text-muted hover:text-text"
                >
                  Read the docs <ArrowRight size={14} aria-hidden />
                </Link>
              </div>
              <p className="mt-8 font-mono text-[11px] text-muted">
                Open source ·{' '}
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-text"
                >
                  {REPO_URL.replace('https://', '')}
                </a>
              </p>
            </div>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
