// About (PRD 15.2 screen 5): what it is, the authority boundary, every rule with its sources, limitations,
// and what leaves the machine.
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { useApp } from '../state/app.ts';
import { StatusChip } from '../components/StatusChip.tsx';
import { ruleRsd } from '../format/money.ts';

const STATUS_LABEL: Record<string, string> = {
  verified: 'rule_verified',
  assumption: 'assumption',
  product: 'product',
};

export function About() {
  const health = useApp((s) => s.health);
  const rules = useApp((s) => s.rules);
  const { hash } = useLocation();
  const limit = ruleRsd(rules, 'R-LIMIT-6M', 'limitRSD') ?? '6M';
  const vat = ruleRsd(rules, 'R-VAT-8M', 'thresholdRSD') ?? '8M';
  useEffect(() => {
    if (hash && rules) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, rules]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-10 px-4 py-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">About Headroom</h1>
        <p>
          Headroom is a checking tool for Serbian flat-rate entrepreneurs (paušalci). Before you send an
          invoice, it shows how much room is left under the {limit} turnover limit, the {vat} VAT threshold
          and the independence test, and it finds where your bank statement, invoices and KPO book disagree.
        </p>
        <p className="rounded border border-line bg-panel p-3">{health?.authorityBoundary}</p>
        <p className="text-sm text-muted">
          It does not file anything, does not tell you how much tax you owe, and does not give advice.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">How the agents work</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            Seven agents run at the same time on Mozaik, each in its own loop, sharing one board of figures.
          </li>
          <li>
            Readers (invoice, statement, KPO) propose figures with the exact line they came from. A model
            reads; it never adds up.
          </li>
          <li>
            RateClerk converts foreign amounts with the NBS middle rate for the right date. LimitKeeper and
            IndependenceChecker compute with exact decimals in code.
          </li>
          <li>
            The Verifier checks every proposed figure: the source exists and hashes match, derived numbers
            recompute, and the value matches the source. Only verified figures count.
          </li>
          <li>
            When a document does not settle something, an agent asks you a question instead of guessing.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">What is sent to the model provider</h2>
        <p className="text-sm">
          In live mode, the text of your invoices, statement rows and KPO rows is sent to Anthropic's API to
          be read
          {health ? ` (${health.models.reader} for reading, ${health.models.verifier} for checks)` : ''}.
          Arithmetic, rules and totals never leave this machine. Files you upload stay in a local folder until
          you delete them. In offline mode nothing is sent: recorded model answers are played back.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Rules and sources</h2>
        <p className="text-sm text-muted">
          Each rule shows its status. Sourced rules quote the law or an official publication. Assumptions are
          not confirmed by an official source and are marked wherever they affect a number. Conventions are
          Headroom's own display choices.
        </p>
        {!rules && <p className="text-sm text-muted">Loading...</p>}
        <ul className="space-y-3">
          {rules?.map((r) => (
            <li key={r.id} id={r.id} className="scroll-mt-4 rounded border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted">{r.id}</span>
                <StatusChip status={STATUS_LABEL[r.status] ?? r.status} />
                <h3 className="font-medium">{r.title}</h3>
              </div>
              <p className="mt-2 text-sm">{r.statement_en}</p>
              <p lang="sr" className="mt-1 text-sm text-muted">
                {r.statement_sr}
              </p>
              {r.note && <p className="mt-1 text-xs text-muted">Note: {r.note}</p>}
              <ul className="mt-2 space-y-1 text-xs">
                {r.sources.map((s) => (
                  <li key={s.url + (s.locator ?? '')}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      {s.title}
                      {s.locator ? `, ${s.locator}` : ''} <ExternalLink size={11} aria-hidden />
                    </a>
                    <span className="text-muted"> · accessed {s.accessed}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Limitations</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>The bundled data is synthetic. Real use needs your own files and a model key.</li>
          <li>Scanned PDFs without a text layer are listed as unreadable; there is no OCR.</li>
          <li>Special VAT place-of-supply cases (real estate, transport and others) are not modelled.</li>
          <li>
            Income taxed as other income after a failed independence test is noted, not removed from the 6M
            total automatically.
          </li>
          <li>
            Rules marked as assumptions may be wrong. Check with an accountant or the Tax Administration.
          </li>
        </ul>
      </section>
    </div>
  );
}
