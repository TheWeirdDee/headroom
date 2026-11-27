// Evidence (PRD 15.2 screen 4): the evaluation table written by npm run eval. Nothing is shown until it exists.
import { useEffect, useState } from 'react';
import { CircleCheck, CircleAlert } from 'lucide-react';
import { getJson, ApiError } from '../api/client.ts';
import type { Evidence as EvidenceData } from '../api/types.ts';

export function Evidence() {
  const [data, setData] = useState<EvidenceData>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    getJson<EvidenceData>('/api/evidence')
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Could not load the evaluation results.'),
      );
  }, []);
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Evidence</h1>
        <p className="mt-1 text-muted">
          How well Headroom finds the mistakes planted in the synthetic sample profiles, measured by a script
          anyone can run.
        </p>
      </div>
      {error && <p className="rounded border border-line bg-panel p-4 text-sm text-muted">{error}</p>}
      {data && (
        <>
          <section className="rounded border border-line bg-panel p-4 text-sm">
            <h2 className="font-medium">Conditions</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
              <dt className="text-muted">Date</dt>
              <dd>{data.conditions.date}</dd>
              <dt className="text-muted">Mode</dt>
              <dd>{data.conditions.mode}</dd>
              <dt className="text-muted">Models</dt>
              <dd>
                {data.conditions.models.reader} (readers), {data.conditions.models.verifier} (Verifier)
              </dd>
              <dt className="text-muted">Mozaik</dt>
              <dd>{data.conditions.mozaikVersion}</dd>
              <dt className="text-muted">Runs</dt>
              <dd>
                {data.conditions.profiles.length} profiles;{' '}
                {Object.entries(data.conditions.runsPerProfile)
                  .map(([p, n]) => `${p} ${n}`)
                  .join(', ')}
                {data.conditions.stopped ? `. Incomplete: ${data.conditions.stopped}` : ''}
              </dd>
            </dl>
          </section>
          <section className="overflow-x-auto rounded border border-line bg-panel">
            <table className="w-full text-sm">
              <caption className="p-3 text-left font-medium">Results</caption>
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="border-b border-line px-3 py-2">
                    Metric
                  </th>
                  <th scope="col" className="border-b border-line px-3 py-2 text-right">
                    Value
                  </th>
                  <th scope="col" className="border-b border-line px-3 py-2 text-right">
                    Target
                  </th>
                  <th scope="col" className="border-b border-line px-3 py-2">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.map((m) => (
                  <tr key={m.name} className="border-b border-line/60">
                    <td className="px-3 py-1.5">
                      {m.name}
                      {m.note && <span className="block text-xs text-muted">{m.note}</span>}
                    </td>
                    <td className="num px-3 py-1.5 text-right">{m.value}</td>
                    <td className="num px-3 py-1.5 text-right text-muted">{m.target ?? ''}</td>
                    <td className="px-3 py-1.5">
                      {m.passed === undefined ? null : m.passed ? (
                        <span className="inline-flex items-center gap-1 text-accent">
                          <CircleCheck size={14} aria-hidden /> Met
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-danger">
                          <CircleAlert size={14} aria-hidden /> Not met
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="overflow-x-auto rounded border border-line bg-panel">
            <table className="w-full text-sm">
              <caption className="p-3 text-left font-medium">By mistake type</caption>
              <thead className="text-left text-xs text-muted">
                <tr>
                  {['Type', 'Planted', 'Found', 'Missed', 'Extra'].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`border-b border-line px-3 py-2 ${i > 0 ? 'text-right' : ''}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.perType.map((r) => (
                  <tr key={r.type} className="border-b border-line/60">
                    <td className="px-3 py-1.5 font-mono text-xs">{r.type}</td>
                    <td className="num px-3 py-1.5 text-right">{r.planted}</td>
                    <td className="num px-3 py-1.5 text-right">{r.found}</td>
                    <td className="num px-3 py-1.5 text-right">{r.missed}</td>
                    <td className="num px-3 py-1.5 text-right">{r.extra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="rounded border border-line bg-panel p-4">
            <h2 className="font-medium">Misses</h2>
            {data.misses.length === 0 ? (
              <p className="mt-1 text-sm text-muted">None in these runs.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {data.misses.map((m, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs">
                      {m.profileId} {m.type}
                    </span>{' '}
                    <span className="text-muted">{m.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
