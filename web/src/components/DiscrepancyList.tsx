import { FileSearch } from 'lucide-react';
import type { Discrepancy } from '../api/types.ts';
import { formatRsd } from '../format/money.ts';
import { StatusChip } from './StatusChip.tsx';

export function DiscrepancyList({
  items,
  onOpen,
}: {
  items: Discrepancy[];
  onOpen: (figureId: string) => void;
}) {
  if (items.length === 0) return <p className="p-4 text-sm text-muted">No discrepancies found so far.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((d) => (
        <li key={d.id} className="flex flex-wrap items-start gap-3 p-3">
          <span
            className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-xs"
            title="Discrepancy type"
          >
            {d.type}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{d.title}</p>
            <p className="mt-0.5 text-sm text-muted">{d.detail}</p>
            {d.deltaRSD !== undefined && (
              <p className="mt-0.5 text-sm">
                Effect on the 6M total: <span className="num font-medium">{formatRsd(d.deltaRSD)}</span>
              </p>
            )}
          </div>
          <StatusChip status={d.status} />
          {d.figureIds[0] !== undefined && (
            <button
              type="button"
              onClick={() => onOpen(d.figureIds[0] ?? '')}
              className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
            >
              <FileSearch size={14} aria-hidden /> Evidence
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
