// The front door: the problem, the promise, and the real product. The card, findings and timeline below are
// the run screen's own components fed by a replay of the committed real-model recording (GET /api/showcase);
// the headline figures are that recording's own summary. Every rule quoted here comes from the rules table.
import { Link } from 'react-router';
import {
  ArrowRight,
  BookOpenCheck,
  Calculator,
  ChevronDown,
  ExternalLink,
  FileCheck2,
  FileSearch,
  Files,
  Landmark,
  Laptop,
  Layers,
  PlayCircle,
  ReceiptText,
  Scale,
  ScanSearch,
  Send,
  ShieldCheck,
  Users,
  XCircle,
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

function Cited({ rule, quote, gloss }: { rule: Rule | undefined; quote?: boolean; gloss?: string }) {
  if (!rule) return null;
  const src = quote ? (rule.sources.find((s) => s.quote) ?? rule.sources[0]) : rule.sources[0];
  return (
    <figure className="space-y-3">
      <blockquote className="text-lg leading-relaxed text-text">
        {quote && src?.quote ? <span lang="sr">"{src.quote}"</span> : rule.statement_en}
      </blockquote>
      {quote && src?.quote && gloss && <p className="text-sm text-muted">{gloss}</p>}
      {src && (
        <figcaption className="text-xs text-muted">
          <a
            href={src.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-text"
          >
            {src.title}
            {src.locator ? `, ${src.locator}` : ''}
            <ExternalLink size={12} aria-hidden />
          </a>
        </figcaption>
      )}
    </figure>
  );
}

function SectionHead({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-medium tracking-[0.14em] text-accent uppercase">{kicker}</p>
      <h2 id={id} className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
        {title}
      </h2>
      {children && <p className="mt-4 text-muted">{children}</p>}
    </div>
  );
}

function Stats({ r }: { r: RecordedRun }) {
  const ratio = r.wallTimeMs > 0 ? formatSr(String((r.sumLoopTimeMs / r.wallTimeMs).toFixed(1)), 1) : '';
  const items = [
    { value: formatSr(String(r.verified), 0), label: 'figures verified against their source' },
    { value: formatSr(String(r.unsourcedFigures), 0), label: 'figures shown without a source' },
    { value: formatSr(String(r.maxConcurrentLoops), 0), label: 'agent loops running at once (peak)' },
    ...(r.agentConflicts !== null
      ? [
          {
            value: formatSr(String(r.agentConflicts), 0),
            label: 'conflicts between two agents, settled by the source',
          },
        ]
      : []),
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="bg-panel px-5 py-4">
            <dt className="text-xs text-muted">{i.label}</dt>
            <dd className="num mt-1 text-2xl font-semibold">{i.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">
        From the recorded run of the synthetic sample p07 with {r.models.reader}:{' '}
        {formatSr(String(r.loops), 0)} loops,{' '}
        {r.failedLoops === 0 ? 'none failed' : `${r.failedLoops} failed`}
        {ratio ? `, ${ratio} loops' worth of work in flight on average` : ''}.
      </p>
    </div>
  );
}

const STEPS = [
  {
    Icon: Files,
    title: 'Add your files',
    text: 'Your bank statement CSV, invoice PDFs, your KPO book and the invoice you are about to send. Any bank layout: columns it does not recognise, you map once.',
  },
  {
    Icon: Users,
    title: 'Seven agents work at once',
    text: 'Readers, a rate clerk, a limit keeper and an independence checker run in parallel on one shared board. Where two of them claim the same fact, a disagreement is a real conflict.',
  },
  {
    Icon: ShieldCheck,
    title: 'Only checked numbers count',
    text: 'A separate Verifier re-derives every figure from its cited line before it reaches the card. Click any number to see the invoice line, statement row or NBS rate behind it.',
  },
];

const AGENTS = [
  {
    Icon: ReceiptText,
    name: 'InvoiceReader',
    job: 'Reads each invoice PDF: number, dates, amount, currency, client and kind, each with its line.',
  },
  {
    Icon: Landmark,
    name: 'StatementReader',
    job: 'Classifies incoming bank rows and links payments to invoices; finds money with no invoice.',
  },
  {
    Icon: BookOpenCheck,
    name: 'KpoReader',
    job: 'Reads your own KPO book and claims each row against the invoices.',
  },
  {
    Icon: Scale,
    name: 'RateClerk',
    job: 'Fetches the NBS middle rate for each foreign invoice date and converts to RSD.',
  },
  {
    Icon: Calculator,
    name: 'LimitKeeper',
    job: 'Totals verified turnover for the 6M limit and the 8M VAT window, and says which finding moves the band.',
  },
  {
    Icon: Layers,
    name: 'IndependenceChecker',
    job: 'Checks the nine independence criteria per client, including the income share of criterion 6.',
  },
  {
    Icon: ScanSearch,
    name: 'Verifier',
    job: 'Checks every figure against its source before it counts; contests what does not match.',
  },
];

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: 'Is this tax advice?',
    a: 'No. Headroom shows calculations from the documents you give it, with their sources. It does not tell you what tax you owe or what to do. Rules marked as assumptions still need an accountant to confirm them.',
  },
  {
    q: 'What files do I need?',
    a: 'A bank statement export (CSV), your invoice PDFs (with a text layer, not scans), your KPO book (CSV) and the details of the invoice you are about to send. Clients are filled in on the intake page.',
  },
  {
    q: 'Where does my data go?',
    a: 'Your files stay on your computer. When you run a live check, the extracted text of invoices, statement rows and KPO rows is sent to the model provider to be read. Rates come from the public Kurs API, which only sees a currency and a date. Arithmetic, rules and totals run locally.',
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
    a: 'Because the same fact is stated in more than one place. The invoice, the bank and your book each say something about an invoice; separate readers claim those facts independently, so a mismatch shows up as a conflict that the source document settles, instead of being smoothed over.',
  },
  {
    q: 'Can I try it without my own files?',
    a: 'Yes. "Try with sample data" replays a real recorded run of a synthetic entrepreneur with planted mistakes. No key and no network are needed for that.',
  },
  {
    q: 'What does it not do?',
    a: 'No OCR for scanned PDFs, no SEF e-invoicing, no credit notes or advances, no special VAT place-of-supply cases, and no tax amounts.',
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
    <button
      type="button"
      disabled={busy}
      onClick={() => start(SHOWCASE)}
      className="inline-flex items-center gap-2 rounded-md border border-line bg-panel px-5 py-3 font-medium transition-colors hover:border-accent/60 disabled:opacity-60"
    >
      <PlayCircle size={18} aria-hidden /> {busy ? 'Starting...' : label}
    </button>
  );

  return (
    <div>
      {/* Hero */}
      <section className="grid-lines relative border-b border-line" aria-labelledby="hero">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-16 md:py-24 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
              <span className="pulse-dot size-1.5 rounded-full bg-accent" aria-hidden />
              For Serbian flat-rate entrepreneurs (paušalci)
            </p>
            <h1 id="hero" className="mt-6 text-4xl leading-[1.08] font-semibold tracking-tight md:text-6xl">
              Before you send an invoice, see how much room is left under the 6M limit.
              <span className="text-accent"> Every number proven.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">
              Headroom reads your bank statement, invoices and KPO book, finds what does not match, and shows
              the room left under the {limit} limit, the {vat} VAT threshold and the independence test. Each
              figure links to the line it came from.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/check"
                className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 font-medium text-ink transition-colors hover:bg-accent-strong"
              >
                <FileCheck2 size={18} aria-hidden /> Check my invoice
              </Link>
              {sampleButton('Try with sample data')}
            </div>
            <p className="mt-3 text-sm text-muted">
              {offline || needsKey
                ? 'The sample runs as a recorded run: real agents on Mozaik, with the model answers played back. No key needed.'
                : 'The sample is synthetic: an invented entrepreneur with planted mistakes.'}
            </p>
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
          </Reveal>
          {showcase.runId && (
            <Reveal delay={120}>
              <aside aria-label="Headroom card from the recorded sample run" className="lg:sticky lg:top-24">
                <ShowcaseCard runId={showcase.runId} />
              </aside>
            </Reveal>
          )}
          {showcase.error && <p className="text-sm text-muted">{showcase.error}</p>}
        </div>
        {showcase.recorded && (
          <div className="mx-auto max-w-[1200px] px-4 pb-14">
            <Reveal>
              <Stats r={showcase.recorded} />
            </Reveal>
          </div>
        )}
      </section>

      <div className="mx-auto max-w-[1200px] px-4">
        {/* Problem */}
        <section className="py-20" aria-labelledby="problem">
          <Reveal>
            <SectionHead
              id="problem"
              kicker="The problem"
              title="A limit that has not moved since 2013, and money your invoice app cannot see"
            >
              Invoice apps only know the invoices you issued inside them. A payment that landed without an
              invoice, or a euro invoice converted at the wrong rate, stays invisible until the year is over.
            </SectionHead>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <Reveal className="rounded-lg border border-line bg-panel p-6">
              <h3 className="mb-4 text-sm font-medium text-muted">The limit has not moved</h3>
              <Cited
                rule={rule('R-LIMIT-6M')}
                quote
                gloss="In English: the key limit for staying in the flat-rate system, annual turnover of six million dinars, has not changed since 2013."
              />
            </Reveal>
            <Reveal className="rounded-lg border border-line bg-panel p-6" delay={100}>
              <h3 className="mb-4 text-sm font-medium text-muted">What crossing it means</h3>
              <Cited rule={rule('R-LIMIT-6M-CONSEQUENCE')} />
            </Reveal>
          </div>
          {!rules && <p className="mt-4 text-sm text-muted">Loading the rules and their sources...</p>}
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-line py-20" aria-labelledby="how-title">
          <Reveal>
            <SectionHead
              id="how-title"
              kicker="How it works"
              title="From your files to a checked answer in three steps"
            />
          </Reveal>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal
                key={s.title}
                delay={i * 100}
                className="relative rounded-lg border border-line bg-panel p-6"
              >
                <li className="list-none">
                  <span className="num absolute top-5 right-6 text-5xl font-semibold text-line" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="grid size-10 place-items-center rounded-md bg-accent/10 text-accent">
                    <s.Icon size={20} aria-hidden />
                  </span>
                  <p className="mt-5 text-lg font-medium">{s.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* Agents */}
        <section id="agents" className="border-t border-line py-20" aria-labelledby="agents-title">
          <Reveal>
            <SectionHead
              id="agents-title"
              kicker="Seven agents, one board"
              title="They run together, and they check each other"
            >
              Each agent is a participant on one Mozaik runtime with its own loops. They write to a shared
              Figure Board; the Verifier decides what counts.
            </SectionHead>
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AGENTS.map((a, i) => (
              <Reveal
                key={a.name}
                delay={(i % 4) * 80}
                className={`rounded-lg border p-5 ${a.name === 'Verifier' ? 'border-accent/50 bg-accent/5 lg:col-span-2' : 'border-line bg-panel'}`}
              >
                <a.Icon size={20} className="text-accent" aria-hidden />
                <p className="mt-4 font-medium">{a.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{a.job}</p>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="mt-8 rounded-lg border border-line bg-panel px-5 py-4 text-sm">
              <span className="font-medium">Who decides what. </span>
              <span className="text-muted">{health?.authorityBoundary}</span>
            </p>
          </Reveal>
        </section>

        {/* Proof */}
        {showcase.runId && (
          <section id="proof" className="border-t border-line py-20" aria-labelledby="proof-title">
            <Reveal>
              <SectionHead
                id="proof-title"
                kicker="See the proof"
                title="What the agents found in the sample"
              >
                Every finding carries the figures behind it. Open one to follow it back to the statement row,
                invoice line or NBS rate it came from. The sample entrepreneur and the mistakes are invented.
              </SectionHead>
            </Reveal>
            <Reveal className="mt-10">
              <ShowcaseProof runId={showcase.runId} />
            </Reveal>
            <Reveal className="mt-10">
              <h3 className="mb-3 text-sm font-medium text-muted">
                Every agent loop of that run, on one timeline: bars that overlap ran at the same time.
              </h3>
              {showcase.recorded && <ShowcaseTimeline recorded={showcase.recorded} />}
            </Reveal>
          </section>
        )}

        {/* Data */}
        <section id="data" className="border-t border-line py-20" aria-labelledby="data-title">
          <Reveal>
            <SectionHead id="data-title" kicker="Your data" title="Your files stay on your computer" />
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <Reveal className="rounded-lg border border-line bg-panel p-6">
              <Laptop size={20} className="text-accent" aria-hidden />
              <p className="mt-4 font-medium">Stays local</p>
              <p className="mt-2 text-sm text-muted">
                Your uploaded files, every total, every rule check and the corrected KPO book. Delete my files
                removes the upload and its run.
              </p>
            </Reveal>
            <Reveal className="rounded-lg border border-line bg-panel p-6" delay={100}>
              <Send size={20} className="text-accent" aria-hidden />
              <p className="mt-4 font-medium">Sent to be read</p>
              <p className="mt-2 text-sm text-muted">
                In a live check, the extracted text of invoices, statement rows and KPO rows goes to the model
                provider ({health?.models.reader ?? 'the configured model'}). The Kurs API sees only a
                currency and a date.
              </p>
            </Reveal>
            <Reveal className="rounded-lg border border-line bg-panel p-6" delay={200}>
              <FileSearch size={20} className="text-accent" aria-hidden />
              <p className="mt-4 font-medium">Samples are synthetic</p>
              <p className="mt-2 text-sm text-muted">
                The bundled profiles are invented people with planted mistakes. Runs on your own files are
                never recorded.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Limits */}
        <section id="limits" className="border-t border-line py-20" aria-labelledby="limits-title">
          <div className="grid gap-10 md:grid-cols-[1fr_1.2fr]">
            <Reveal>
              <SectionHead id="limits-title" kicker="Honest limits" title="What Headroom does not do">
                It runs on a rules table sourced from public Serbian guidance; rules marked as assumptions
                still need an accountant&apos;s confirmation, and it does not calculate tax owed.
              </SectionHead>
            </Reveal>
            <Reveal>
              <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
                {[
                  'No OCR: scanned PDFs without a text layer are listed as unreadable.',
                  'No tax amounts and no advice on what to do.',
                  'No SEF e-invoicing integration.',
                  'Only the products and services split of the KPO book; no credit notes or advances.',
                  'Special VAT place-of-supply cases are not modelled.',
                ].map((t) => (
                  <li key={t} className="flex gap-3 px-5 py-3 text-sm">
                    <XCircle size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-line py-20" aria-labelledby="faq-title">
          <Reveal>
            <SectionHead id="faq-title" kicker="FAQ" title="Questions people ask first" />
          </Reveal>
          <div className="mt-10 divide-y divide-line rounded-lg border border-line bg-panel">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5">
                <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 font-medium">
                  {f.q}
                  <ChevronDown
                    size={18}
                    className="faq-chevron shrink-0 text-muted transition-transform"
                    aria-hidden
                  />
                </summary>
                <p className="pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing call to action */}
        <section className="py-20" aria-labelledby="cta-title">
          <Reveal className="rounded-xl border border-accent/40 bg-accent/5 px-6 py-12 text-center md:px-12">
            <h2 id="cta-title" className="text-3xl font-semibold tracking-tight">
              Know your headroom before you press send
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              Run it on your own files on your computer, or watch the recorded sample first.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                to="/check"
                className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-3 font-medium text-ink transition-colors hover:bg-accent-strong"
              >
                <FileCheck2 size={18} aria-hidden /> Check my invoice
              </Link>
              {sampleButton('Watch the sample run')}
              <Link
                to="/docs"
                className="inline-flex items-center gap-2 rounded-md px-5 py-3 font-medium text-muted hover:text-text"
              >
                Read the docs <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
            <p className="mt-6 text-xs text-muted">
              Open source:{' '}
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline hover:text-text">
                {REPO_URL.replace('https://', '')}
              </a>
            </p>
          </Reveal>
        </section>
      </div>
    </div>
  );
}
