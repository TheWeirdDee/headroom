// The landing page's card, findings and timeline. With a Headroom server, they are the run screen's own
// components fed by a replay of the committed real-model recording (GET /api/showcase), so every number opens
// its sources. Without one (a static frontend whose server is asleep), the same components show a snapshot of
// that replay bundled at build time (npm run export:showcase); sources then open only in the running app.
import { useEffect, useMemo, useState } from 'react';
import { getJson } from '../api/client.ts';
import { useApp } from '../state/app.ts';
import { useRun, useRunConnection } from '../state/store.ts';
import { emptyView } from '../state/reducer.ts';
import { HeadroomCard } from './HeadroomCard.tsx';
import { DiscrepancyList } from './DiscrepancyList.tsx';
import { SourceDrawer } from './SourceDrawer.tsx';
import { Timeline } from './Timeline.tsx';
import type { CardVM, Crossing, Discrepancy, LoopMetric } from '../api/types.ts';
import snapshot from '../generated/showcase.json';

/** Figures of the recorded live run itself (not the delay-free replay shown on the landing page). */
export interface RecordedRun {
  models: { reader: string; verifier: string };
  wallTimeMs: number;
  sumLoopTimeMs: number;
  maxConcurrentLoops: number;
  loops: number;
  failedLoops: number;
  verified: number;
  unsourcedFigures: number;
  /** Conflicts between two different agents in the recorded run (an agent revising itself is not one). */
  agentConflicts: number | null;
  /** Every loop of the recorded run with its real start and end. */
  loopTimes: LoopMetric[];
}

interface StaticShowcase {
  recording: { recordedAt: string; models: { reader: string; verifier: string } } | null;
  card: CardVM | null;
  crossings: Crossing[];
  discrepancies: Discrepancy[];
  recorded: RecordedRun;
}

const STATIC = snapshot as unknown as StaticShowcase;

export interface Showcase {
  /** Set when a Headroom server is replaying the recording; absent means the bundled snapshot is shown. */
  runId?: string;
  recorded: RecordedRun;
}

export function useShowcaseRun(): Showcase {
  const [state, setState] = useState<Showcase>({ recorded: STATIC.recorded });
  // Ask the server once it is up (a hosted one may be waking); until then the bundled snapshot shows.
  const healthy = useApp((st) => st.health !== undefined);
  useEffect(() => {
    if (!healthy) return;
    let live = true;
    getJson<{ runId: string | null; recorded: RecordedRun | null }>('/api/showcase').then(
      (r) => {
        if (live && r.runId) setState({ runId: r.runId, recorded: r.recorded ?? STATIC.recorded });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [healthy]);
  return state;
}

function useShowcase(runId: string) {
  useRunConnection(runId);
  const view = useRun(runId, (s) => s.view);
  const [open, setOpen] = useState<string>();
  return { view, open, setOpen };
}

const byId = (ds: Discrepancy[]): Record<string, Discrepancy> => Object.fromEntries(ds.map((d) => [d.id, d]));

function Provenance({ recording }: { recording: StaticShowcase['recording'] }) {
  if (!recording) return null;
  const models =
    recording.models.reader === recording.models.verifier
      ? recording.models.reader
      : `${recording.models.reader} and ${recording.models.verifier}`;
  return (
    <p className="mt-3 text-xs text-muted">
      Synthetic sample p07, from a run recorded {recording.recordedAt.slice(0, 10)} with {models}.
    </p>
  );
}

function LiveCard({ runId }: { runId: string }) {
  const { view, open, setOpen } = useShowcase(runId);
  const recording = view.snapshot?.recording ?? STATIC.recording;
  const live = view.card !== null;
  return (
    <div>
      <HeadroomCard
        card={live ? view.card : STATIC.card}
        crossings={live ? view.crossings : STATIC.crossings}
        discrepancies={live ? view.discrepancies : byId(STATIC.discrepancies)}
        onOpen={setOpen}
        compact
      />
      <Provenance recording={recording} />
      {open && <SourceDrawer runId={runId} figureId={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

export function ShowcaseCard({ runId }: { runId?: string }) {
  if (runId) return <LiveCard runId={runId} />;
  return (
    <div>
      <HeadroomCard
        card={STATIC.card}
        crossings={STATIC.crossings}
        discrepancies={byId(STATIC.discrepancies)}
        onOpen={() => undefined}
        compact
      />
      <Provenance recording={STATIC.recording} />
    </div>
  );
}

function LiveProof({ runId }: { runId: string }) {
  const { view, open, setOpen } = useShowcase(runId);
  const items = useMemo(
    () => Object.values(view.discrepancies).filter((d) => d.status !== 'superseded'),
    [view.discrepancies],
  );
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <DiscrepancyList items={items.length ? items : STATIC.discrepancies} onOpen={setOpen} />
      {open && <SourceDrawer runId={runId} figureId={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

export function ShowcaseProof({ runId }: { runId?: string }) {
  if (runId) return <LiveProof runId={runId} />;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <DiscrepancyList items={STATIC.discrepancies} onOpen={() => undefined} />
      <p className="border-t border-line px-4 py-3 text-xs text-muted">
        Sources open in the running app: start the sample run to follow each finding to its line.
      </p>
    </div>
  );
}

/** The run screen's timeline component, drawn from the recorded live run's own loop times. */
export function ShowcaseTimeline({ recorded }: { recorded: RecordedRun }) {
  const view = useMemo(
    () => ({
      ...emptyView('recorded'),
      loaded: true,
      status: 'completed' as const,
      loops: Object.fromEntries(recorded.loopTimes.map((l) => [l.loopId, l])),
    }),
    [recorded],
  );
  return recorded.loopTimes.length > 0 ? <Timeline view={view} /> : null;
}
