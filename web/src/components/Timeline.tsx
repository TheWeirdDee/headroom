// Concurrency timeline (PRD 15.2): one row per agent, one bar per loop, a live cursor while running.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AGENT_NAMES, AGENT_ORDER, type RunView } from '../state/reducer.ts';

const ROW = 18;
const LABEL = 132;

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
  const W = 1000;

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
          {loops.length} loops · up to {maxConc} at once · {(span / 1000).toFixed(1)} s
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <svg
            viewBox={`0 0 ${W} ${AGENT_ORDER.length * ROW}`}
            className="w-full"
            role="img"
            aria-label={`${loops.length} agent loops, at most ${maxConc} running at the same time`}
            preserveAspectRatio="none"
            style={{ height: AGENT_ORDER.length * ROW }}
          >
            {AGENT_ORDER.map((a, i) => (
              <g key={a}>
                <text x={0} y={i * ROW + 13} className="fill-muted" fontSize={11}>
                  {AGENT_NAMES[a]}
                </text>
                <line
                  x1={LABEL}
                  x2={W}
                  y1={i * ROW + ROW - 1}
                  y2={i * ROW + ROW - 1}
                  className="stroke-line"
                  strokeWidth={1}
                />
              </g>
            ))}
            {loops.map((l) => {
              const row = AGENT_ORDER.indexOf(l.agentId as (typeof AGENT_ORDER)[number]);
              if (row < 0) return null;
              const x = LABEL + ((l.startedAt - t0) / span) * (W - LABEL);
              const w = Math.max(2, (((l.endedAt ?? now) - l.startedAt) / span) * (W - LABEL));
              const cls =
                l.status === 'failed' ? 'fill-danger' : l.status === 'running' ? 'fill-amber' : 'fill-accent';
              const dur = (((l.endedAt ?? now) - l.startedAt) / 1000).toFixed(2);
              return (
                <rect
                  key={l.loopId}
                  x={x}
                  y={row * ROW + 3}
                  width={w}
                  height={ROW - 7}
                  rx={2}
                  className={`${cls} opacity-80`}
                >
                  <title>{`${l.loopId} · ${dur} s · ${l.tokensIn} in / ${l.tokensOut} out tokens · ${l.status}`}</title>
                </rect>
              );
            })}
            {running && (
              <line
                x1={LABEL + ((now - t0) / span) * (W - LABEL)}
                x2={LABEL + ((now - t0) / span) * (W - LABEL)}
                y1={0}
                y2={AGENT_ORDER.length * ROW}
                className="stroke-text"
                strokeWidth={1}
              />
            )}
          </svg>
        </div>
      )}
    </section>
  );
}
