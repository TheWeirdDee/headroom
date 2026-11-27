// "Check my invoice" on the hosted sample server, which takes no files: how to run it on your own files,
// what to bring, and the samples that run here.
import { Link } from 'react-router';
import { BookOpenCheck, FileText, Landmark, PlayCircle, ScanSearch } from 'lucide-react';
import { Code } from './Doc.tsx';
import { REPO_URL } from './Layout.tsx';
import { TryAmount } from './TryAmount.tsx';

export function HostedIntake({
  busy,
  error,
  start,
}: {
  busy: boolean;
  error?: string | undefined;
  start: (profileId: string, mode?: 'live' | 'replay', fault?: 'misread-amount') => void;
}) {
  const button =
    'inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-muted disabled:opacity-60';
  return (
    <div className="mx-auto max-w-[1100px] space-y-8 px-4 py-8">
      <div>
        <h1 className="text-3xl font-semibold">Check my invoice</h1>
        <p role="note" className="mt-2 max-w-2xl text-muted">
          Your files never come to this website: it takes no uploads. To check your own bank statement,
          invoices and KPO book, run Headroom on your computer with a model key. Your files then stay on your
          machine, and only document text goes to the model provider.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="run-title" className="min-w-0 space-y-3">
          <h2 id="run-title" className="text-lg font-semibold">
            Run it on your files
          </h2>
          <Code>{`git clone ${REPO_URL}.git
cd headroom
npm run setup
cp .env.example .env      # put your key in GEMINI_API_KEY
npm start                 # open http://localhost:4317`}</Code>
          <p className="text-sm text-muted">
            Node 22.12 or later. A Gemini key is free at aistudio.google.com.{' '}
            <Link to="/docs#own-files" className="text-text underline underline-offset-4">
              Step by step
            </Link>
          </p>
          <ul className="grid gap-px overflow-hidden rounded-md border border-line bg-line text-sm sm:grid-cols-3">
            {[
              { Icon: Landmark, t: 'Bank statement', d: 'CSV from any bank' },
              { Icon: FileText, t: 'Invoices', d: 'PDFs with a text layer' },
              { Icon: BookOpenCheck, t: 'KPO book', d: 'CSV' },
            ].map((f) => (
              <li key={f.t} className="bg-ink p-3">
                <f.Icon size={16} className="text-muted" aria-hidden />
                <p className="mt-2">{f.t}</p>
                <p className="text-xs text-muted">{f.d}</p>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="here-title" className="min-w-0 space-y-3">
          <h2 id="here-title" className="text-lg font-semibold">
            Or see it work here, on synthetic files
          </h2>
          <TryAmount profileId="p07" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => start('p07')} className={button}>
              <PlayCircle size={16} aria-hidden /> {busy ? 'Starting...' : 'Try with sample data instead'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => start('p07', 'replay', 'misread-amount')}
              className={button}
            >
              <ScanSearch size={16} aria-hidden /> Catch a wrong number
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <p className="text-sm text-muted">
            The sample is an invented freelancer with six planted mistakes: money with no invoice, an invoice
            missing from the book, a wrong date, a wrong exchange rate, a wrong amount and a wrong client
            country.
          </p>
        </section>
      </div>
    </div>
  );
}
