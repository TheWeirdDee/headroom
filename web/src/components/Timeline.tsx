// Concurrency timeline: one row per agent, one bar per loop, a live cursor while running.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { RunView } from '../state/reducer.ts';
import { Lanes } from './Lanes.tsx';

export function Timeline({ view }: { view: RunView }) {
  const [open, setOpen] = useState(true);
  const loops = Object.values(view.loops);
  const running = loops.some((l) => l.status === 'running');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  const t0 = loops.length ? Math.min(...loops.map((l) => l.startedAt)) : 0;
  const t1 = loops.length ? Math.max(...loops.map((l) => l.endedAt ?? now), running ? now : 0) : 1;
  const span = Math.max(1, t1 - t0);
  const maxConc = (() => {
    const ev = loops
      .flatMap((l) => [[l.startedAt, 1] as const, [l.endedAt ?? t1, -1] as const])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let c = 0;
    let m = 0;
    for (const [, d] of ev) {
      c += d;
      m = Math.max(m, c);
    }
    return m;
  })();
  return (
    <section className="rounded border border-line bg-panel" aria-label="Concurrency timeline">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span className="font-medium">Timeline</span>
        <span className="num text-muted">
          {loops.length} loops · up to {maxConc} open at once · {(span / 1000).toFixed(1)} s
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <Lanes
            label={`${loops.length} agent loops, at most ${maxConc} running at the same time`}
            from={t0}
            to={t0 + span}
            spans={loops.map((l) => ({
              agentId: l.agentId,
              start: l.startedAt,
              end: l.endedAt ?? now,
              cls:
                l.status === 'failed' ? 'fill-danger' : l.status === 'running' ? 'fill-amber' : 'fill-accent',
              title: `${l.loopId} · ${(((l.endedAt ?? now) - l.startedAt) / 1000).toFixed(2)} s · ${l.tokensIn} in / ${l.tokensOut} out tokens · ${l.status}`,
            }))}
          />
        </div>
      )}
    </section>
  );
}
