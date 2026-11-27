// KPO book: the corrected book from verified figures, with the correction log beside it.
import { apiUrl } from '../api/base.ts';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Download } from 'lucide-react';
import { getJson, ApiError } from '../api/client.ts';
import type { KpoExport } from '../api/types.ts';
import { formatDateSr, formatSr } from '../format/money.ts';
import { TopBand } from '../components/TopBand.tsx';
import { SourceDrawer } from '../components/SourceDrawer.tsx';

export function Kpo() {
  const { runId = '' } = useParams();
  const [data, setData] = useState<KpoExport>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string>();
  useEffect(() => {
    getJson<KpoExport>(`/api/runs/${runId}/kpo`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load the KPO book.'));
  }, [runId]);

  const btn =
    'inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-sm hover:border-muted';
  return (
    <div>
      <TopBand {...(data ? { data: data.synthetic ? ('sample' as const) : ('user' as const) } : {})} />
      <div className="mx-auto max-w-[1440px] space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/runs/${runId}`}
            className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"
          >
            <ArrowLeft size={14} aria-hidden /> Back to the run
          </Link>
          <h1 className="mr-auto text-xl font-semibold">KPO book{data ? ` ${data.book.year}` : ''}</h1>
          <a className={btn} href={apiUrl(`/api/runs/${runId}/export/kpo.csv`)}>
            <Download size={14} aria-hidden /> CSV
          </a>
          <a className={btn} href={apiUrl(`/api/runs/${runId}/export/kpo.csv?locale=sr`)}>
            <Download size={14} aria-hidden /> CSV (sr decimal comma)
          </a>
          <a className={btn} href={apiUrl(`/api/runs/${runId}/export/kpo.pdf`)}>
            <Download size={14} aria-hidden /> PDF
          </a>
          <a className={btn} href={apiUrl(`/api/runs/${runId}/export/kpo_corrections.csv`)}>
            <Download size={14} aria-hidden /> Corrections CSV
          </a>
        </div>
        {error && (
          <p role="alert" className="rounded border border-amber/50 bg-amber/10 p-3 text-sm">
            {error} The book is built from verified figures only, so it appears once the run has verified the
            totals.
          </p>
        )}
        {!data && !error && <p className="text-muted">Loading...</p>}
        {data && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="rounded border border-line bg-panel" aria-label="KPO book">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 border-b border-line p-3 text-sm">
                {data.header.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      {data.columns.map((c, i) => (
                        <th
                          key={c}
                          scope="col"
                          className={`border-b border-line px-3 py-2 font-medium ${i >= 2 ? 'text-right' : ''}`}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.book.rows.map((r) => (
                      <tr
                        key={r.rowNo}
                        className="cursor-pointer border-b border-line/60 hover:bg-panel-2"
                        onClick={() => r.figureIds[1] && setOpen(r.figureIds[1])}
                      >
                        <td className="num px-3 py-1.5">{r.rowNo}</td>
                        <td className="px-3 py-1.5">
                          <span className="num mr-2 whitespace-nowrap">{formatDateSr(r.date)}</span>
                          {r.description}
                        </td>
                        <td className="num px-3 py-1.5 text-right">{formatSr(r.productsRSD)}</td>
                        <td className="num px-3 py-1.5 text-right">{formatSr(r.servicesRSD)}</td>
                        <td className="num px-3 py-1.5 text-right">{formatSr(r.totalRSD)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-medium">
                      <td className="px-3 py-2" colSpan={2}>
                        Total
                      </td>
                      <td className="num px-3 py-2 text-right">{formatSr(data.book.totals.productsRSD)}</td>
                      <td className="num px-3 py-2 text-right">{formatSr(data.book.totals.servicesRSD)}</td>
                      <td className="num px-3 py-2 text-right">{formatSr(data.book.totals.totalRSD)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="p-3 text-xs text-muted">{data.disclaimer}</p>
            </section>
            <section className="rounded border border-line bg-panel" aria-label="Correction log">
              <h2 className="border-b border-line p-3 font-medium">
                Corrections to your book <span className="num text-muted">({data.corrections.length})</span>
              </h2>
              {data.corrections.length === 0 ? (
                <p className="p-3 text-sm text-muted">Your book matches the verified figures.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.corrections.map((c, i) => (
                    <li key={i} className="space-y-1 p-3 text-sm">
                      <p>
                        <span className="mr-2 rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-xs">
                          {c.type}
                        </span>
                        Invoice {c.invoice}
                      </p>
                      <p className="font-mono text-xs text-muted line-through">{c.original}</p>
                      <p className="font-mono text-xs">{c.corrected}</p>
                      <p className="text-muted">{c.why}</p>
                      {c.figureIds[0] !== undefined && (
                        <button
                          type="button"
                          className="text-xs text-accent hover:underline"
                          onClick={() => setOpen(c.figureIds[0])}
                        >
                          Evidence
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
      {open && <SourceDrawer runId={runId} figureId={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
