// The Figure Board: a windowed table of every figure, filterable, newest status flashes.
import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { AGENT_NAMES, type RunView } from '../state/reducer.ts';
import { valueText } from '../format/money.ts';
import { StatusChip } from './StatusChip.tsx';
import type { ClaimStatus } from '../api/types.ts';

const ROW_H = 34;
const HEIGHT = 420;
const STATUSES: Array<ClaimStatus | 'all'> = [
  'all',
  'proposed',
  'verified',
  'contested',
  'needs_user',
  'superseded',
];

export function FigureBoard({ view, onOpen }: { view: RunView; onOpen: (figureId: string) => void }) {
  const [status, setStatus] = useState<ClaimStatus | 'all'>('all');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [top, setTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const kinds = useMemo(
    () => [...new Set(view.order.map((id) => view.figures[id]?.kind ?? ''))].filter(Boolean).sort(),
    [view.order, view.figures],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = [];
    for (let i = view.order.length - 1; i >= 0; i -= 1) {
      const f = view.figures[view.order[i] ?? ''];
      if (!f) continue;
      if (status !== 'all' && f.status !== status) continue;
      if (kind !== 'all' && f.kind !== kind) continue;
      if (needle && !f.key.toLowerCase().includes(needle)) continue;
      out.push(f);
    }
    return out;
  }, [view.order, view.figures, status, kind, q]);

  const first = Math.max(0, Math.floor(top / ROW_H) - 5);
  const last = Math.min(rows.length, first + Math.ceil(HEIGHT / ROW_H) + 10);

  return (
    <section className="flex flex-col rounded border border-line bg-panel" aria-label="Figure Board">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="mr-auto font-medium">
          Figure Board{' '}
          <span className="num text-sm text-muted">
            ({rows.length} of {view.order.length})
          </span>
        </h2>
        <label className="flex items-center gap-1 rounded border border-line bg-ink px-2 py-1 text-sm">
          <Search size={14} aria-hidden className="text-muted" />
          <span className="sr-only">Search by key</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search key"
            className="w-36 bg-transparent outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ClaimStatus | 'all')}
            className="rounded border border-line bg-ink px-2 py-1"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded border border-line bg-ink px-2 py-1"
          >
            <option value="all">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="table" aria-rowcount={rows.length} className="text-sm">
        <div
          role="row"
          className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_auto_minmax(0,1fr)_minmax(0,1fr)_3.5rem] gap-3 border-b border-line px-3 py-1.5 text-xs text-muted"
        >
          <span role="columnheader">Key</span>
          <span role="columnheader">Value</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Producer</span>
          <span role="columnheader">Corroborated by</span>
          <span role="columnheader" className="text-right">
            Sources
          </span>
        </div>
        <div
          ref={ref}
          className="overflow-y-auto"
          style={{ height: HEIGHT }}
          onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        >
          {rows.length === 0 && (
            <p className="p-6 text-center text-muted">
              {view.order.length === 0
                ? 'No figures yet. The agents are reading.'
                : 'No figure matches the filter.'}
            </p>
          )}
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {rows.slice(first, last).map((f, i) => {
              const recent = view.flash[f.id] !== undefined && view.seq - (view.flash[f.id] ?? 0) < 3;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="row"
                  onClick={() => onOpen(f.id)}
                  className={`absolute right-0 left-0 grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_auto_minmax(0,1fr)_minmax(0,1fr)_3.5rem] items-center gap-3 border-b border-line/60 px-3 text-left hover:bg-panel-2 ${recent ? 'flash' : ''}`}
                  style={{ top: (first + i) * ROW_H, height: ROW_H }}
                >
                  <span role="cell" className="truncate font-mono text-xs" title={f.key}>
                    {f.key}
                  </span>
                  <span role="cell" className="num truncate" title={valueText(f.value)}>
                    {valueText(f.value)}
                  </span>
                  <span role="cell">
                    <StatusChip status={f.status} />
                  </span>
                  <span role="cell" className="truncate text-muted">
                    {AGENT_NAMES[f.producedBy] ?? f.producedBy}
                  </span>
                  <span role="cell" className="truncate text-muted">
                    {(view.corroboratedBy[f.id] ?? []).map((a) => AGENT_NAMES[a] ?? a).join(', ')}
                  </span>
                  <span role="cell" className="num text-right text-muted">
                    {f.sources.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
