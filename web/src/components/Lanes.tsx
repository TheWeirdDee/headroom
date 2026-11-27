// One row per agent, one bar per span of time, on a shared scale. Labels are ordinary text beside the
// drawing, so they stay readable at any width while the bars stretch.
import { AGENT_NAMES, AGENT_ORDER } from '../state/reducer.ts';

export interface Span {
  agentId: string;
  start: number;
  end: number;
  cls?: string;
  title?: string;
}

const ROW = 18;

export function Lanes({
  spans,
  from,
  to,
  label,
}: {
  spans: Span[];
  from: number;
  to: number;
  label: string;
}) {
  const range = Math.max(1, to - from);
  const agents = AGENT_ORDER.filter((a) => spans.some((s) => s.agentId === a));
  return (
    <div className="flex gap-2">
      <ul className="w-[7.5rem] shrink-0 sm:w-36" aria-hidden>
        {agents.map((a) => (
          <li
            key={a}
            className="truncate text-[11px] text-muted"
            style={{ height: ROW, lineHeight: `${ROW}px` }}
          >
            {AGENT_NAMES[a]}
          </li>
        ))}
      </ul>
      <svg
        viewBox={`0 0 1000 ${Math.max(1, agents.length) * ROW}`}
        preserveAspectRatio="none"
        className="min-w-0 flex-1"
        style={{ height: Math.max(1, agents.length) * ROW }}
        role="img"
        aria-label={label}
      >
        {agents.map((a, i) => (
          <line
            key={a}
            x1={0}
            x2={1000}
            y1={i * ROW + ROW - 1}
            y2={i * ROW + ROW - 1}
            className="stroke-line"
            strokeWidth={1}
          />
        ))}
        {spans.map((s, i) => {
          const row = agents.indexOf(s.agentId as (typeof agents)[number]);
          if (row < 0) return null;
          return (
            <rect
              key={i}
              x={((s.start - from) / range) * 1000}
              y={row * ROW + 3}
              width={Math.max(1.5, ((s.end - s.start) / range) * 1000)}
              height={ROW - 7}
              rx={1.5}
              className={`${s.cls ?? 'fill-accent'} opacity-75`}
            >
              {s.title && <title>{s.title}</title>}
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
