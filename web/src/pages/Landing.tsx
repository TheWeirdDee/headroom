// Screen 0 (PRD 15.2): the problem in one screen, the tagline, then intake or the sample.
// Every factual line here is read from the rules table with its source; nothing is typed in by hand.
import { Link } from 'react-router';
import { ArrowRight, ExternalLink, FileCheck2, Files, PlayCircle, ShieldCheck, Users } from 'lucide-react';
import { useApp } from '../state/app.ts';
import { useStartSample } from '../state/useStartSample.ts';
import type { Rule } from '../api/types.ts';
import { ruleRsd } from '../format/money.ts';

const SHOWCASE = 'p07';
const TAGLINE =
  'Before you send an invoice, see how much room is left under the 6M limit. Every number proven.';

function Cited({ rule, quote, gloss }: { rule: Rule | undefined; quote?: boolean; gloss?: string }) {
  if (!rule) return null;
  const src = quote ? (rule.sources.find((s) => s.quote) ?? rule.sources[0]) : rule.sources[0];
  return (
    <figure className="space-y-2">
      <blockquote className="text-base text-text">
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

export function Landing() {
  const rules = useApp((s) => s.rules);
  const health = useApp((s) => s.health);
  const { start, busy, error, needsKey } = useStartSample();
  const rule = (id: string): Rule | undefined => rules?.find((r) => r.id === id);
  const offline = health?.mode === 'offline';
  const limit = ruleRsd(rules, 'R-LIMIT-6M', 'limitRSD') ?? '6M';
  const vat = ruleRsd(rules, 'R-VAT-8M', 'thresholdRSD') ?? '8M';

  return (
    <div className="mx-auto max-w-[1100px] px-4">
      <section className="py-16 md:py-24" aria-labelledby="hero">
        <p className="text-sm font-medium tracking-wide text-accent uppercase">
          For Serbian flat-rate entrepreneurs (paušalci)
        </p>
        <h1
          id="hero"
          className="mt-3 max-w-3xl text-4xl leading-tight font-semibold tracking-tight md:text-5xl"
        >
          {TAGLINE}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Headroom reads your bank statement, invoices and KPO book, finds what does not match, and shows the
          room left under the {limit} limit, the {vat} VAT threshold and the independence test. Each figure
          links to the line it came from.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/check"
            className="inline-flex items-center gap-2 rounded bg-accent px-5 py-3 font-medium text-ink hover:bg-accent/90"
          >
            <FileCheck2 size={18} aria-hidden /> Check my invoice
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => start(SHOWCASE)}
            className="inline-flex items-center gap-2 rounded border border-line px-5 py-3 font-medium hover:border-muted disabled:opacity-60"
          >
            <PlayCircle size={18} aria-hidden /> {busy ? 'Starting...' : 'Try with sample data'}
          </button>
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
      </section>

      <section className="grid gap-8 border-t border-line py-12 md:grid-cols-2" aria-labelledby="problem">
        <h2 id="problem" className="sr-only">
          The problem
        </h2>
        <div>
          <h3 className="mb-3 text-sm font-medium text-muted">The limit has not moved</h3>
          <Cited
            rule={rule('R-LIMIT-6M')}
            quote
            gloss="In English: the key limit for staying in the flat-rate system, annual turnover of six million dinars, has not changed since 2013."
          />
        </div>
        <div>
          <h3 className="mb-3 text-sm font-medium text-muted">What crossing it means</h3>
          <Cited rule={rule('R-LIMIT-6M-CONSEQUENCE')} />
        </div>
        {!rules && <p className="text-sm text-muted md:col-span-2">Loading the rules and their sources...</p>}
      </section>

      <section id="how" className="border-t border-line py-12" aria-labelledby="how-title">
        <h2 id="how-title" className="text-xl font-semibold">
          How it works
        </h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          <li className="rounded border border-line bg-panel p-5">
            <Files className="text-accent" size={20} aria-hidden />
            <p className="mt-3 font-medium">Your files in</p>
            <p className="mt-1 text-sm text-muted">
              Bank statement CSV, invoice PDFs, your KPO book and the invoice you are about to send. Processed
              on this machine.
            </p>
          </li>
          <li className="rounded border border-line bg-panel p-5">
            <Users className="text-accent" size={20} aria-hidden />
            <p className="mt-3 font-medium">Seven agents at once</p>
            <p className="mt-1 text-sm text-muted">
              Readers, a rate clerk, a limit keeper and an independence checker work in parallel on one shared
              board, built on Mozaik.
            </p>
          </li>
          <li className="rounded border border-line bg-panel p-5">
            <ShieldCheck className="text-accent" size={20} aria-hidden />
            <p className="mt-3 font-medium">Every number proven</p>
            <p className="mt-1 text-sm text-muted">
              A separate Verifier checks each figure against its source before it counts. Code does the
              arithmetic; models only read.
            </p>
          </li>
        </ol>
        <Link to="/about" className="mt-6 inline-flex items-center gap-1 text-sm text-accent hover:underline">
          Rules, sources and limits <ArrowRight size={14} aria-hidden />
        </Link>
      </section>
    </div>
  );
}
