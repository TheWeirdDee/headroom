// The landing page's hero card and proof excerpt (master prompt section 9, items 2 and 5). Both are the real
// HeadroomCard, DiscrepancyList and SourceDrawer components fed by a replay of the committed demo recording
// (GET /api/showcase), so every number on them opens its sources like it does on the run screen.
import { useEffect, useMemo, useState } from 'react';
import { getJson, ApiError } from '../api/client.ts';
import { useRun, useRunConnection } from '../state/store.ts';
import { HeadroomCard } from './HeadroomCard.tsx';
import { DiscrepancyList } from './DiscrepancyList.tsx';
import { SourceDrawer } from './SourceDrawer.tsx';

export function useShowcaseRun(): { runId?: string; error?: string } {
  const [state, setState] = useState<{ runId?: string; error?: string }>({});
  useEffect(() => {
    let live = true;
    getJson<{ runId: string }>('/api/showcase').then(
      (r) => live && setState({ runId: r.runId }),
      (e: unknown) =>
        live &&
        setState({
          // No recording yet is a normal state: the sections are simply not shown.
          error:
            e instanceof ApiError && e.code === 'NO_RECORDING' ? undefined : 'Could not load the sample run.',
        }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function useShowcase(runId: string) {
  useRunConnection(runId);
  const view = useRun(runId, (s) => s.view);
  const [open, setOpen] = useState<string>();
  return { view, open, setOpen };
}

function Provenance({ runId }: { runId: string }) {
  const recording = useRun(runId, (s) => s.view.snapshot?.recording);
  if (!recording) return null;
  const date = recording.recordedAt.slice(0, 10);
  const models =
    recording.models.reader === recording.models.verifier
      ? recording.models.reader
      : `${recording.models.reader} and ${recording.models.verifier}`;
  return (
    <p className="mt-2 text-xs text-muted">
      Sample profile p07 (synthetic), replayed from a run recorded on {date} with {models}. Click a number to
      see where it came from.
    </p>
  );
}

export function ShowcaseCard({ runId }: { runId: string }) {
  const { view, open, setOpen } = useShowcase(runId);
  const discrepancies = view.discrepancies;
  return (
    <div>
      <HeadroomCard
        card={view.card}
        crossings={view.crossings}
        discrepancies={discrepancies}
        onOpen={setOpen}
      />
      <Provenance runId={runId} />
      {open && <SourceDrawer runId={runId} figureId={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

export function ShowcaseProof({ runId }: { runId: string }) {
  const { view, open, setOpen } = useShowcase(runId);
  const items = useMemo(
    () => Object.values(view.discrepancies).filter((d) => d.status !== 'superseded'),
    [view.discrepancies],
  );
  return (
    <div className="rounded border border-line bg-panel">
      {view.loaded ? (
        <DiscrepancyList items={items} onOpen={setOpen} />
      ) : (
        <p className="p-4 text-sm text-muted">Loading the recorded sample run...</p>
      )}
      {open && <SourceDrawer runId={runId} figureId={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
