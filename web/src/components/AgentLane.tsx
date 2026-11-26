import { AGENT_NAMES, laneCounts, type RunView } from '../state/reducer.ts';
import { StatusChip } from './StatusChip.tsx';

export function AgentLane({
  view,
  agentId,
  onError,
}: {
  view: RunView;
  agentId: string;
  onError: (agentId: string) => void;
}) {
  const st = view.agents[agentId];
  const c = laneCounts(view, agentId);
  const failed = Object.values(view.loops).filter((l) => l.agentId === agentId && l.status === 'failed');
  const errored =
    st?.state === 'error' || failed.length > 0 || view.errors.some((e) => e.participantId === agentId);
  return (
    <li
      className={`rounded border p-3 ${errored ? 'border-danger/60 bg-danger/5' : 'border-line bg-panel'}`}
      aria-label={AGENT_NAMES[agentId] ?? agentId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{AGENT_NAMES[agentId] ?? agentId}</span>
        <StatusChip status={errored ? 'error' : (st?.state ?? 'idle')} />
      </div>
      <p className="mt-1 min-h-[2.5em] text-sm text-muted" aria-live="polite">
        {st?.doingNow ?? 'Waiting to start'}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="num" title="Proposed / verified / contested figures from this agent">
          {c.proposed} proposed · <span className="text-accent">{c.verified} verified</span> · {c.contested}{' '}
          contested
        </span>
        {st?.loopId && (
          <span className="truncate font-mono" title={st.loopId}>
            {st.loopId.slice(-8)}
          </span>
        )}
      </div>
      {errored && (
        <button type="button" className="mt-2 text-xs text-danger underline" onClick={() => onError(agentId)}>
          Details
        </button>
      )}
    </li>
  );
}
