// What the Verifier rejected in this run: the figure an agent proposed, why the source does not support
// it, and the value that was verified in its place.
import { ShieldX } from 'lucide-react';
import { AGENT_NAMES } from '../state/reducer.ts';
import { formatSr, formatDateSr } from '../format/money.ts';
import type { Figure } from '../api/types.ts';

function text(f: Figure): string {
  const v = f.value;
  if (v.t === 'money') return `${formatSr(v.amount)} ${v.currency}`;
  if (v.t === 'date') return formatDateSr(v.iso);
  if (v.t === 'text') return v.text;
  if (v.t === 'tri') return v.value;
  return v.t === 'ratio' ? v.value : '';
}

export function VerifierCatches({
  figures,
  onOpen,
}: {
  figures: Figure[];
  onOpen: (figureId: string) => void;
}) {
  const rejected = figures.filter((f) => f.status === 'contested');
  if (rejected.length === 0) return null;
  return (
    <section className="rounded border border-danger/50 bg-panel p-4" aria-label="Rejected by the Verifier">
      <h2 className="flex items-center gap-2 font-medium">
        <ShieldX size={16} className="text-danger" aria-hidden /> Rejected by the Verifier
      </h2>
      <ul className="mt-2 space-y-2 text-sm">
        {rejected.map((f) => {
          const accepted = figures.find((o) => o.key === f.key && o.status === 'verified');
          return (
            <li key={f.id}>
              <p>
                {AGENT_NAMES[f.producedBy] ?? f.producedBy} proposed{' '}
                <button
                  type="button"
                  onClick={() => onOpen(f.id)}
                  className="num text-danger line-through underline-offset-4"
                >
                  {text(f)}
                </button>{' '}
                for <span className="font-mono text-xs">{f.key}</span>
                {accepted && (
                  <>
                    {text(accepted) === text(f)
                      ? '; verified after a second reading that cites it properly: '
                      : '; verified instead: '}
                    <button
                      type="button"
                      onClick={() => onOpen(accepted.id)}
                      className="num font-medium underline decoration-dotted underline-offset-4"
                    >
                      {text(accepted)}
                    </button>
                  </>
                )}
              </p>
              <p className="text-xs text-muted">{f.checks?.find((c) => !c.passed)?.detail}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
